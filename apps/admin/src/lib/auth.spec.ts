import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiUrl, refreshTokens } from './auth';

const reply = (status: number, body: unknown = {}) => ({ ok: status < 400, status, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

describe('refreshTokens', () => {
  it('renvoie les nouveaux jetons', async () => {
    const tokens = { accessToken: 'a', accessTokenExpiresInS: 900, refreshToken: 'r2' };
    const fetchMock = vi.fn(async () => reply(200, tokens));
    vi.stubGlobal('fetch', fetchMock);

    expect(await refreshTokens('r1')).toEqual({ kind: 'ok', tokens });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${apiUrl()}/auth/refresh`);
    expect(JSON.parse(String(init.body))).toEqual({ refreshToken: 'r1' });
  });

  it("distingue une session terminée (jeton refusé) d'une API indisponible", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(401, { code: 'REFRESH_INVALID' })));
    expect(await refreshTokens('r')).toEqual({ kind: 'invalid' });

    vi.stubGlobal('fetch', vi.fn(async () => reply(500)));
    expect(await refreshTokens('r')).toEqual({ kind: 'unavailable' });

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))));
    expect(await refreshTokens('r')).toEqual({ kind: 'unavailable' });
  });
});
