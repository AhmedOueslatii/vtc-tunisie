import Link from 'next/link';
import { Banner, button, Card, PageHeader } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { describeAudit } from '@/lib/audit';
import { getT } from '@/lib/i18n';
import { errorText, formatDate, labelOf } from '@/lib/intl';
import { type AuditEntry, type Page, UUID } from '@/lib/types';

/** Page de l'élément concerné par l'action, quand il en existe une. */
function targetOf(entry: AuditEntry): string | undefined {
  const details = typeof entry.details === 'object' && entry.details !== null ? (entry.details as Record<string, unknown>) : {};
  if (entry.entity === 'driver' && UUID.test(entry.entityId)) return `/drivers/${entry.entityId}`;
  if (entry.entity === 'document' && typeof details.driverId === 'string' && UUID.test(details.driverId)) return `/drivers/${details.driverId}`;
  if (entry.entity === 'pricing_rule') return '/pricing';
  if (entry.entity === 'ticket') return '/tickets';
  return undefined;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const { locale, t } = await getT();

  let page: Page<AuditEntry> = { items: [], nextCursor: null };
  let error: string | undefined;
  try {
    page = await api<Page<AuditEntry>>('/admin/audit', { query: { cursor: cursor && /^\d+$/.test(cursor) ? cursor : undefined, limit: '30' } });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    error = e.code ?? 'UNKNOWN';
  }

  return (
    <>
      <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />
      {error && <Banner kind="error">{errorText(locale, error)}</Banner>}

      <Card className="overflow-x-auto p-0">
        {page.items.length === 0 && !error ? (
          <p className="p-6 text-center text-sm text-muted">{t('audit.empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                {(['date', 'admin', 'action', 'details'] as const).map((column) => (
                  <th key={column} scope="col" className="px-4 py-3 text-start font-medium">
                    {t(`audit.col.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.items.map((entry) => {
                const target = targetOf(entry);
                const action = labelOf(locale, 'audit.action', entry.action);
                return (
                  <tr key={entry.id} className="border-b border-line align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-3">{formatDate(entry.at, locale, true)}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{entry.admin.fullName ?? t('common.none')}</p>
                      <p className="text-xs text-muted" dir="ltr">
                        <span className="inline-block">{entry.admin.phone}</span>
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {target ? (
                        <Link href={target} className="text-accent hover:underline">
                          {action}
                        </Link>
                      ) : (
                        action
                      )}
                    </td>
                    <td className="max-w-md px-4 py-3 text-muted">{describeAudit(entry.action, entry.details, locale)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {page.nextCursor && (
        <div className="mt-4 text-end">
          <Link href={`/audit?cursor=${page.nextCursor}`} className={button.secondary}>
            {t('common.nextPage')}
          </Link>
        </div>
      )}
    </>
  );
}
