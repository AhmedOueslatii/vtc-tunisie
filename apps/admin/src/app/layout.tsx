import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { directionOf } from '@/lib/intl';
import { getLocale, getT } from '@/lib/i18n';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('app.name'), robots: { index: false, follow: false } };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={directionOf(locale)}>
      <body>{children}</body>
    </html>
  );
}
