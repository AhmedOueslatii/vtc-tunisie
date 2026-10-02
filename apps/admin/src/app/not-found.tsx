import Link from 'next/link';
import { getT } from '@/lib/i18n';

export default async function NotFound() {
  const { t } = await getT();
  return (
    <main className="grid min-h-screen place-items-center p-4 text-center">
      <div>
        <p className="text-sm text-muted">404</p>
        <p className="mt-1 font-medium">{t('errors.NOT_FOUND')}</p>
        <Link href="/" className="mt-4 inline-block text-sm text-accent underline">
          {t('common.back')}
        </Link>
      </div>
    </main>
  );
}
