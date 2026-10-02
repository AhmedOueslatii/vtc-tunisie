import Link from 'next/link';
import { BarChart, type BarPoint } from '@/components/bar-chart';
import { StatTile } from '@/components/stat-tile';
import { Banner, Card, PageHeader } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { niceScale } from '@/lib/chart';
import { formatDt, formatNumber, formatPercent } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { errorText, formatDate } from '@/lib/intl';
import type { Overview } from '@/lib/types';

const PERIODS = [7, 30, 90] as const;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { locale, t } = await getT();
  const requested = Number((await searchParams).days);
  const days = PERIODS.find((d) => d === requested) ?? 7;

  let overview: Overview | undefined;
  let error: string | undefined;
  try {
    overview = await api<Overview>('/admin/stats/overview', { query: { days: String(days) } });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    error = e.code ?? 'UNKNOWN';
  }

  const n = (value: number) => formatNumber(value, locale);
  const dayFormat = (day: string, long: boolean) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-TN-u-nu-latn' : 'fr-TN', {
      day: 'numeric',
      month: long ? 'long' : 'short',
      ...(long ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    }).format(new Date(`${day}T00:00:00Z`));

  return (
    <>
      <PageHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />
      {error && <Banner kind="error">{errorText(locale, error)}</Banner>}

      {overview && (
        <>
          <h2 className="mb-3 text-sm font-semibold text-muted">{t('dashboard.live')}</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={t('dashboard.tile.activeTrips')} value={n(overview.live.activeTrips)} href="/trips?status=active" />
            <StatTile label={t('dashboard.tile.availableDrivers')} value={n(overview.live.availableDrivers)} />
            <StatTile label={t('dashboard.tile.pendingDrivers')} value={n(overview.live.pendingDrivers)} href="/drivers" />
            <StatTile label={t('dashboard.tile.openTickets')} value={n(overview.live.openTickets)} href="/tickets?status=open" />
          </div>

          <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-muted">{t('dashboard.indicators')}</h2>
            <nav className="flex gap-2" aria-label={t('dashboard.indicators')}>
              {PERIODS.map((period) => (
                <Link
                  key={period}
                  href={period === 7 ? '/' : `/?days=${period}`}
                  aria-current={period === days ? 'page' : undefined}
                  className={`rounded-full border px-3 py-1 text-sm ${period === days ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-card text-muted hover:text-fg'}`}
                >
                  {t('dashboard.period', { days: period })}
                </Link>
              ))}
            </nav>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label={t('dashboard.tile.completed')}
              value={n(overview.totals.completed)}
              hint={t('dashboard.tile.completedHint', {
                completed: n(overview.totals.completed),
                requested: n(overview.totals.requested),
                rate: overview.totals.completionRate === null ? '—' : formatPercent(overview.totals.completionRate, locale),
              })}
            />
            <StatTile label={t('dashboard.tile.revenue')} value={formatDt(overview.totals.grossRevenue, locale)} />
            <StatTile
              label={t('dashboard.tile.commission')}
              value={formatDt(overview.totals.estimatedCommission, locale)}
              hint={t('dashboard.tile.commissionHint')}
            />
            <StatTile
              label={t('dashboard.tile.avgPrice')}
              value={overview.totals.averagePrice === null ? '—' : formatDt(overview.totals.averagePrice, locale)}
            />
            <StatTile
              label={t('dashboard.tile.cancellations')}
              value={n(overview.totals.cancelledByPassenger + overview.totals.cancelledByDriver + overview.totals.noDriverFound)}
              hint={t('dashboard.tile.cancellationsHint', {
                passenger: n(overview.totals.cancelledByPassenger),
                driver: n(overview.totals.cancelledByDriver),
                none: n(overview.totals.noDriverFound),
              })}
            />
            <StatTile
              label={t('dashboard.tile.newAccounts')}
              value={n(overview.newUsers.passengers)}
              hint={t('dashboard.tile.newAccountsHint', { drivers: n(overview.newUsers.drivers) })}
            />
          </div>

          {charts(overview)}
        </>
      )}
    </>
  );

  function charts(data: Overview) {
    if (data.totals.requested === 0) {
      return (
        <Card className="mt-6">
          <p className="text-center text-sm text-muted">{t('chart.noData')}</p>
        </Card>
      );
    }

    const tripsScale = niceScale(Math.max(...data.daily.map((d) => d.completed)), 4, true);
    const revenueScale = niceScale(Math.max(...data.daily.map((d) => d.revenue)) / 1000, 4);

    const tripPoints: BarPoint[] = data.daily.map((d) => ({
      key: d.day,
      label: dayFormat(d.day, false),
      title: dayFormat(d.day, true),
      value: d.completed,
      valueLabel: n(d.completed),
      rows: [
        { label: t('chart.completed'), value: n(d.completed) },
        { label: t('chart.requested'), value: n(d.requested) },
      ],
    }));
    const revenuePoints: BarPoint[] = data.daily.map((d) => ({
      key: d.day,
      label: dayFormat(d.day, false),
      title: dayFormat(d.day, true),
      value: d.revenue / 1000,
      valueLabel: formatNumber(d.revenue / 1000, locale, d.revenue % 1000 === 0 ? 0 : 1),
      rows: [{ label: t('chart.revenue'), value: formatDt(d.revenue, locale) }],
    }));
    const hint = t('chart.keyboardHint');

    return (
      <>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card title={t('chart.completedPerDay')}>
            <BarChart
              title={t('chart.completedPerDay')}
              points={tripPoints}
              yMax={tripsScale.max}
              yTicks={tripsScale.ticks.map((value) => ({ value, label: n(value) }))}
              hint={hint}
            />
          </Card>
          <Card title={t('chart.revenuePerDay')}>
            <BarChart
              title={t('chart.revenuePerDay')}
              points={revenuePoints}
              yMax={revenueScale.max}
              yTicks={revenueScale.ticks.map((value) => ({ value, label: formatNumber(value, locale) }))}
              hint={hint}
            />
          </Card>
        </div>

        <details className="mt-4 rounded-lg border border-line bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium">{t('chart.showTable')}</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t('chart.day')}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t('chart.requested')}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t('chart.completed')}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t('chart.revenue')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...data.daily].reverse().map((d) => (
                  <tr key={d.day} className="border-t border-line">
                    <th scope="row" className="py-2 text-start font-normal">
                      {formatDate(`${d.day}T12:00:00+01:00`, locale)}
                    </th>
                    <td className="py-2">{n(d.requested)}</td>
                    <td className="py-2">{n(d.completed)}</td>
                    <td className="py-2">{formatDt(d.revenue, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </>
    );
  }
}
