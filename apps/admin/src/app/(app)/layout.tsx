import type { ReactNode } from 'react';
import { NavLink } from '@/components/nav-link';
import { button } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { logoutAction, setLocaleAction } from '../actions';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { locale, t } = await getT();
  const other = locale === 'fr' ? 'ar' : 'fr';

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold">{t('app.short')}</span>
          <nav className="flex flex-wrap gap-1">
            <NavLink href="/">{t('nav.dashboard')}</NavLink>
            <NavLink href="/drivers">{t('nav.drivers')}</NavLink>
            <NavLink href="/users">{t('nav.users')}</NavLink>
            <NavLink href="/trips">{t('nav.trips')}</NavLink>
            <NavLink href="/wallets">{t('nav.wallets')}</NavLink>
            <NavLink href="/pricing">{t('nav.pricing')}</NavLink>
            <NavLink href="/tickets">{t('nav.tickets')}</NavLink>
            <NavLink href="/exports">{t('nav.exports')}</NavLink>
            <NavLink href="/audit">{t('nav.audit')}</NavLink>
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <form action={setLocaleAction}>
              <input type="hidden" name="locale" value={other} />
              <button type="submit" className={button.secondary} lang={other}>
                {t(`lang.${other}`)}
              </button>
            </form>
            <form action={logoutAction}>
              <button type="submit" className={button.secondary}>
                {t('auth.logout')}
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
