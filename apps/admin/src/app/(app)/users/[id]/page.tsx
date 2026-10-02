import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Flash } from '@/components/flash';
import { Badge, button, Card, driverStatusTone, Field, inputClass, PageHeader } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { getT } from '@/lib/i18n';
import { formatDate, labelOf } from '@/lib/intl';
import { roleOf, type UserDetail, UUID } from '@/lib/types';
import { reactivateAction, suspendAction } from './actions';

export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { id } = await params;
  const { notice, error } = await searchParams;
  if (!UUID.test(id)) notFound();
  const { locale, t } = await getT();

  let user: UserDetail;
  try {
    user = await api<UserDetail>(`/admin/users/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const suspended = user.status === 'suspended';

  return (
    <>
      <Link href="/users" className="mb-3 inline-block text-sm text-muted hover:underline">
        {t('common.back')}
      </Link>
      <PageHeader title={user.fullName ?? t('drivers.unnamed')} subtitle={labelOf(locale, 'role', roleOf(user))}>
        <Badge tone={suspended ? 'danger' : 'success'}>{labelOf(locale, 'userStatus', user.status)}</Badge>
      </PageHeader>
      <Flash notice={notice} error={error} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t('user.title')}>
          <dl className="grid grid-cols-2 gap-4">
            <Field label={t('user.phone')}>
              <span dir="ltr" className="inline-block">
                {user.phone}
              </span>
            </Field>
            <Field label={t('user.email')}>{user.email ?? t('common.none')}</Field>
            <Field label={t('user.locale')}>{labelOf(locale, 'lang', user.locale)}</Field>
            <Field label={t('user.createdAt')}>{formatDate(user.createdAt, locale)}</Field>
            <Field label={t('user.rating')}>
              {user.ratingAvg ? (
                <>
                  {user.ratingAvg} / 5 <span className="text-xs font-normal text-muted">{t('user.ratingCount', { count: user.ratingCount })}</span>
                </>
              ) : (
                t('common.none')
              )}
            </Field>
          </dl>
        </Card>

        <Card title={t('user.trips')}>
          <ul className="space-y-1 text-sm">
            <li>{t('user.tripsAsPassenger', { count: user.trips.asPassenger })}</li>
            <li>{t('user.tripsAsDriver', { count: user.trips.asDriver })}</li>
          </ul>
          {user.activeTripId && (
            <p className="mt-3 text-sm">
              <Link href={`/trips/${user.activeTripId}`} className="text-accent hover:underline">
                {t('user.activeTrip')} →
              </Link>
            </p>
          )}
          {user.driver && (
            <p className="mt-3 flex items-center gap-2 text-sm">
              <Link href={`/drivers/${user.id}`} className="text-accent hover:underline">
                {t('user.driverFile')} →
              </Link>
              <Badge tone={driverStatusTone(user.driver.status)}>{labelOf(locale, 'driverStatus', user.driver.status)}</Badge>
            </p>
          )}
        </Card>
      </div>

      {suspended && (
        <Card className="mt-4">
          <p className="text-sm font-medium text-red-700 dark:text-red-300">
            {user.suspendedAt ? t('user.suspendedOn', { date: formatDate(user.suspendedAt, locale, true) }) : null}
          </p>
          {user.suspensionReason && <p className="mt-1 text-sm">{t('user.suspensionReason', { reason: user.suspensionReason })}</p>}
        </Card>
      )}

      <Card title={suspended ? t('user.reactivate.title') : t('user.suspend.title')} className="mt-4">
        {user.isAdmin ? (
          <p className="text-sm text-muted">{t('errors.CANNOT_SUSPEND_ADMIN')}</p>
        ) : suspended ? (
          <form action={reactivateAction} className="space-y-3">
            <p className="text-sm text-muted">{t('user.reactivate.help')}</p>
            <input type="hidden" name="userId" value={user.id} />
            <button type="submit" className={button.primary}>
              {t('user.reactivate.button')}
            </button>
          </form>
        ) : (
          <form action={suspendAction} className="space-y-3">
            <p className="text-sm text-muted">{t('user.suspend.help')}</p>
            <input type="hidden" name="userId" value={user.id} />
            <label className="block text-xs text-muted">
              {t('driver.reason')}
              <input name="reason" required minLength={3} maxLength={300} className={`${inputClass} mt-1 max-w-xl text-fg`} />
            </label>
            <button type="submit" className={button.danger}>
              {t('user.suspend.button')}
            </button>
          </form>
        )}
      </Card>
    </>
  );
}
