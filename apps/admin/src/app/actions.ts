'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiUrl } from '@/lib/auth';
import { isLocale, LANG_COOKIE } from '@/lib/intl';
import { clearSessionCookies, REFRESH_COOKIE } from '@/lib/session';

export async function setLocaleAction(formData: FormData) {
  const locale = formData.get('locale');
  if (isLocale(locale)) {
    (await cookies()).set(LANG_COOKIE, locale, { path: '/', maxAge: 365 * 24 * 3600, sameSite: 'lax' });
  }
  revalidatePath('/', 'layout');
}

/** Révoque la session côté API (best effort) puis efface les cookies. */
export async function logoutAction() {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    await fetch(`${apiUrl()}/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
  }
  clearSessionCookies(jar);
  redirect('/login');
}
