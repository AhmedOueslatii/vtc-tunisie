import Link from 'next/link';
import { Badge, Banner, button, Card, inputClass, PageHeader } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { getT } from '@/lib/i18n';
import { errorText, formatDate, labelOf } from '@/lib/intl';
import { type Page, roleOf, type UserRole, type UserRow, type UserStatus } from '@/lib/types';

const ROLES: UserRole[] = ['passenger', 'driver', 'admin'];
const STATUSES: UserStatus[] = ['active', 'suspended'];

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; status?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const { locale, t } = await getT();
  const q = params.q?.trim().slice(0, 80) || undefined;
  const role = ROLES.find((r) => r === params.role);
  const status = STATUSES.find((s) => s === params.status);
  const cursor = params.cursor && !Number.isNaN(Date.parse(params.cursor)) ? params.cursor : undefined;

  let page: Page<UserRow> = { items: [], nextCursor: null };
  let error: string | undefined;
  try {
    page = await api<Page<UserRow>>('/admin/users', { query: { q, role, status, cursor, limit: '20' } });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    error = e.code ?? 'UNKNOWN';
  }

  const nextHref = (() => {
    const search = new URLSearchParams(Object.entries({ q, role, status, cursor: page.nextCursor ?? undefined }).filter((e): e is [string, string] => e[1] !== undefined));
    return `/users?${search}`;
  })();
  const select = 'rounded-md border border-line bg-card px-3 py-2 text-sm';

  return (
    <>
      <PageHeader title={t('users.title')} subtitle={t('users.subtitle')} />
      {error && <Banner kind="error">{errorText(locale, error)}</Banner>}

      <form method="get" action="/users" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="min-w-56 flex-1 text-xs text-muted">
          {t('users.search')}
          <input name="q" defaultValue={q} maxLength={80} className={`${inputClass} mt-1 text-fg`} />
        </label>
        <select name="role" defaultValue={role ?? ''} aria-label={t('users.col.role')} className={select}>
          <option value="">{t('users.filter.allRoles')}</option>
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {labelOf(locale, 'role', value)}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status ?? ''} aria-label={t('users.col.status')} className={select}>
          <option value="">{t('users.filter.allStatuses')}</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {labelOf(locale, 'userStatus', value)}
            </option>
          ))}
        </select>
        <button type="submit" className={button.primary}>
          {t('users.searchButton')}
        </button>
      </form>

      <Card className="overflow-x-auto p-0">
        {page.items.length === 0 && !error ? (
          <p className="p-6 text-center text-sm text-muted">{t('users.empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                {(['user', 'role', 'status', 'createdAt', 'rating'] as const).map((column) => (
                  <th key={column} scope="col" className="px-4 py-3 text-start font-medium">
                    {t(`users.col.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.items.map((user) => (
                <tr key={user.id} className="border-b border-line last:border-0 hover:bg-bg">
                  <td className="px-4 py-3">
                    <Link href={`/users/${user.id}`} className="font-medium text-accent hover:underline">
                      {user.fullName ?? t('drivers.unnamed')}
                    </Link>
                    <p className="text-xs text-muted" dir="ltr">
                      <span className="inline-block">{user.phone}</span>
                    </p>
                  </td>
                  <td className="px-4 py-3">{labelOf(locale, 'role', roleOf(user))}</td>
                  <td className="px-4 py-3">
                    <Badge tone={user.status === 'active' ? 'success' : user.status === 'suspended' ? 'danger' : 'neutral'}>
                      {labelOf(locale, 'userStatus', user.status)}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{formatDate(user.createdAt, locale)}</td>
                  <td className="px-4 py-3">{user.ratingAvg ? `${user.ratingAvg} / 5 (${user.ratingCount})` : t('common.none')}</td>
                </tr>
              ))}
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
