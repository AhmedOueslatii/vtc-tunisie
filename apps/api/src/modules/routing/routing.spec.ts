import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { OsrmRoutingProvider, StraightLineRoutingProvider } from './routing.provider.js';

const FROM = { lat: 36.8008, lng: 10.18 };
const TO = { lat: 36.8782, lng: 10.3247 };

const reply = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });

describe('OsrmRoutingProvider', () => {
  beforeAll(() => {
    // `env()` valide toute la configuration : valeurs minimales, sans dépendre d'un fichier .env local
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@localhost:5432/db');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv('JWT_ACCESS_SECRET', 'x'.repeat(32));
    vi.stubEnv('OTP_SECRET', 'y'.repeat(32));
    vi.stubEnv('DATA_ENCRYPTION_KEY', Buffer.alloc(32).toString('base64'));
    vi.stubEnv('OSRM_URL', 'http://osrm.test:5000');
  });
  afterEach(() => vi.unstubAllGlobals());

  const straight = new StraightLineRoutingProvider().route(FROM, TO);

  it('renvoie la distance et la durée réelles de la route (lng,lat dans cet ordre)', async () => {
    const fetchMock = vi.fn(async () => reply({ code: 'Ok', routes: [{ distance: 21_345.6, duration: 1_502.4 }] }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await new OsrmRoutingProvider().route(FROM, TO)).toEqual({ distanceM: 21_346, durationS: 1_502 });
    const called = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(called).toBe('http://osrm.test:5000/route/v1/driving/10.18,36.8008;10.3247,36.8782?overview=false');
  });

  it.each([
    ['aucun itinéraire', async () => reply({ code: 'NoRoute' })],
    ['erreur HTTP', async () => reply({}, false)],
    ['réponse vide', async () => reply({ code: 'Ok', routes: [] })],
    ['serveur injoignable', async () => Promise.reject(new Error('ECONNREFUSED'))],
  ])('se replie sur le vol d\'oiseau : %s', async (_label, impl) => {
    vi.stubGlobal('fetch', vi.fn(impl));
    expect(await new OsrmRoutingProvider().route(FROM, TO)).toEqual(await straight);
  });
});
