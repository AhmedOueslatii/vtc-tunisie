import { Flash } from '@/components/flash';
import { button, Card, inputClass, PageHeader } from '@/components/ui';
import { getT } from '@/lib/i18n';

const DAY_MS = 86_400_000;
const tunisDay = (daysAgo: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date(Date.now() - daysAgo * DAY_MS));

export default async function ExportsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { t } = await getT();

  return (
    <>
      <PageHeader title={t('exports.title')} subtitle={t('exports.subtitle')} />
      <Flash error={error} />

      {/* Formulaire GET : les dates partent dans l'URL du téléchargement, qui passe par le serveur du back-office (jeton admin) */}
      <form method="get" className="space-y-4">
        <Card>
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-xs text-muted">
              {t('exports.from')}
              <input type="date" name="from" required defaultValue={tunisDay(29)} dir="ltr" className={`${inputClass} mt-1 w-44 text-fg`} />
            </label>
            <label className="text-xs text-muted">
              {t('exports.to')}
              <input type="date" name="to" required defaultValue={tunisDay(0)} dir="ltr" className={`${inputClass} mt-1 w-44 text-fg`} />
            </label>
          </div>
          <p className="mt-3 text-xs text-muted">{t('exports.range')}</p>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card title={t('exports.trips')}>
            <p className="mb-4 text-sm text-muted">{t('exports.tripsHelp')}</p>
            <button type="submit" formAction="/exports/trips" className={button.primary}>
              {t('exports.download')} (CSV)
            </button>
          </Card>
          <Card title={t('exports.earnings')}>
            <p className="mb-4 text-sm text-muted">{t('exports.earningsHelp')}</p>
            <button type="submit" formAction="/exports/driver-earnings" className={button.primary}>
              {t('exports.download')} (CSV)
            </button>
          </Card>
        </div>
      </form>
    </>
  );
}
