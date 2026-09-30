/**
 * Parcours complet contre une API démarrée (`pnpm dev`) avec Postgres + Redis (docker compose)
 * et OTP_DEV_FIXED_CODE=123456. Lancer : `pnpm test:e2e`.
 */
import { Redis } from 'ioredis';
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
    expect((await call('POST', `/admin/drivers/${driver.userId}/approve`, admin.token)).status).toBe(200);

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
    expect((await call('POST', `/trips/${trip.body.id}/accept`, driver.token)).status).toBe(200);
    const assigned = await assignedPromise;
    expect(assigned.driver.vehicle.plate).toMatch(/TU/);
    expect(assigned.driver.phone).toBeUndefined();

    // Position du chauffeur relayée au passager pendant la course
    const locPromise = next(passengerSocket, 'driver:location');
    await driverSocket.emitWithAck('driver:location', { ...PICKUP, ts: Date.now() });
    expect((await locPromise).tripId).toBe(trip.body.id);

    expect((await call('POST', `/trips/${trip.body.id}/arrived`, driver.token)).body.status).toBe('driver_arrived');
    expect((await call('POST', `/trips/${trip.body.id}/start`, driver.token)).body.status).toBe('in_progress');
    const done = await call('POST', `/trips/${trip.body.id}/complete`, driver.token);
    expect(done.body.status).toBe('completed');
    expect(done.body.finalPrice).toBe(estimate.body.price);

    const me = await call('GET', '/drivers/me', driver.token);
    expect(me.body.presence.status).toBe('online');
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
