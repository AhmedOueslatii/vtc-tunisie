import Link from 'next/link';
import { Badge, Banner, button, Card, PageHeader, tripStatusTone } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDt } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { errorText, formatDate, labelOf } from '@/lib/intl';
import { type Page, TRIP_FILTERS, type TripRow } from '@/lib/types';

export default async function TripsPage({ searchParams }: { searchParams: Promise<{ status?: string; cursor?: string }> }) {
  const params = await searchParams;
  const { locale, t } = await getT();
  const status = TRIP_FILTERS.find((s) => s === params.status);
  const cursor = params.cursor && !Number.isNaN(Date.parse(params.cursor)) ? params.cursor : undefined;

  let page: Page<TripRow> = { items: [], nextCursor: null };
  let error: string | undefined;
  try {
    page = await api<Page<TripRow>>('/admin/trips', { query: { status, cursor, limit: '20' } });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    error = e.code ?? 'UNKNOWN';
  }

  const hrefFor = (query: Record<string, string | undefined>) => {
    const search = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => e[1] !== undefined));
    return `/trips${search.size ? `?${search}` : ''}`;
  };
  const tabs = [
    { value: undefined, label: t('trips.filter.all') },
    ...TRIP_FILTERS.map((value) => ({
      value,
      label: value === 'active' ? t('trips.filter.active') : labelOf(locale, 'tripStatus', value),
    })),
  ];
  const person = (p: { fullName: string | null; phone: string }) => (
    <>
      <p className="font-medium">{p.fullName ?? t('common.none')}</p>
      <p className="text-xs text-muted" dir="ltr">
        <span className="inline-block">{p.phone}</span>
      </p>
    </>
  );

  return (
    <>
      <PageHeader title={t('trips.title')} subtitle={t('trips.subtitle')} />
      {error && <Banner kind="error">{errorText(locale, error)}</Banner>}

      <nav className="mb-4 flex flex-wrap gap-2" aria-label={t('trips.col.status')}>
        {tabs.map((tab) => (
          <Link
            key={tab.value ?? 'all'}
            href={hrefFor({ status: tab.value })}
            aria-current={tab.value === status ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${tab.value === status ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-card text-muted hover:text-fg'}`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <Card className="overflow-x-auto p-0">
        {page.items.length === 0 && !error ? (
          <p className="p-6 text-center text-sm text-muted">{t('trips.empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                {(['date', 'route', 'passenger', 'driver', 'price', 'status'] as const).map((column) => (
                  <th key={column} scope="col" className="px-4 py-3 text-start font-medium">
                    {t(`trips.col.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.items.map((trip) => (
                <tr key={trip.id} className="border-b border-line align-top last:border-0 hover:bg-bg">
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link href={`/trips/${trip.id}`} className="text-accent hover:underline">
                      {formatDate(trip.requestedAt, locale, true)}
                    </Link>
                  </td>
                  <td className="max-w-xs px-4 py-3">
                    <p className="break-words">{trip.pickupAddress ?? t('common.none')}</p>
                    <p className="break-words text-xs text-muted">→ {trip.dropoffAddress ?? t('common.none')}</p>
                  </td>
                  <td className="px-4 py-3">{person(trip.passenger)}</td>
                  <td className="px-4 py-3">{trip.driver ? person(trip.driver) : <span className="text-muted">{t('trips.noDriver')}</span>}</td>
                  <td className="whitespace-nowrap px-4 py-3" dir="auto">
                    {formatDt(trip.finalPrice ?? trip.quotedPrice, locale)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={tripStatusTone(trip.status)}>{labelOf(locale, 'tripStatus', trip.status)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {page.nextCursor && (
        <div className="mt-4 text-end">
          <Link href={hrefFor({ status, cursor: page.nextCursor })} className={button.secondary}>
            {t('common.nextPage')}
          </Link>
        </div>
      )}
    </>
  );
}
