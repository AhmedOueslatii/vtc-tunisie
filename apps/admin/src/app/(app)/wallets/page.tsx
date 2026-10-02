import Link from 'next/link';
import { Badge, Banner, Card, PageHeader, type Tone } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDt, formatPercent } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { errorText, labelOf } from '@/lib/intl';
import type { DebtsView, WalletState } from '@/lib/types';

export const walletStateTone = (state: WalletState): Tone => ({ ok: 'success', warning: 'warning', blocked: 'danger' })[state] as Tone;

/** Barre de part du plafond : la couleur suit l'état, qui est aussi écrit en toutes lettres à côté (jamais la couleur seule). */
export function CeilingMeter({ debt, ceiling, state }: { debt: number; ceiling: number; state: WalletState }) {
  const share = Math.min(1, ceiling > 0 ? debt / ceiling : 0);
  const color = { ok: 'bg-emerald-500', warning: 'bg-amber-500', blocked: 'bg-red-500' }[state];
  return (
    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-line" role="presentation">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.round(share * 100)}%` }} />
    </div>
  );
}

export default async function WalletsPage() {
  const { locale, t } = await getT();

  let view: DebtsView = { ceiling: 0, items: [] };
  let error: string | undefined;
  try {
    view = await api<DebtsView>('/admin/wallets/debts', { query: { limit: '100' } });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    error = e.code ?? 'UNKNOWN';
  }

  return (
    <>
      <PageHeader title={t('wallets.title')} subtitle={t('wallets.subtitle')} />
      {error && <Banner kind="error">{errorText(locale, error)}</Banner>}
      {!error && <p className="mb-3 text-sm text-muted">{t('wallets.ceiling', { amount: formatDt(view.ceiling, locale) })}</p>}

      <Card className="overflow-x-auto p-0">
        {view.items.length === 0 && !error ? (
          <p className="p-6 text-center text-sm text-muted">{t('wallets.empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                {(['driver', 'debt', 'share', 'state'] as const).map((column) => (
                  <th key={column} scope="col" className="px-4 py-3 text-start font-medium">
                    {t(`wallets.col.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.items.map((item) => (
                <tr key={item.driverId} className="border-b border-line last:border-0 hover:bg-bg">
                  <td className="px-4 py-3">
                    <Link href={`/drivers/${item.driverId}`} className="font-medium text-accent hover:underline">
                      {item.fullName ?? t('drivers.unnamed')}
                    </Link>
                    <p className="text-xs text-muted" dir="ltr">
                      <span className="inline-block">{item.phone}</span>
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-medium" dir="auto">
                    {formatDt(item.debt, locale)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <CeilingMeter debt={item.debt} ceiling={view.ceiling} state={item.state} />
                      <span className="text-xs text-muted">{formatPercent(Math.min(item.debt / view.ceiling, 9.99), locale)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={walletStateTone(item.state)}>{labelOf(locale, 'walletState', item.state)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
