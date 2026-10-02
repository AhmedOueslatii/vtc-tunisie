import { Flash } from '@/components/flash';
import { Badge, button, Card, inputClass, PageHeader } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDt } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { labelOf } from '@/lib/intl';
import { exampleFare, toDinarsInput, toPercentInput } from '@/lib/money';
import type { PricingRule } from '@/lib/types';
import { updatePricingAction } from './actions';

const MONEY_FIELDS = ['baseFare', 'perKm', 'perMinute', 'minimumFare', 'bookingFee', 'cancellationFee'] as const;
const EXAMPLE = { km: 10, minutes: 20 };

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { notice, error } = await searchParams;
  const { locale, t } = await getT();

  let rules: PricingRule[] = [];
  let loadError: string | undefined;
  try {
    rules = await api<PricingRule[]>('/admin/pricing/rules');
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    loadError = e.code ?? 'UNKNOWN';
  }

  return (
    <>
      <PageHeader title={t('pricing.title')} subtitle={t('pricing.subtitle')} />
      <Flash notice={notice} error={error ?? loadError} />

      <div className="space-y-4">
        {rules.map((rule) => (
          <Card key={rule.id}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">
                {labelOf(locale, 'vehicleCategory', rule.category)}
                <span className="font-normal text-muted">
                  {' — '}
                  {rule.zone ? t('pricing.zone', { zone: rule.zone.name }) : t('pricing.default')}
                </span>
              </h2>
              {!rule.isActive && <Badge tone="warning">{t('pricing.inactive')}</Badge>}
            </div>

            <form action={updatePricingAction} className="space-y-4">
              <input type="hidden" name="id" value={rule.id} />
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {MONEY_FIELDS.map((field) => (
                  <label key={field} className="block text-xs text-muted">
                    {t(`pricing.field.${field}`)}
                    <input
                      name={field}
                      defaultValue={toDinarsInput(rule[field])}
                      inputMode="decimal"
                      required
                      dir="ltr"
                      className={`${inputClass} mt-1 text-fg`}
                    />
                  </label>
                ))}
                <label className="block text-xs text-muted">
                  {t('pricing.field.commissionBps')}
                  <input
                    name="commissionBps"
                    defaultValue={toPercentInput(rule.commissionBps)}
                    inputMode="decimal"
                    required
                    dir="ltr"
                    className={`${inputClass} mt-1 text-fg`}
                  />
                </label>
              </div>

              {rule.zone && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="hidden" name="hasActiveToggle" value="1" />
                  <input type="checkbox" name="isActive" defaultChecked={rule.isActive} className="size-4 accent-[var(--accent)]" />
                  {t('pricing.field.isActive')}
                </label>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted">
                  {t('pricing.example', {
                    km: EXAMPLE.km,
                    min: EXAMPLE.minutes,
                    price: formatDt(exampleFare(rule, EXAMPLE.km, EXAMPLE.minutes), locale),
                  })}
                </p>
                <button type="submit" className={button.primary}>
                  {t('common.save')}
                </button>
              </div>
            </form>
          </Card>
        ))}
      </div>
    </>
  );
}
