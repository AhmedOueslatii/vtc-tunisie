/** Formes des réponses de l'API utilisées par le back-office (voir /docs de l'API). */

export type DriverStatus = 'pending_documents' | 'under_review' | 'approved' | 'rejected' | 'suspended';
export type DocumentType =
  | 'cin'
  | 'driving_license'
  | 'vehicle_registration'
  | 'insurance'
  | 'criminal_record'
  | 'profile_photo';
export type DocumentStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export const TICKET_STATUSES: TicketStatus[] = ['open', 'in_progress', 'resolved', 'closed'];

export interface PendingDriver {
  userId: string;
  status: DriverStatus;
  licenseExpiry: string;
  createdAt: string;
  phone: string;
  fullName: string | null;
}

export interface DriverDocument {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  /** image/jpeg, image/png ou application/pdf */
  mimeType: string | null;
  expiresAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface DocumentLinks {
  /** identifiant du document → chemin signé relatif à l'API (à préfixer par `apiPublicUrl()`) */
  links: Record<string, string>;
  expiresAt: string;
}

export interface DriverDetail {
  userId: string;
  phone: string;
  fullName: string | null;
  status: DriverStatus;
  rejectionReason: string | null;
  cin: string;
  licenseNumber: string;
  licenseExpiry: string;
  vehicle: { make: string; model: string; color: string; year: number; plate: string; category: string } | null;
  documents: DriverDocument[];
  missingForApproval: DocumentType[];
}

export interface Ticket {
  id: string;
  tripId: string | null;
  category: string;
  description: string;
  status: TicketStatus;
  createdAt: string;
  reporter: { id: string; phone: string; fullName: string | null };
  tripStatus: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TripStatus =
  | 'requested'
  | 'driver_assigned'
  | 'driver_arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled_by_passenger'
  | 'cancelled_by_driver'
  | 'no_driver_found';
export const TRIP_FILTERS = ['active', 'completed', 'cancelled_by_passenger', 'cancelled_by_driver', 'no_driver_found'] as const;

export interface Person {
  id: string;
  fullName: string | null;
  phone: string;
}

export interface TripRow {
  id: string;
  status: TripStatus;
  category: string;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  quotedPrice: number;
  finalPrice: number | null;
  requestedAt: string;
  passenger: Person;
  driver: Person | null;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface TripDetail {
  id: string;
  status: TripStatus;
  category: string;
  pickup: LatLng;
  pickupAddress: string | null;
  dropoff: LatLng;
  dropoffAddress: string | null;
  estimatedDistanceM: number;
  estimatedDurationS: number;
  quotedPrice: number;
  finalPrice: number | null;
  cancellationFee: number | null;
  cancelReason: string | null;
  requestedAt: string;
  passenger: Person;
  driver: Person | null;
  vehicle: { make: string; model: string; color: string; plate: string } | null;
  payment: { method: string; amount: number; status: string } | null;
  events: { id: number; fromStatus: TripStatus | null; toStatus: TripStatus; actorId: string | null; meta: { reason?: string; fee?: number } | null; at: string }[];
  offers: { id: string; status: string; distanceM: number; offeredAt: string; driver: Person }[];
  ratings: { raterId: string; rateeId: string; score: number; comment: string | null }[];
  tickets: { id: string; category: string; status: TicketStatus }[];
}

export interface TripTrack {
  points: { lat: number; lng: number; ts: number }[];
  travelledDistanceM: number;
}

export interface PricingRule {
  id: string;
  category: string;
  baseFare: number;
  perKm: number;
  perMinute: number;
  minimumFare: number;
  bookingFee: number;
  cancellationFee: number;
  commissionBps: number;
  isActive: boolean;
  zone: { id: string; name: string; kind: string } | null;
}

export interface AuditEntry {
  id: number;
  action: string;
  entity: string;
  entityId: string;
  details: unknown;
  at: string;
  admin: Person;
}

export interface Overview {
  range: { days: number };
  live: { activeTrips: number; availableDrivers: number; pendingDrivers: number; openTickets: number };
  totals: {
    requested: number;
    completed: number;
    cancelledByPassenger: number;
    cancelledByDriver: number;
    noDriverFound: number;
    completionRate: number | null;
    grossRevenue: number;
    estimatedCommission: number;
    averagePrice: number | null;
  };
  newUsers: { passengers: number; drivers: number };
  daily: { day: string; requested: number; completed: number; revenue: number }[];
}
