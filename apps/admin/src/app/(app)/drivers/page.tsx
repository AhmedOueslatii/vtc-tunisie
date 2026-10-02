import Link from 'next/link';
import { Badge, Banner, Card, driverStatusTone, PageHeader } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { getT } from '@/lib/i18n';
import { errorText, formatDate, labelOf } from '@/lib/intl';
import type { PendingDriver } from '@/lib/types';

export default async function DriversPage() {
  const { locale, t } = await getT();

  let drivers: PendingDriver[] = [];
  let error: string | undefined;
  try {
    drivers = await api<PendingDriver[]>('/admin/drivers/pending');
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    error = e.code ?? 'UNKNOWN';
  }
  // File d'attente : les dossiers les plus anciens d'abord
  drivers.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <>
      <PageHeader title={t('drivers.title')} subtitle={t('drivers.subtitle')} />
      {error && <Banner kind="error">{errorText(locale, error)}</Banner>}

      <Card className="overflow-x-auto p-0">
        {drivers.length === 0 && !error ? (
          <p className="p-6 text-center text-sm text-muted">{t('drivers.empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-start text-xs text-muted">
              <tr>
                {(['driver', 'phone', 'status', 'licenseExpiry', 'createdAt'] as const).map((column) => (
                  <th key={column} scope="col" className="px-4 py-3 text-start font-medium">
                    {t(`drivers.col.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drivers.map((driver) => (
                <tr key={driver.userId} className="border-b border-line last:border-0 hover:bg-bg">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/drivers/${driver.userId}`} className="text-accent hover:underline">
                      {driver.fullName ?? t('drivers.unnamed')}
                    </Link>
                  </td>
                  <td className="px-4 py-3" dir="ltr">
                    <span className="inline-block text-start">{driver.phone}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={driverStatusTone(driver.status)}>{labelOf(locale, 'driverStatus', driver.status)}</Badge>
                  </td>
                  <td className="px-4 py-3">{formatDate(driver.licenseExpiry, locale)}</td>
                  <td className="px-4 py-3">{formatDate(driver.createdAt, locale, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
