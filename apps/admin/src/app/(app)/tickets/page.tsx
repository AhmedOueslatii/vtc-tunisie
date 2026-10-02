import Link from 'next/link';
import { Flash } from '@/components/flash';
import { Badge, Banner, button, Card, PageHeader, ticketStatusTone } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { getT } from '@/lib/i18n';
import { errorText, formatDate, labelOf } from '@/lib/intl';
import { type Page, TICKET_STATUSES, type Ticket, type TicketStatus } from '@/lib/types';
import { updateTicketAction } from './actions';

const PAGE_SIZE = '20';

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cursor?: string; notice?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { locale, t } = await getT();
  const status = TICKET_STATUSES.find((s) => s === params.status);
  // Le curseur est une date ISO produite par l'API ; toute autre valeur est ignorée
  const cursor = params.cursor && !Number.isNaN(Date.parse(params.cursor)) ? params.cursor : undefined;

  let page: Page<Ticket> = { items: [], nextCursor: null };
  let error: string | undefined;
  try {
    page = await api<Page<Ticket>>('/admin/tickets', { query: { status, cursor, limit: PAGE_SIZE } });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    error = e.code ?? 'UNKNOWN';
  }

  const hrefFor = (query: Record<string, string | undefined>) => {
    const search = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => e[1] !== undefined));
    return `/tickets${search.size ? `?${search}` : ''}`;
  };
  const returnTo = hrefFor({ status, cursor });
  const tabs: { value: TicketStatus | undefined; label: string }[] = [
    { value: undefined, label: t('tickets.filter.all') },
    ...TICKET_STATUSES.map((value) => ({ value, label: labelOf(locale, 'ticketStatus', value) })),
  ];

  return (
    <>
      <PageHeader title={t('tickets.title')} subtitle={t('tickets.subtitle')} />
      <Flash notice={params.notice} error={params.error} />
      {error && <Banner kind="error">{errorText(locale, error)}</Banner>}

      <nav className="mb-4 flex flex-wrap gap-2" aria-label={t('tickets.col.status')}>
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
          <p className="p-6 text-center text-sm text-muted">{t('tickets.empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                {(['category', 'description', 'reporter', 'trip', 'createdAt', 'status'] as const).map((column) => (
                  <th key={column} scope="col" className="px-4 py-3 text-start font-medium">
                    {t(`tickets.col.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.items.map((ticket) => (
                <tr key={ticket.id} className="border-b border-line align-top last:border-0">
                  <td className="px-4 py-3">{labelOf(locale, 'ticketCategory', ticket.category)}</td>
                  <td className="max-w-sm px-4 py-3">
                    <p className="whitespace-pre-wrap break-words">{ticket.description}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{ticket.reporter.fullName ?? t('common.none')}</p>
                    <p className="text-xs text-muted" dir="ltr">
                      <span className="inline-block">{ticket.reporter.phone}</span>
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted" dir="ltr">
                    <span className="inline-block">{ticket.tripId ? ticket.tripId.slice(0, 8) : t('common.none')}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{formatDate(ticket.createdAt, locale, true)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={ticketStatusTone(ticket.status)}>{labelOf(locale, 'ticketStatus', ticket.status)}</Badge>
                    <form action={updateTicketAction} className="mt-2 flex items-center gap-2">
                      <input type="hidden" name="id" value={ticket.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <select
                        name="status"
                        defaultValue={ticket.status}
                        aria-label={t('tickets.col.status')}
                        className="rounded-md border border-line bg-card px-2 py-1 text-xs"
                      >
                        {TICKET_STATUSES.map((value) => (
                          <option key={value} value={value}>
                            {labelOf(locale, 'ticketStatus', value)}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className={button.secondary}>
                        {t('common.save')}
                      </button>
                    </form>
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
