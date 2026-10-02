/**
 * Parcours complet contre une API démarrée (`pnpm dev`) avec Postgres + Redis (docker compose)
 * et OTP_DEV_FIXED_CODE=123456. Lancer : `pnpm test:e2e`.
 */
import { Redis } from 'ioredis';
import pg from 'pg';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const API = process.env.API_URL ?? 'http://localhost:3000';
const OTP = '123456';
const ADMIN_PHONE = '+21620000000';

const TUNIS_CENTRE = { lat: 36.8065, lng: 10.1815 };
const PICKUP = { lat: 36.8008, lng: 10.18 }; // ~700 m du chauffeur
const LA_MARSA = { lat: 36.8782, lng: 10.3247 };

interface Session {
  token: string;
  refreshToken: string;
  userId: string;
}

async function call<T = any>(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

const REQUIRED_DOCUMENTS = ['cin', 'driving_license', 'vehicle_registration', 'insurance'];
const fakeImage = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(randomDigits(64))]);

/** Envoi multipart d'une pièce justificative. */
async function upload(token: string, fields: Record<string, string | undefined>, content: Buffer) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) form.set(key, value);
  form.set('file', new Blob([new Uint8Array(content)]), 'scan.png');
  const res = await fetch(`${API}/v1/drivers/me/documents`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function login(phone: string): Promise<Session> {
  expect((await call('POST', '/auth/otp/request', undefined, { phone })).status).toBe(202);
  const { status, body } = await call('POST', '/auth/otp/verify', undefined, { phone, code: OTP });
  expect(status).toBe(200);
  return { token: body.accessToken, refreshToken: body.refreshToken, userId: body.user.id };
}

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(`${API}/rt`, { auth: { token }, transports: ['websocket'] });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function next<T = any>(socket: Socket, event: string, predicate: (p: T) => boolean = () => true, timeoutMs = 8_000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout en attendant ${event}`)), timeoutMs);
    const handler = (payload: T) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

const randomMobile = () => `+2162${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
const randomDigits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

describe('parcours passager ↔ chauffeur', () => {
  let admin: Session, driver: Session, passenger: Session;
  let driverSocket: Socket, passengerSocket: Socket;
  let completedTrip: { id: string; price: number };

  beforeAll(async () => {
    // Remet à zéro les limites d'envoi d'OTP (le numéro admin est réutilisé à chaque exécution).
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380');
    const keys = [...(await redis.keys('otp:cooldown:*')), ...(await redis.keys('otp:rl:*'))];
    if (keys.length) await redis.del(...keys);
    await redis.quit();

    [admin, driver, passenger] = await Promise.all([login(ADMIN_PHONE), login(randomMobile()), login(randomMobile())]);
    driverSocket = await connect(driver.token);
    passengerSocket = await connect(passenger.token);
  });

  afterAll(() => {
    driverSocket?.close();
    passengerSocket?.close();
  });

  it('refuse un numéro non tunisien', async () => {
    const { status, body } = await call('POST', '/auth/otp/request', undefined, { phone: '+33612345678' });
    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
  });

  it('exige un jeton', async () => {
    expect((await call('GET', '/me')).status).toBe(401);
  });

  it('onboarding chauffeur : refusé en ligne tant que non validé, puis validé par un admin', async () => {
    const onboard = await call('POST', '/drivers/onboarding', driver.token, {
      cinNumber: randomDigits(8),
      licenseNumber: `P${randomDigits(8)}`,
      licenseExpiry: '2030-01-01',
    });
    expect(onboard.status).toBe(201);
    expect(onboard.body.status).toBe('pending_documents');

    const vehicle = await call('POST', '/drivers/me/vehicles', driver.token, {
      make: 'Kia',
      model: 'Picanto',
      color: 'Blanc',
      year: 2021,
      plate: `${randomDigits(3)} تونس ${randomDigits(4)}`,
    });
    expect(vehicle.status).toBe(201);
    expect(vehicle.body.plate).toMatch(/^\d{3}TU\d{4}$/);

    const early = await call('POST', '/drivers/me/availability', driver.token, { online: true });
    expect(early.status).toBe(403);
    expect(early.body.code).toBe('DRIVER_NOT_APPROVED');

    expect((await call('POST', `/admin/drivers/${driver.userId}/approve`, passenger.token)).status).toBe(403);

    // Pièces obligatoires (config par défaut) : sans elles, l'approbation est refusée
    const incomplete = await call('POST', `/admin/drivers/${driver.userId}/approve`, admin.token);
    expect(incomplete.status).toBe(409);
    expect(incomplete.body.code).toBe('DOCUMENTS_INCOMPLETE');
    expect([...incomplete.body.details.missing].sort()).toEqual([...REQUIRED_DOCUMENTS].sort());

    // Contrôles à l'envoi : contenu réel du fichier, assurance datée, réservé aux chauffeurs
    const fakePng = await upload(driver.token, { type: 'cin' }, Buffer.from('ceci n’est pas une image'));
    expect(fakePng.body.code).toBe('DOCUMENT_INVALID_TYPE');
    expect((await upload(driver.token, { type: 'insurance' }, fakeImage())).body.code).toBe('VALIDATION_FAILED');
    expect((await upload(passenger.token, { type: 'cin' }, fakeImage())).body.code).toBe('NOT_A_DRIVER');

    for (const type of REQUIRED_DOCUMENTS) {
      const fields = type === 'insurance' ? { type, expiresAt: '2030-01-01' } : { type };
      const sent = await upload(driver.token, fields, fakeImage());
      expect(sent.status).toBe(201);
      expect(sent.body.status).toBe('pending');
      expect(sent.body.storageKey).toBeUndefined();
      expect(sent.body.mimeType).toBe('image/png');
    }
    // Dossier complet : il entre dans la file de validation de l'admin
    expect((await call('GET', '/drivers/me', driver.token)).body.status).toBe('under_review');
    const pending = await call('GET', '/admin/drivers/pending', admin.token);
    expect(pending.body.map((d: any) => d.userId)).toContain(driver.userId);

    const detail = await call('GET', `/admin/drivers/${driver.userId}`, admin.token);
    expect(detail.status).toBe(200);
    expect(detail.body.cin).toMatch(/^\*{5}\d{3}$/);
    expect(detail.body.documents).toHaveLength(REQUIRED_DOCUMENTS.length);
    expect(detail.body.missingForApproval).toHaveLength(REQUIRED_DOCUMENTS.length);

    // Le scan n'est lisible que par un admin, via la route authentifiée
    const cinDoc = detail.body.documents.find((d: any) => d.type === 'cin');
    const file = await fetch(`${API}/v1/admin/drivers/${driver.userId}/documents/${cinDoc.id}/file`, {
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('cache-control')).toContain('no-store');
    const driverAttempt = await fetch(`${API}/v1/admin/drivers/${driver.userId}/documents/${cinDoc.id}/file`, {
      headers: { authorization: `Bearer ${driver.token}` },
    });
    expect(driverAttempt.status).toBe(403);

    // Liens signés : le navigateur de l'admin charge le scan directement depuis l'API, sans jeton
    expect((await call('POST', `/admin/drivers/${driver.userId}/documents/links`, passenger.token, {})).status).toBe(403);
    const issued = await call('POST', `/admin/drivers/${driver.userId}/documents/links`, admin.token, {});
    expect(issued.status).toBe(200);
    expect(Object.keys(issued.body.links).sort()).toEqual(detail.body.documents.map((d: any) => d.id).sort());
    expect(new Date(issued.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const link = `${API}/v1${issued.body.links[cinDoc.id]}`;
    const viaLink = await fetch(link);
    expect(viaLink.status).toBe(200);
    expect(viaLink.headers.get('content-type')).toBe('image/png');
    expect(viaLink.headers.get('cache-control')).toContain('no-store');
    expect(Buffer.from(await viaLink.arrayBuffer()).subarray(0, 4).toString('hex')).toBe('89504e47');

    // Un lien ne vaut que pour son document, son échéance et sa signature
    const otherDoc = detail.body.documents.find((d: any) => d.id !== cinDoc.id);
    expect((await fetch(link.replace(cinDoc.id, otherDoc.id))).status).toBe(403);
    expect((await fetch(link.replace(/e=\d+/, 'e=9999999999'))).status).toBe(403);
    expect((await fetch(link.replace(/s=([\w-]+)/, (_, sig) => `s=${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`))).status).toBe(403);
    expect((await fetch(`${API}/v1/documents/${cinDoc.id}/file`)).status).toBe(400); // sans signature
    // On ne demande pas de lien pour le document d'un autre compte
    const foreign = await call('POST', `/admin/drivers/${passenger.userId}/documents/links`, admin.token, { documentIds: [cinDoc.id] });
    expect(foreign.status).toBe(404);
    expect((await call('POST', `/admin/drivers/${driver.userId}/documents/links`, admin.token, { documentIds: [] })).status).toBe(400);

    // Un document refusé renvoie le dossier au chauffeur, qui le remplace
    const docUrl = (id: string, action: string) => `/admin/drivers/${driver.userId}/documents/${id}/${action}`;
    const rejectedNotice = next(driverSocket, 'notification:new', (n) => n.type === 'driver.document_rejected');
    expect((await call('POST', docUrl(cinDoc.id, 'reject'), admin.token, { reason: 'Photo floue' })).body.status).toBe('rejected');
    expect((await rejectedNotice).payload.body).toContain('Photo floue');
    expect((await call('POST', docUrl(cinDoc.id, 'approve'), admin.token)).body.code).toBe('DOCUMENT_ALREADY_REVIEWED');
    expect((await call('GET', '/drivers/me', driver.token)).body.status).toBe('pending_documents');
    expect((await upload(driver.token, { type: 'cin' }, fakeImage())).status).toBe(201);
    expect((await call('GET', '/drivers/me', driver.token)).body.status).toBe('under_review');

    // Tant que tout n'est pas approuvé pièce par pièce, pas d'approbation du chauffeur
    expect((await call('POST', `/admin/drivers/${driver.userId}/approve`, admin.token)).body.code).toBe('DOCUMENTS_INCOMPLETE');
    const docs = (await call('GET', `/admin/drivers/${driver.userId}`, admin.token)).body.documents as any[];
    for (const doc of docs) {
      expect((await call('POST', docUrl(doc.id, 'approve'), admin.token)).body.status).toBe('approved');
    }
    const approvedNotice = next(driverSocket, 'notification:new', (n) => n.type === 'driver.approved');
    expect((await call('POST', `/admin/drivers/${driver.userId}/approve`, admin.token)).status).toBe(200);
    expect((await approvedNotice).payload.title).toBe('Compte chauffeur validé');

    expect((await call('POST', '/drivers/me/availability', driver.token, { online: true })).status).toBe(200);
    const ack = await driverSocket.emitWithAck('driver:location', { ...TUNIS_CENTRE, ts: Date.now() });
    expect(ack).toEqual({ ok: true });
  });

  it('devis → demande → offre → acceptation → course complète', async () => {
    const estimate = await call('POST', '/trips/estimate', passenger.token, {
      pickup: PICKUP,
      dropoff: LA_MARSA,
      pickupAddress: 'Avenue Habib Bourguiba, Tunis',
      dropoffAddress: 'La Marsa',
    });
    expect(estimate.status).toBe(200);
    expect(estimate.body.price % 100).toBe(0);

    const offerPromise = next(driverSocket, 'trip:offer');
    const key = `test-${randomDigits(10)}`;
    const trip = await call('POST', '/trips', passenger.token, { quoteId: estimate.body.quoteId }, { 'idempotency-key': key });
    expect(trip.status).toBe(201);
    expect(trip.body.status).toBe('requested');

    // Retry réseau : même clé ⇒ même course, sans erreur de devis consommé
    const retry = await call('POST', '/trips', passenger.token, { quoteId: estimate.body.quoteId }, { 'idempotency-key': key });
    expect(retry.body.id).toBe(trip.body.id);

    const offer = await offerPromise;
    expect(offer.trip.id).toBe(trip.body.id);
    expect(offer.distanceToPickupM).toBeLessThan(3_000);
    expect(offer.trip.price).toBe(estimate.body.price);

    const assignedPromise = next(passengerSocket, 'trip:updated', (t) => t.status === 'driver_assigned');
    const notifiedPromise = next(passengerSocket, 'notification:new', (n) => n.type === 'trip.driver_assigned');
    expect((await call('POST', `/trips/${trip.body.id}/accept`, driver.token)).status).toBe(200);
    const assigned = await assignedPromise;
    expect(assigned.driver.vehicle.plate).toMatch(/TU/);
    expect(assigned.driver.phone).toBeUndefined();
    // ETA du chauffeur vers le point de prise en charge, d'après sa dernière position connue
    expect(assigned.driverEta.distanceM).toBeLessThan(3_000);
    expect(assigned.driverEta.durationS).toBeGreaterThan(0);
    const notified = await notifiedPromise;
    expect(notified.payload.title).toBe('Chauffeur en route');
    expect(notified.payload.data).toMatchObject({ tripId: trip.body.id, status: 'driver_assigned' });

    // Position du chauffeur relayée au passager pendant la course
    const locPromise = next(passengerSocket, 'driver:location');
    await driverSocket.emitWithAck('driver:location', { ...PICKUP, ts: Date.now() });
    expect((await locPromise).tripId).toBe(trip.body.id);

    // Trace GPS : un lot rejoué (retry réseau après une réponse perdue) ne crée pas de doublons
    const t0 = Date.now();
    const batch = { points: [1, 2, 3].map((i) => ({ lat: PICKUP.lat + i * 0.0002, lng: PICKUP.lng, ts: t0 + i * 1_000 })) };
    expect((await call('POST', '/drivers/me/location', driver.token, batch)).status).toBe(200);
    expect((await call('POST', '/drivers/me/location', driver.token, batch)).status).toBe(200);

    expect((await call('POST', `/trips/${trip.body.id}/arrived`, driver.token)).body.status).toBe('driver_arrived');
    expect((await call('POST', `/trips/${trip.body.id}/start`, driver.token)).body.status).toBe('in_progress');
    const done = await call('POST', `/trips/${trip.body.id}/complete`, driver.token);
    expect(done.body.status).toBe('completed');
    expect(done.body.finalPrice).toBe(estimate.body.price);
    expect(done.body.payment).toEqual({ method: 'cash', amount: estimate.body.price, status: 'pending' });
    completedTrip = { id: trip.body.id, price: estimate.body.price };

    const me = await call('GET', '/drivers/me', driver.token);
    expect(me.body.presence.status).toBe('online');
  });

  it('paiement cash : seul le chauffeur confirme l’encaissement, de façon idempotente', async () => {
    const { id, price } = completedTrip;
    expect((await call('POST', `/trips/${id}/cash-collected`, passenger.token)).status).toBe(404);

    const paidPromise = next(passengerSocket, 'trip:updated', (t) => t.payment?.status === 'succeeded');
    const first = await call('POST', `/trips/${id}/cash-collected`, driver.token);
    expect(first.status).toBe(200);
    expect(first.body.payment).toEqual({ method: 'cash', amount: price, status: 'succeeded' });
    await paidPromise;

    expect((await call('POST', `/trips/${id}/cash-collected`, driver.token)).body.payment.status).toBe('succeeded');
    expect((await call('GET', `/trips/${id}`, passenger.token)).body.payment.status).toBe('succeeded');
  });

  it('portefeuille : commission due à l’encaissement, une seule fois, visible du chauffeur et de l’admin', async () => {
    const { id, price } = completedTrip;
    const rules = (await call('GET', '/admin/pricing/rules', admin.token)).body as any[];
    const bps = rules.find((r) => r.category === 'standard' && r.zone === null).commissionBps as number;
    const commission = Math.round((price * bps) / 10_000);

    // L'encaissement a été confirmé deux fois dans le test précédent : une seule commission
    const wallet = (await call('GET', '/drivers/me/wallet', driver.token)).body;
    expect(wallet).toMatchObject({ balance: -commission, debt: commission, state: 'ok' });
    expect(wallet.ceiling).toBeGreaterThan(commission);
    const commissions = wallet.transactions.items.filter((t: any) => t.type === 'platform_commission');
    expect(commissions).toHaveLength(1);
    expect(commissions[0]).toMatchObject({ amount: -commission, balanceAfter: -commission, tripId: id });
    expect(wallet.earnings).toMatchObject({ trips: 1, gross: price, commission, net: price - commission });

    expect((await call('GET', `/admin/drivers/${driver.userId}/wallet`, passenger.token)).status).toBe(403);
    const seen = (await call('GET', `/admin/drivers/${driver.userId}/wallet`, admin.token)).body;
    expect(seen).toMatchObject({ balance: -commission, debt: commission });
    const debts = (await call('GET', '/admin/wallets/debts?limit=100', admin.token)).body;
    expect(debts.items.find((d: any) => d.driverId === driver.userId)).toMatchObject({ debt: commission, state: 'ok' });
    expect((await call('GET', '/admin/wallets/debts', passenger.token)).status).toBe(403);
  });

  it('portefeuille : règlement partiel, jamais au-delà de la dette, tracé', async () => {
    const before = (await call('GET', '/drivers/me/wallet', driver.token)).body;
    const base = `/admin/drivers/${driver.userId}/wallet/settlements`;
    expect((await call('POST', base, passenger.token, { amount: 100 })).status).toBe(403);
    expect((await call('POST', base, admin.token, { amount: 0 })).status).toBe(400);
    expect((await call('POST', base, admin.token, { amount: 1.5 })).status).toBe(400);

    const tooMuch = await call('POST', base, admin.token, { amount: before.debt + 1 });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body).toMatchObject({ code: 'SETTLEMENT_EXCEEDS_DEBT', details: { debt: before.debt } });

    const noticed = next(driverSocket, 'notification:new', (n) => n.type === 'wallet.settlement');
    const paid = await call('POST', base, admin.token, { amount: 1_000, note: 'Remise en main propre' });
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({ balance: before.balance + 1_000, debt: before.debt - 1_000 });
    expect((await noticed).payload.title).toBe('Règlement enregistré');

    const ledger = (await call('GET', '/drivers/me/wallet', driver.token)).body.transactions.items;
    expect(ledger[0]).toMatchObject({ type: 'settlement', amount: 1_000, note: 'Remise en main propre' });
    // Le grand livre reste cohérent : chaque ligne porte le solde qui en résulte
    expect(ledger[0].balanceAfter).toBe(paid.body.balance);
    expect(ledger[1].balanceAfter).toBe(ledger[0].balanceAfter - 1_000);

    const audit = (await call('GET', '/admin/audit?entity=wallet&limit=5', admin.token)).body.items as any[];
    expect(audit[0]).toMatchObject({ action: 'wallet.settlement', entityId: driver.userId, details: { amount: 1_000 } });
  });

  it('portefeuille : avertissement à 80 % du plafond, blocage au plafond, reprise après règlement', async () => {
    const { ceiling, debt } = (await call('GET', '/drivers/me/wallet', driver.token)).body;
    const adjust = (amount: number, reason?: string) =>
      call('POST', `/admin/drivers/${driver.userId}/wallet/adjustments`, admin.token, { amount, reason });

    // Une correction manuelle doit être motivée et non nulle
    expect((await adjust(-1_000)).status).toBe(400);
    expect((await adjust(0, 'rien')).status).toBe(400);
    expect((await call('POST', `/admin/drivers/${driver.userId}/wallet/adjustments`, passenger.token, { amount: -1_000, reason: 'test' })).status).toBe(403);

    // 85 % du plafond : avertissement, le chauffeur reste en ligne
    expect((await call('POST', '/drivers/me/availability', driver.token, { online: true })).status).toBe(200);
    const warned = next(driverSocket, 'notification:new', (n) => n.type === 'wallet.debt_warning');
    const toWarning = await adjust(-(Math.round(ceiling * 0.85) - debt), 'Pénalité (test)');
    expect(toWarning.body.state).toBe('warning');
    expect((await warned).payload.title).toBe('Dette de commission élevée');
    expect((await call('GET', '/drivers/me', driver.token)).body.presence.status).toBe('online');

    // Au plafond : mis hors ligne, prévenu (SMS en plus), et ne peut plus repasser en ligne
    const blocked = next(driverSocket, 'notification:new', (n) => n.type === 'wallet.debt_limit');
    const toLimit = await adjust(-Math.ceil(ceiling * 0.2), 'Pénalité (test)');
    expect(toLimit.body.state).toBe('blocked');
    expect((await blocked).payload.title).toBe('Compte bloqué : plafond de dette atteint');
    expect((await call('GET', '/drivers/me', driver.token)).body.presence).toBeNull();
    const refused = await call('POST', '/drivers/me/availability', driver.token, { online: true });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: 'DEBT_LIMIT_REACHED', details: { ceiling, debt: toLimit.body.debt } });

    // Règlement de la dette : le chauffeur peut reprendre
    const cleared = await call('POST', `/admin/drivers/${driver.userId}/wallet/settlements`, admin.token, { amount: toLimit.body.debt });
    expect(cleared.body).toMatchObject({ balance: 0, debt: 0, state: 'ok' });
    expect((await call('POST', '/drivers/me/availability', driver.token, { online: true })).status).toBe(200);
    await driverSocket.emitWithAck('driver:location', { ...TUNIS_CENTRE, ts: Date.now() }); // les tests suivants ont besoin du chauffeur localisé

    const actions = ((await call('GET', '/admin/audit?entity=wallet&limit=10', admin.token)).body.items as any[]).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['wallet.adjustment', 'wallet.settlement']));
  });

  it('portefeuille : la commission suit le taux du devis, pas celui du jour de l’encaissement', async () => {
    const rules = (await call('GET', '/admin/pricing/rules', admin.token)).body as any[];
    const standard = rules.find((r) => r.category === 'standard' && r.zone === null);
    const setCommission = (bps: number) => call('PATCH', `/admin/pricing/rules/${standard.id}`, admin.token, { commissionBps: bps });

    let tripId: string;
    let price: number;
    try {
      expect((await setCommission(1_000)).status).toBe(200); // 10 % au moment du devis
      const estimate = await call('POST', '/trips/estimate', passenger.token, { pickup: PICKUP, dropoff: LA_MARSA });
      price = estimate.body.price;
      const offerPromise = next(driverSocket, 'trip:offer');
      const trip = await call('POST', '/trips', passenger.token, { quoteId: estimate.body.quoteId });
      tripId = trip.body.id;
      await offerPromise;
    } finally {
      expect((await setCommission(standard.commissionBps)).status).toBe(200); // retour au taux d'origine avant l'encaissement
    }

    expect((await call('POST', `/trips/${tripId}/accept`, driver.token)).status).toBe(200);
    await driverSocket.emitWithAck('driver:location', { ...PICKUP, ts: Date.now() });
    for (const step of ['arrived', 'start', 'complete', 'cash-collected']) {
      expect((await call('POST', `/trips/${tripId}/${step}`, driver.token)).status).toBe(200);
    }

    const ledger = (await call('GET', '/drivers/me/wallet', driver.token)).body.transactions.items as any[];
    const entry = ledger.find((t) => t.tripId === tripId);
    expect(entry.amount).toBe(-Math.round(price * 0.1)); // 10 % et non le taux actuel
    expect(standard.commissionBps).not.toBe(1_000); // le test n'a de sens que si le taux a bien changé entre-temps
  });

  it('notation bidirectionnelle : une note par participant, moyenne mise à jour', async () => {
    const { id } = completedTrip;
    expect((await call('POST', `/trips/${id}/rating`, passenger.token, { score: 6 })).status).toBe(400);

    const byPassenger = await call('POST', `/trips/${id}/rating`, passenger.token, { score: 5, comment: 'Très bien' });
    expect(byPassenger.status).toBe(201);
    expect(byPassenger.body.rateeId).toBe(driver.userId);
    expect((await call('POST', `/trips/${id}/rating`, passenger.token, { score: 1 })).body.code).toBe('ALREADY_RATED');

    const byDriver = await call('POST', `/trips/${id}/rating`, driver.token, { score: 4 });
    expect(byDriver.body.rateeId).toBe(passenger.userId);

    const driverMe = await call('GET', '/me', driver.token);
    expect(driverMe.body.ratingCount).toBe(1);
    expect(Number(driverMe.body.ratingAvg)).toBe(5);
    expect(Number((await call('GET', '/me', passenger.token)).body.ratingAvg)).toBe(4);
  });

  it('trace GPS : visible des participants et du back-office, sans doublons', async () => {
    const { id } = completedTrip;
    for (const token of [passenger.token, driver.token]) {
      const track = await call('GET', `/trips/${id}/track`, token);
      expect(track.status).toBe(200);
      expect(track.body.status).toBe('completed');
      // 1 point du socket + 3 du lot HTTP (rejoué deux fois)
      expect(track.body.points).toHaveLength(4);
      const times = track.body.points.map((p: any) => p.ts);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(track.body.travelledDistanceM).toBeGreaterThan(50);
    }

    // Un admin non participant n'a pas accès par la route des participants, mais par celle du back-office
    expect((await call('GET', `/trips/${id}/track`, admin.token)).status).toBe(404);
    const audit = await call('GET', `/admin/trips/${id}/track`, admin.token);
    expect(audit.status).toBe(200);
    expect(audit.body.points).toHaveLength(4);
    expect((await call('GET', `/admin/trips/${id}/track`, passenger.token)).status).toBe(403);
  });

  it('notifications : boîte de réception, lecture, pagination', async () => {
    const inbox = await call('GET', '/notifications', passenger.token);
    expect(inbox.status).toBe(200);
    const types = inbox.body.items.map((n: any) => n.type);
    expect(types).toEqual(expect.arrayContaining(['trip.driver_assigned', 'trip.driver_arrived', 'trip.completed']));
    expect(inbox.body.unread).toBeGreaterThanOrEqual(3);

    // Plusieurs courses terminées dans ce parcours : on cible celle du test
    const completed = inbox.body.items.find((n: any) => n.type === 'trip.completed' && n.payload.data.tripId === completedTrip.id);
    expect(completed.payload.body).toMatch(/DT/);
    expect(completed.payload.data.tripId).toBe(completedTrip.id);
    expect(completed.readAt).toBeNull();

    // Les offres ne vont que sur push et temps réel, jamais dans la boîte de réception
    const driverTypes = (await call('GET', '/notifications?limit=50', driver.token)).body.items.map((n: any) => n.type);
    expect(driverTypes).not.toContain('trip.offer');
    expect(driverTypes).not.toContain('trip.driver_assigned');

    const read = await call('POST', `/notifications/${completed.id}/read`, passenger.token);
    expect(read.body.readAt).not.toBeNull();
    expect((await call('POST', `/notifications/${completed.id}/read`, passenger.token)).body.readAt).toBe(read.body.readAt);
    expect((await call('POST', `/notifications/${completed.id}/read`, driver.token)).status).toBe(404);

    const page1 = await call('GET', '/notifications?limit=1', passenger.token);
    expect(page1.body.items).toHaveLength(1);
    const page2 = await call('GET', `/notifications?cursor=${encodeURIComponent(page1.body.nextCursor)}`, passenger.token);
    expect(page2.body.items.map((n: any) => n.id)).not.toContain(page1.body.items[0].id);

    expect((await call('POST', '/notifications/read-all', passenger.token)).status).toBe(204);
    expect((await call('GET', '/notifications', passenger.token)).body.unread).toBe(0);
    expect((await call('GET', '/notifications?limit=500', passenger.token)).status).toBe(400);
  });

  it('appareils push : enregistrement, changement de compte, suppression', async () => {
    const token = `ExponentPushToken[${randomDigits(20)}]`;
    const owner = async () => {
      const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://vtc:vtc@localhost:5433/vtc' });
      await db.connect();
      try {
        return (await db.query('SELECT user_id FROM device_tokens WHERE token = $1', [token])).rows[0]?.user_id as string | undefined;
      } finally {
        await db.end();
      }
    };

    expect((await call('PUT', '/notifications/devices', passenger.token, { token, platform: 'web' })).status).toBe(400);
    expect((await call('PUT', '/notifications/devices', passenger.token, { token, platform: 'android' })).status).toBe(204);
    expect(await owner()).toBe(passenger.userId);

    // Même appareil, autre compte : le jeton change de propriétaire (plus de notifications de l'ancien compte)
    expect((await call('PUT', '/notifications/devices', driver.token, { token, platform: 'android' })).status).toBe(204);
    expect(await owner()).toBe(driver.userId);

    const encoded = encodeURIComponent(token);
    expect((await call('DELETE', `/notifications/devices?token=${encoded}`, passenger.token)).status).toBe(204);
    expect(await owner()).toBe(driver.userId); // pas le sien : sans effet
    expect((await call('DELETE', `/notifications/devices?token=${encoded}`, driver.token)).status).toBe(204);
    expect(await owner()).toBeUndefined();
  });

  it('notation refusée tant que la course n’est pas terminée', async () => {
    const estimate = await call('POST', '/trips/estimate', passenger.token, { pickup: PICKUP, dropoff: LA_MARSA });
    const trip = await call('POST', '/trips', passenger.token, { quoteId: estimate.body.quoteId });
    expect((await call('POST', `/trips/${trip.body.id}/rating`, passenger.token, { score: 5 })).body.code).toBe(
      'TRIP_NOT_COMPLETED',
    );
    await call('POST', `/trips/${trip.body.id}/cancel`, passenger.token, {});
  });

  it('historique paginé, du plus récent au plus ancien, avec l’autre partie', async () => {
    const page1 = await call('GET', '/trips?limit=1', passenger.token);
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await call('GET', `/trips?limit=50&cursor=${encodeURIComponent(page1.body.nextCursor)}`, passenger.token);
    expect(page2.body.items.length).toBeGreaterThan(0);
    expect(page2.body.items.map((t: any) => t.id)).not.toContain(page1.body.items[0].id);

    const all = (await call('GET', '/trips', passenger.token)).body.items as any[];
    const done = all.find((t) => t.id === completedTrip.id);
    expect(done.counterpart.id).toBe(driver.userId);
    expect(done.vehicle.plate).toMatch(/TU/);
    expect(done.myRating).toBe(5);

    const driverView = (await call('GET', '/trips', driver.token)).body.items as any[];
    const asDriver = driverView.find((t) => t.id === completedTrip.id);
    expect(asDriver.counterpart.id).toBe(passenger.userId);
    expect(asDriver.vehicle).toBeNull();
    expect(asDriver.myRating).toBe(4);

    expect((await call('GET', '/trips?limit=500', passenger.token)).status).toBe(400);
  });

  it("annulation passager pendant l'offre : gratuite, l'offre est retirée au chauffeur", async () => {
    const estimate = await call('POST', '/trips/estimate', passenger.token, { pickup: PICKUP, dropoff: LA_MARSA });
    const offerPromise = next(driverSocket, 'trip:offer');
    const trip = await call('POST', '/trips', passenger.token, { quoteId: estimate.body.quoteId });
    const offer = await offerPromise;

    const withdrawn = next(driverSocket, 'trip:offer_cancelled');
    const cancel = await call('POST', `/trips/${trip.body.id}/cancel`, passenger.token, { reason: 'changement de plan' });
    expect(cancel.body.status).toBe('cancelled_by_passenger');
    expect(cancel.body.cancellationFee).toBe(0);
    expect((await withdrawn).offerId).toBe(offer.offerId);

    const accept = await call('POST', `/trips/${trip.body.id}/accept`, driver.token);
    expect(accept.body.code).toBe('OFFER_NOT_AVAILABLE');
  });

  it('refus du chauffeur : la course repart en recherche', async () => {
    const estimate = await call('POST', '/trips/estimate', passenger.token, { pickup: PICKUP, dropoff: LA_MARSA });
    const offerPromise = next(driverSocket, 'trip:offer');
    const trip = await call('POST', '/trips', passenger.token, { quoteId: estimate.body.quoteId });
    await offerPromise;

    expect((await call('POST', `/trips/${trip.body.id}/decline`, driver.token)).status).toBe(204);
    const active = await call('GET', '/trips/active', passenger.token);
    expect(active.body.trip.status).toBe('requested');
    expect((await call('GET', '/trips/active', driver.token)).body.pendingOffer).toBeNull();

    await call('POST', `/trips/${trip.body.id}/cancel`, passenger.token, {});
  });

  it('annulation par le chauffeur : le passager est notifié', async () => {
    const estimate = await call('POST', '/trips/estimate', passenger.token, { pickup: PICKUP, dropoff: LA_MARSA });
    const offerPromise = next(driverSocket, 'trip:offer');
    const trip = await call('POST', '/trips', passenger.token, { quoteId: estimate.body.quoteId });
    await offerPromise;
    expect((await call('POST', `/trips/${trip.body.id}/accept`, driver.token)).status).toBe(200);

    const notified = next(passengerSocket, 'notification:new', (n) => n.type === 'trip.cancelled_by_driver');
    const cancelled = await call('POST', `/trips/${trip.body.id}/cancel`, driver.token, { reason: 'panne' });
    expect(cancelled.body.status).toBe('cancelled_by_driver');
    expect((await notified).payload.data.tripId).toBe(trip.body.id);
  });

  it("offre sans réponse : expire après MATCHING_OFFER_TIMEOUT_S et n'est plus acceptable", async () => {
    const estimate = await call('POST', '/trips/estimate', passenger.token, { pickup: PICKUP, dropoff: LA_MARSA });
    const offerPromise = next(driverSocket, 'trip:offer');
    const trip = await call('POST', '/trips', passenger.token, { quoteId: estimate.body.quoteId });
    const offer = await offerPromise;

    const expired = await next(driverSocket, 'trip:offer_expired', () => true, 20_000);
    expect(expired.offerId).toBe(offer.offerId);
    expect((await call('POST', `/trips/${trip.body.id}/accept`, driver.token)).body.code).toBe('OFFER_NOT_AVAILABLE');
    expect((await call('GET', '/trips/active', passenger.token)).body.trip.status).toBe('requested');

    await call('POST', `/trips/${trip.body.id}/cancel`, passenger.token, {});
  }, 25_000);

  it("signalement d'incident : rattaché à une course, pris en charge par un admin", async () => {
    const report = { category: 'incident', description: 'Le chauffeur a pris un autre itinéraire', tripId: completedTrip.id };
    expect((await call('POST', '/support/tickets', passenger.token, { ...report, description: 'ok' })).status).toBe(400);
    // Une course dont on n'est pas participant reste introuvable
    expect((await call('POST', '/support/tickets', admin.token, report)).status).toBe(404);

    const created = await call('POST', '/support/tickets', passenger.token, report);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('open');
    const id = created.body.id;
    expect((await call('GET', '/support/tickets', passenger.token)).body.map((t: any) => t.id)).toContain(id);
    expect((await call('GET', '/support/tickets', driver.token)).body.map((t: any) => t.id)).not.toContain(id);

    expect((await call('GET', '/admin/tickets', passenger.token)).status).toBe(403);
    const queue = await call('GET', '/admin/tickets?status=open&limit=50', admin.token);
    const listed = queue.body.items.find((t: any) => t.id === id);
    expect(listed.reporter.id).toBe(passenger.userId);
    expect(listed.tripStatus).toBe('completed');

    const ticketNotice = next(passengerSocket, 'notification:new', (n) => n.type === 'support.ticket_updated');
    const taken = await call('PATCH', `/admin/tickets/${id}`, admin.token, { status: 'in_progress' });
    expect(taken.body.assignedTo).toBe(admin.userId);
    expect((await ticketNotice).payload.body).toContain('en cours');
    const resolved = await call('PATCH', `/admin/tickets/${id}`, admin.token, { status: 'resolved' });
    expect(resolved.body).toMatchObject({ status: 'resolved', assignedTo: admin.userId });
    expect((await call('GET', '/support/tickets', passenger.token)).body.find((t: any) => t.id === id).status).toBe('resolved');
    expect((await call('PATCH', `/admin/tickets/${id}`, admin.token, { status: 'nope' })).status).toBe(400);
  });

  it('adresses : autocomplétion (français et arabe) et géocodage inverse', async () => {
    const search = (query: string) => call('GET', `/places/search?${query}`, passenger.token);
    expect((await call('GET', '/places/search?q=marsa')).status).toBe(401);

    const marsa = await search('q=marsa');
    expect(marsa.status).toBe(200);
    expect(marsa.body[0]).toMatchObject({ name: 'La Marsa', lat: expect.any(Number), lng: expect.any(Number) });
    expect((await search(`q=${encodeURIComponent('المرسى')}`)).body[0].name).toBe('La Marsa');

    // La position de l'utilisateur ne filtre pas, elle classe : l'aéroport le plus proche d'abord
    expect((await search('q=aeroport&lat=34.74&lng=10.76')).body[0].name).toBe('Aéroport Sfax-Thyna');
    expect((await search('q=aeroport&limit=1')).body).toHaveLength(1);

    expect((await search('q=a')).status).toBe(400);
    expect((await search('q=marsa&lat=36.8')).status).toBe(400);
    expect((await search('q=marsa&lat=48.85&lng=2.35')).body.code).toBe('OUT_OF_SERVICE_AREA');

    const reverse = await call('GET', '/places/reverse?lat=36.879&lng=10.325', passenger.token);
    expect(reverse.body.place.name).toBe('La Marsa');
    expect((await call('GET', '/places/reverse?lat=31&lng=9', passenger.token)).body.place).toBeNull();
    expect((await call('GET', '/places/reverse?lat=48.85&lng=2.35', passenger.token)).status).toBe(400);

    // Le lieu choisi alimente directement un devis
    const { lat, lng, name, address } = marsa.body[0];
    const estimate = await call('POST', '/trips/estimate', passenger.token, {
      pickup: PICKUP,
      dropoff: { lat, lng },
      dropoffAddress: `${name}, ${address}`,
    });
    expect(estimate.status).toBe(200);
  });

  it('supervision des courses : liste filtrable et dossier complet', async () => {
    const { id } = completedTrip;
    expect((await call('GET', '/admin/trips', passenger.token)).status).toBe(403);
    expect((await call('GET', '/admin/trips?status=nope', admin.token)).status).toBe(400);

    const all = (await call('GET', '/admin/trips?limit=50', admin.token)).body.items as any[];
    const listed = all.find((t) => t.id === id);
    expect(listed).toMatchObject({ status: 'completed', passenger: { id: passenger.userId }, driver: { id: driver.userId } });
    expect(listed.driver.phone).toMatch(/^\+216/);

    const completed = (await call('GET', '/admin/trips?status=completed&limit=50', admin.token)).body.items as any[];
    expect(completed.map((t) => t.id)).toContain(id);
    expect(completed.every((t) => t.status === 'completed')).toBe(true);
    const active = (await call('GET', '/admin/trips?status=active&limit=50', admin.token)).body.items as any[];
    expect(active.map((t) => t.id)).not.toContain(id);

    const page1 = await call('GET', '/admin/trips?limit=1', admin.token);
    expect(page1.body.items).toHaveLength(1);
    const page2 = await call('GET', `/admin/trips?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`, admin.token);
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);

    const detail = await call('GET', `/admin/trips/${id}`, admin.token);
    expect(detail.status).toBe(200);
    expect(detail.body.vehicle.plate).toMatch(/TU/);
    expect(detail.body.payment).toMatchObject({ method: 'cash', status: 'succeeded' });
    expect(detail.body.events.map((e: any) => e.toStatus)).toEqual([
      'requested',
      'driver_assigned',
      'driver_arrived',
      'in_progress',
      'completed',
    ]);
    expect(detail.body.offers[0]).toMatchObject({ status: 'accepted', driver: { id: driver.userId } });
    expect(detail.body.ratings).toHaveLength(2);
    expect(detail.body.tickets.length).toBeGreaterThanOrEqual(1); // le signalement du test précédent
    expect(detail.body.idempotencyKey).toBeUndefined();
    expect((await call('GET', '/admin/trips/00000000-0000-4000-8000-000000000000', admin.token)).status).toBe(404);
  });

  it('tableau de bord : activité en direct et indicateurs de la période', async () => {
    expect((await call('GET', '/admin/stats/overview', passenger.token)).status).toBe(403);
    expect((await call('GET', '/admin/stats/overview?days=5', admin.token)).status).toBe(400);

    const { status, body } = await call('GET', '/admin/stats/overview?days=7', admin.token);
    expect(status).toBe(200);
    expect(body.live.availableDrivers).toBeGreaterThanOrEqual(1); // le chauffeur du test est en ligne
    // Le chauffeur du test doit encore la commission de la course au taux figé : la dette totale n'est pas nulle
    expect(body.live.totalDebt).toBeGreaterThan(0);
    expect(body.live.driversInDebt).toBeGreaterThanOrEqual(1);
    expect(body.totals.completed).toBeGreaterThanOrEqual(1);
    expect(body.totals.grossRevenue).toBeGreaterThanOrEqual(completedTrip.price);
    expect(body.totals.estimatedCommission).toBeGreaterThan(0);
    expect(body.totals.estimatedCommission).toBeLessThan(body.totals.grossRevenue);
    expect(body.totals.completionRate).toBeGreaterThan(0);
    expect(body.totals.completionRate).toBeLessThanOrEqual(1);
    expect(body.totals.averagePrice).toBeGreaterThan(0);
    expect(body.newUsers.passengers).toBeGreaterThanOrEqual(2);

    // Courbe quotidienne : 7 jours consécutifs, sans trou, qui totalisent les indicateurs
    expect(body.daily).toHaveLength(7);
    const days = body.daily.map((d: any) => d.day);
    expect(days).toEqual([...days].sort());
    expect(new Set(days).size).toBe(7);
    expect(body.daily.reduce((n: number, d: any) => n + d.completed, 0)).toBe(body.totals.completed);
    expect(body.daily.reduce((n: number, d: any) => n + d.requested, 0)).toBe(body.totals.requested);
    expect(body.daily.reduce((n: number, d: any) => n + d.revenue, 0)).toBe(body.totals.grossRevenue);
    expect(body.daily.at(-1).completed).toBeGreaterThanOrEqual(1);

    const month = await call('GET', '/admin/stats/overview?days=30', admin.token);
    expect(month.body.daily).toHaveLength(30);
    expect(month.body.totals.completed).toBeGreaterThanOrEqual(body.totals.completed);
  });

  it('tarification : modification contrôlée, journalisée, effective sur les nouveaux devis', async () => {
    expect((await call('GET', '/admin/pricing/rules', passenger.token)).status).toBe(403);
    const rules = (await call('GET', '/admin/pricing/rules', admin.token)).body as any[];
    const standard = rules.find((r) => r.category === 'standard' && r.zone === null);
    expect(standard).toBeTruthy();
    expect(rules.some((r) => r.zone?.kind === 'airport')).toBe(true);

    const quote = async () =>
      (await call('POST', '/trips/estimate', passenger.token, { pickup: PICKUP, dropoff: LA_MARSA })).body.price as number;
    const rule = (field: string, value: unknown) => call('PATCH', `/admin/pricing/rules/${standard.id}`, admin.token, { [field]: value });
    // Le journal grossit à chaque exécution : on compte les entrées postérieures à un repère, pas le total
    const newestAuditId = async () =>
      ((await call('GET', '/admin/audit?entity=pricing_rule&limit=1', admin.token)).body.items[0]?.id ?? 0) as number;
    const entriesSince = async (afterId: number) =>
      ((await call('GET', '/admin/audit?entity=pricing_rule&limit=20', admin.token)).body.items as any[]).filter(
        (e) => e.id > afterId && e.entityId === standard.id,
      );

    // Refus : montants invalides, corps vide, règle par défaut désactivée, règle inconnue
    expect((await rule('baseFare', -1)).status).toBe(400);
    expect((await rule('commissionBps', 9_000)).status).toBe(400);
    expect((await call('PATCH', `/admin/pricing/rules/${standard.id}`, admin.token, {})).status).toBe(400);
    expect((await rule('isActive', false)).body.code).toBe('DEFAULT_RULE_REQUIRED');
    expect((await call('PATCH', '/admin/pricing/rules/00000000-0000-4000-8000-000000000000', admin.token, { baseFare: 1 })).status).toBe(404);
    expect((await call('PATCH', `/admin/pricing/rules/${standard.id}`, passenger.token, { baseFare: 1 })).status).toBe(403);

    const auditBaseline = await newestAuditId();
    const priceBefore = await quote();
    try {
      // +1 DT sur la prise en charge ⇒ +1 DT sur le devis suivant
      const updated = await rule('baseFare', standard.baseFare + 1_000);
      expect(updated.status).toBe(200);
      expect(updated.body.baseFare).toBe(standard.baseFare + 1_000);
      expect(await quote()).toBe(priceBefore + 1_000);

      // Une modification sans effet ne produit ni changement ni ligne d'audit
      expect((await rule('baseFare', standard.baseFare + 1_000)).status).toBe(200);
      const entries = await entriesSince(auditBaseline);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        action: 'pricing.update',
        admin: { id: admin.userId },
        details: { category: 'standard', before: { baseFare: standard.baseFare }, after: { baseFare: standard.baseFare + 1_000 } },
      });
    } finally {
      expect((await rule('baseFare', standard.baseFare)).status).toBe(200);
    }
    expect(await quote()).toBe(priceBefore);
  });

  it("journal d'audit : décisions admin tracées, lecture réservée aux admins", async () => {
    expect((await call('GET', '/admin/audit', passenger.token)).status).toBe(403);
    const items = (await call('GET', '/admin/audit?limit=100', admin.token)).body.items as any[];
    const actions = items.map((e) => `${e.action}:${e.entityId}`);
    expect(actions).toContain(`driver.approve:${driver.userId}`);
    // Consulter des pièces d'identité est tracé
    expect(actions).toContain(`document.view:${driver.userId}`);
    expect(items.some((e) => e.action === 'document.reject' && e.details.reason === 'Photo floue')).toBe(true);
    expect(items.some((e) => e.action === 'document.approve')).toBe(true);
    expect(items.some((e) => e.action === 'ticket.update' && e.details.status === 'resolved')).toBe(true);

    const page1 = await call('GET', '/admin/audit?limit=2', admin.token);
    expect(page1.body.items).toHaveLength(2);
    const page2 = await call('GET', `/admin/audit?limit=2&cursor=${page1.body.nextCursor}`, admin.token);
    expect(page2.body.items.map((e: any) => e.id)).not.toContain(page1.body.items[0].id);
    expect(page2.body.items[0].id).toBeLessThan(page1.body.items[1].id);
  });

  it('refresh token : rotation puis déconnexion', async () => {
    const rotated = await call('POST', '/auth/refresh', undefined, { refreshToken: passenger.refreshToken });
    expect(rotated.status).toBe(200);
    expect((await call('GET', '/me', rotated.body.accessToken)).status).toBe(200);

    // Réponse perdue sur réseau instable : rejouer l'ancien token dans le délai de grâce est toléré
    const replay = await call('POST', '/auth/refresh', undefined, { refreshToken: passenger.refreshToken });
    expect(replay.status).toBe(200);

    expect((await call('POST', '/auth/logout', undefined, { refreshToken: rotated.body.refreshToken })).status).toBe(204);
    for (const refreshToken of [rotated.body.refreshToken, replay.body.refreshToken, passenger.refreshToken]) {
      expect((await call('POST', '/auth/refresh', undefined, { refreshToken })).status).toBe(401);
    }
  });
});
