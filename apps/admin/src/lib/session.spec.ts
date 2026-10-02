import { describe, expect, it } from 'vitest';
import {
  ACCESS_COOKIE,
  ACCESS_MARGIN_S,
  clearSessionCookies,
  type CookieOptions,
  mergeCookieHeader,
  REFRESH_COOKIE,
  setSessionCookies,
} from './session';

type Call = { name: string; value: string; options: CookieOptions };
const recorder = () => {
  const calls: Call[] = [];
  return {
    calls,
    set: (name: string, value: string, options: CookieOptions) => void calls.push({ name, value, options }),
  };
};
const tokens = { accessToken: 'access.jwt.value', accessTokenExpiresInS: 900, refreshToken: 'refresh-value' };

describe('cookies de session', () => {
  it("sont httpOnly, SameSite=Lax, et le cookie d'accès expire avant le jeton", () => {
    const jar = recorder();
    setSessionCookies(jar, tokens);
    const access = jar.calls.find((c) => c.name === ACCESS_COOKIE)!;
    const refresh = jar.calls.find((c) => c.name === REFRESH_COOKIE)!;

    expect(access.value).toBe(tokens.accessToken);
    expect(access.options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 900 - ACCESS_MARGIN_S });
    expect(refresh.options).toMatchObject({ httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 });
  });

  it('ne produisent jamais un maxAge nul ou négatif avec un jeton très court', () => {
    const jar = recorder();
    setSessionCookies(jar, { ...tokens, accessTokenExpiresInS: 10 });
    expect(jar.calls.find((c) => c.name === ACCESS_COOKIE)!.options.maxAge).toBe(1);
  });

  it('sont effacés à la déconnexion', () => {
    const jar = recorder();
    clearSessionCookies(jar);
    expect(jar.calls.map((c) => [c.name, c.value, c.options.maxAge])).toEqual([
      [ACCESS_COOKIE, '', 0],
      [REFRESH_COOKIE, '', 0],
    ]);
  });
});

describe('mergeCookieHeader', () => {
  it('remplace les jetons expirés et conserve les autres cookies', () => {
    const merged = mergeCookieHeader(
      [
        { name: 'vtc_lang', value: 'ar' },
        { name: ACCESS_COOKIE, value: 'old' },
        { name: REFRESH_COOKIE, value: 'old-refresh' },
      ],
      { [ACCESS_COOKIE]: 'new', [REFRESH_COOKIE]: 'new-refresh' },
    );
    expect(merged).toBe('vtc_lang=ar; vtc_at=new; vtc_rt=new-refresh');
  });

  it("ajoute les jetons quand le cookie d'accès avait déjà disparu", () => {
    expect(
      mergeCookieHeader([{ name: REFRESH_COOKIE, value: 'r' }], { [ACCESS_COOKIE]: 'a', [REFRESH_COOKIE]: 'r2' }),
    ).toBe('vtc_at=a; vtc_rt=r2');
  });
});
