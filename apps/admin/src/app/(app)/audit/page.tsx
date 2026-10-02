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

/** Types d'éléments journalisés (valeurs de `entity` côté API). */
const ENTITIES = ['driver', 'document', 'user', 'wallet', 'pricing_rule', 'ticket', 'export'] as const;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ cursor?: string; entity?: string }> }) {
  const params = await searchParams;
  const { locale, t } = await getT();
  const entity = ENTITIES.find((e) => e === params.entity);
  const cursor = params.cursor && /^\d+$/.test(params.cursor) ? params.cursor : undefined;

  let page: Page<AuditEntry> = { items: [], nextCursor: null };
  let error: string | undefined;
  try {
    page = await api<Page<AuditEntry>>('/admin/audit', { query: { entity, cursor, limit: '30' } });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    error = e.code ?? 'UNKNOWN';
  }
  const nextHref = `/audit?${new URLSearchParams({ ...(entity ? { entity } : {}), ...(page.nextCursor ? { cursor: page.nextCursor } : {}) })}`;

  return (
    <>
      <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />
      {error && <Banner kind="error">{errorText(locale, error)}</Banner>}

      {/* Les consultations de documents remplissent vite le journal : le filtre retrouve une décision plus ancienne */}
      <form method="get" action="/audit" className="mb-4 flex items-end gap-2">
        <label className="text-xs text-muted">
          {t('audit.filter.label')}
          <select name="entity" defaultValue={entity ?? ''} className="mt-1 block rounded-md border border-line bg-card px-3 py-2 text-sm text-fg">
            <option value="">{t('audit.filter.all')}</option>
            {ENTITIES.map((value) => (
              <option key={value} value={value}>
                {labelOf(locale, 'audit.entity', value)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={button.secondary}>
          {t('audit.filter.apply')}
        </button>
      </form>

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
          <Link href={nextHref} className={button.secondary}>
            {t('common.nextPage')}
          </Link>
        </div>
      )}
    </>
  );
}
