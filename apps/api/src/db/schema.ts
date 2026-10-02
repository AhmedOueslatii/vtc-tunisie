import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { type LatLng, parseEwkbPoint, toEwktPoint } from '../common/geo.js';

// ─── Types PostGIS ───────────────────────────────────────────────────────────

const geoPoint = customType<{ data: LatLng; driverData: string }>({
  dataType: () => 'geography(Point,4326)',
  toDriver: (p) => toEwktPoint(p),
  fromDriver: (hex) => parseEwkbPoint(hex),
});

/** Polygones de zones : écrits/lus en SQL brut (ST_GeomFromGeoJSON / ST_AsGeoJSON). */
const geoPolygon = customType<{ data: string; driverData: string }>({
  dataType: () => 'geography(MultiPolygon,4326)',
});

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ─── Enums ───────────────────────────────────────────────────────────────────

export const localeEnum = pgEnum('locale', ['fr', 'ar']);
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'deleted']);
export const driverStatusEnum = pgEnum('driver_status', [
  'pending_documents',
  'under_review',
  'approved',
  'rejected',
  'suspended',
]);
export const DOCUMENT_TYPES = [
  'cin',
  'driving_license',
  'vehicle_registration', // carte grise
  'insurance',
  'criminal_record', // bulletin n°3 — [À VALIDER] exigence réglementaire
  'profile_photo',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const documentTypeEnum = pgEnum('document_type', DOCUMENT_TYPES);
export const documentStatusEnum = pgEnum('document_status', ['pending', 'approved', 'rejected', 'expired']);
export const vehicleCategoryEnum = pgEnum('vehicle_category', ['standard', 'premium', 'van']);
export const tripStatusEnum = pgEnum('trip_status', [
  'requested',
  'driver_assigned',
  'driver_arrived',
  'in_progress',
  'completed',
  'cancelled_by_passenger',
  'cancelled_by_driver',
  'no_driver_found',
]);
export const offerStatusEnum = pgEnum('offer_status', ['pending', 'accepted', 'declined', 'expired', 'cancelled']);
export const paymentMethodEnum = pgEnum('payment_method', ['cash', 'flouci', 'konnect', 'clictopay', 'wallet']);
export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'succeeded', 'failed', 'refunded']);
export const walletTxTypeEnum = pgEnum('wallet_tx_type', [
  'trip_earning', // gain d'une course payée en ligne
  'platform_commission', // commission (débit) — sur une course cash, crée une dette
  'cancellation_fee',
  'settlement', // le chauffeur rembourse sa dette cash
  'payout', // virement au chauffeur
  'adjustment',
]);
export const sessionRevokeReasonEnum = pgEnum('session_revoke_reason', ['rotated', 'logout', 'reuse', 'suspended']);
export const ticketStatusEnum =pgEnum('ticket_status', ['open', 'in_progress', 'resolved', 'closed']);

export const ACTIVE_TRIP_STATUSES = ['requested', 'driver_assigned', 'driver_arrived', 'in_progress'] as const;
const activeTripSql = sql.raw(ACTIVE_TRIP_STATUSES.map((s) => `'${s}'`).join(', '));

// ─── Utilisateurs & sessions ─────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: varchar('phone', { length: 16 }).notNull().unique(), // E.164
  fullName: text('full_name'),
  email: text('email'),
  photoUrl: text('photo_url'),
  locale: localeEnum('locale').notNull().default('fr'),
  status: userStatusEnum('status').notNull().default('active'),
  isAdmin: boolean('is_admin').notNull().default(false),
  ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }),
  ratingCount: integer('rating_count').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Refresh tokens : stockés hachés ; `familyId` relie les rotations successives d'une même connexion. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    /** `rotated` = remplacé normalement ; toute autre valeur (logout, reuse, suspended) ferme la famille. */
    revokedReason: sessionRevokeReasonEnum('revoked_reason'),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_family_idx').on(t.familyId)],
);

// ─── Chauffeurs ──────────────────────────────────────────────────────────────

export const driverProfiles = pgTable('driver_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  status: driverStatusEnum('status').notNull().default('pending_documents'),
  cinEncrypted: text('cin_encrypted').notNull(),
  cinHash: text('cin_hash').notNull().unique(),
  licenseEncrypted: text('license_encrypted').notNull(),
  licenseHash: text('license_hash').notNull().unique(),
  licenseExpiry: date('license_expiry').notNull(),
  approvedAt: ts('approved_at'),
  approvedBy: uuid('approved_by').references(() => users.id),
  rejectionReason: text('rejection_reason'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const driverDocuments = pgTable(
  'driver_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => driverProfiles.userId, { onDelete: 'cascade' }),
    type: documentTypeEnum('type').notNull(),
    storageKey: text('storage_key').notNull(), // clé objet privée (S3-compatible), jamais d'URL publique
    status: documentStatusEnum('status').notNull().default('pending'),
    expiresAt: date('expires_at'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: ts('reviewed_at'),
    rejectionReason: text('rejection_reason'),
    createdAt: createdAt(),
  },
  (t) => [index('driver_documents_driver_idx').on(t.driverId, t.type)],
);

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => driverProfiles.userId, { onDelete: 'cascade' }),
    make: text('make').notNull(),
    model: text('model').notNull(),
    color: text('color').notNull(),
    year: smallint('year').notNull(),
    plate: varchar('plate', { length: 20 }).notNull().unique(), // normalisée : 123TU4567
    category: vehicleCategoryEnum('category').notNull().default('standard'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('vehicles_one_active_per_driver').on(t.driverId).where(sql`${t.isActive}`)],
);

// ─── Tarification ────────────────────────────────────────────────────────────

export const zones = pgTable(
  'zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    kind: text('kind').notNull(), // city | airport | port | ...
    area: geoPolygon('area').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('zones_area_gist').using('gist', t.area)],
);

/** Tous les montants en millimes. Une règle sans zone est la règle par défaut de la catégorie. */
export const pricingRules = pgTable(
  'pricing_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    zoneId: uuid('zone_id').references(() => zones.id),
    category: vehicleCategoryEnum('category').notNull(),
    baseFare: integer('base_fare').notNull(),
    perKm: integer('per_km').notNull(),
    perMinute: integer('per_minute').notNull(),
    minimumFare: integer('minimum_fare').notNull(),
    bookingFee: integer('booking_fee').notNull().default(0),
    cancellationFee: integer('cancellation_fee').notNull().default(0),
    commissionBps: integer('commission_bps').notNull(), // 2000 = 20 %
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index('pricing_rules_lookup_idx').on(t.category, t.zoneId),
    check('pricing_rules_amounts_positive', sql`${t.baseFare} >= 0 AND ${t.perKm} >= 0 AND ${t.perMinute} >= 0`),
  ],
);

// ─── Courses ─────────────────────────────────────────────────────────────────

export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    passengerId: uuid('passenger_id')
      .notNull()
      .references(() => users.id),
    driverId: uuid('driver_id').references(() => users.id),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id),
    /** Chauffeur à qui la course est actuellement proposée (verrou optimiste du matching). */
    offeredDriverId: uuid('offered_driver_id').references(() => users.id),
    status: tripStatusEnum('status').notNull().default('requested'),
    category: vehicleCategoryEnum('category').notNull(),
    pickup: geoPoint('pickup').notNull(),
    pickupAddress: text('pickup_address'),
    dropoff: geoPoint('dropoff').notNull(),
    dropoffAddress: text('dropoff_address'),
    estimatedDistanceM: integer('estimated_distance_m').notNull(),
    estimatedDurationS: integer('estimated_duration_s').notNull(),
    quotedPrice: integer('quoted_price').notNull(),
    finalPrice: integer('final_price'),
    surgeMultiplier: numeric('surge_multiplier', { precision: 4, scale: 2 }).notNull().default('1.00'),
    pricingRuleId: uuid('pricing_rule_id')
      .notNull()
      .references(() => pricingRules.id),
    paymentMethod: paymentMethodEnum('payment_method').notNull().default('cash'),
    idempotencyKey: varchar('idempotency_key', { length: 64 }),
    cancelReason: text('cancel_reason'),
    cancellationFee: integer('cancellation_fee'),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    assignedAt: ts('assigned_at'),
    arrivedAt: ts('arrived_at'),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    cancelledAt: ts('cancelled_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('trips_one_active_per_passenger')
      .on(t.passengerId)
      .where(sql`${t.status} IN (${activeTripSql})`),
    uniqueIndex('trips_one_active_per_driver')
      .on(t.driverId)
      .where(sql`${t.status} IN (${activeTripSql}) AND ${t.driverId} IS NOT NULL`),
    uniqueIndex('trips_idempotency').on(t.passengerId, t.idempotencyKey),
    index('trips_passenger_history_idx').on(t.passengerId, t.requestedAt),
    index('trips_driver_history_idx').on(t.driverId, t.requestedAt),
  ],
);

export const tripOffers = pgTable(
  'trip_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => users.id),
    status: offerStatusEnum('status').notNull().default('pending'),
    distanceM: integer('distance_m').notNull(),
    offeredAt: ts('offered_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    respondedAt: ts('responded_at'),
  },
  (t) => [uniqueIndex('trip_offers_trip_driver').on(t.tripId, t.driverId)],
);

export const tripEvents = pgTable(
  'trip_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    fromStatus: tripStatusEnum('from_status'),
    toStatus: tripStatusEnum('to_status').notNull(),
    actorId: uuid('actor_id'),
    meta: jsonb('meta'),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('trip_events_trip_idx').on(t.tripId, t.at)],
);

/** Trace GPS : uniquement pendant une course. À partitionner par mois quand le volume l'exigera. */
export const locationPoints = pgTable(
  'location_points',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id').notNull(),
    point: geoPoint('point').notNull(),
    recordedAt: ts('recorded_at').notNull(),
  },
  // Unique : une position rejouée par l'app (retry réseau) n'est enregistrée qu'une fois.
  (t) => [uniqueIndex('location_points_trip_ts').on(t.tripId, t.recordedAt)],
);

// ─── Paiements & wallet ──────────────────────────────────────────────────────

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id),
    method: paymentMethodEnum('method').notNull(),
    amount: integer('amount').notNull(),
    status: paymentStatusEnum('status').notNull().default('pending'),
    providerRef: text('provider_ref'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payments_trip_idx').on(t.tripId)],
);

export const wallets = pgTable('wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id),
  /** Négatif = le chauffeur doit des commissions sur des courses cash. */
  balance: integer('balance').notNull().default(0),
  currency: varchar('currency', { length: 3 }).notNull().default('TND'),
  updatedAt: updatedAt(),
});

/** Grand livre append-only : jamais d'UPDATE ni de DELETE. */
export const walletTransactions = pgTable(
  'wallet_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    type: walletTxTypeEnum('type').notNull(),
    amount: integer('amount').notNull(), // signé
    balanceAfter: integer('balance_after').notNull(),
    tripId: uuid('trip_id').references(() => trips.id),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('wallet_tx_wallet_idx').on(t.walletId, t.createdAt)],
);

// ─── Confiance & support ─────────────────────────────────────────────────────

export const ratings = pgTable(
  'ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id),
    raterId: uuid('rater_id')
      .notNull()
      .references(() => users.id),
    rateeId: uuid('ratee_id')
      .notNull()
      .references(() => users.id),
    score: smallint('score').notNull(),
    comment: text('comment'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ratings_one_per_rater').on(t.tripId, t.raterId),
    check('ratings_score_range', sql`${t.score} BETWEEN 1 AND 5`),
  ],
);

export const supportTickets = pgTable('support_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  reporterId: uuid('reporter_id')
    .notNull()
    .references(() => users.id),
  tripId: uuid('trip_id').references(() => trips.id),
  category: text('category').notNull(), // incident | lost_item | payment | safety | other
  description: text('description').notNull(),
  status: ticketStatusEnum('status').notNull().default('open'),
  assignedTo: uuid('assigned_to').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const devicePlatformEnum = pgEnum('device_platform', ['android', 'ios']);

/** Jetons push (FCM/APNs/Expo) : un appareil appartient à un seul utilisateur à la fois. */
export const deviceTokens = pgTable(
  'device_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: devicePlatformEnum('platform').notNull(),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('device_tokens_token').on(t.token), index('device_tokens_user_idx').on(t.userId)],
);

/** Journal des actions d'administration (décisions sur les chauffeurs, tarification…) : qui, quoi, quand, avant/après. */
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(), // ex. pricing.update, driver.approve
    entity: text('entity').notNull(), // ex. pricing_rule, driver, document, ticket
    entityId: text('entity_id').notNull(),
    details: jsonb('details'),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('admin_audit_at_idx').on(t.at), index('admin_audit_entity_idx').on(t.entity, t.entityId)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);
