import { LoginForm } from '@/components/login-form';
import { Card } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { labelsFor } from '@/lib/intl';

export default async function LoginPage() {
  const { locale, t } = await getT();
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-sm">
        <p className="mb-2 text-center text-sm text-muted">{t('app.name')}</p>
        <Card>
          <h1 className="mb-4 text-lg font-semibold">{t('auth.title')}</h1>
          <LoginForm labels={labelsFor(locale, 'auth.', 'errors.')} />
        </Card>
      </div>
    </main>
  );
}
