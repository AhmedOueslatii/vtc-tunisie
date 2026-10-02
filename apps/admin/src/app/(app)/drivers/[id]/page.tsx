import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Flash } from '@/components/flash';
import { Badge, Banner, button, Card, docStatusTone, driverStatusTone, Field, inputClass, PageHeader } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { apiPublicUrl } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { formatDt } from '@/lib/format';
import { errorText, formatDate, labelOf } from '@/lib/intl';
import { type DocumentLinks, type DriverDetail, UUID, type WalletView } from '@/lib/types';
import { decideDriverAction, reviewDocumentAction } from './actions';
import { adjustAction, settleAction } from './wallet-actions';
import { CeilingMeter, walletStateTone } from '../../wallets/page';

export default async function DriverPage({
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

  let driver: DriverDetail;
  try {
    driver = await api<DriverDetail>(`/admin/drivers/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  // Les scans se chargent directement depuis l'API, par liens signés et temporaires (voir apps/api document-links.ts)
  let links: DocumentLinks['links'] = {};
  let linksError: string | undefined;
  if (driver.documents.length > 0) {
    try {
      ({ links } = await api<DocumentLinks>(`/admin/drivers/${id}/documents/links`, {
        method: 'POST',
        body: { documentIds: driver.documents.map((doc) => doc.id) },
      }));
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      linksError = e.code ?? 'UNKNOWN';
    }
  }
  // Portefeuille : un échec ne doit pas empêcher d'ouvrir le dossier
  let wallet: WalletView | undefined;
  try {
    wallet = await api<WalletView>(`/admin/drivers/${id}/wallet`, { query: { limit: '10' } });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
  }
  const fileUrl = (docId: string) => (links[docId] ? `${apiPublicUrl()}${links[docId]}` : undefined);

  const decidable = driver.status === 'pending_documents' || driver.status === 'under_review';
  const missing = driver.missingForApproval.map((type) => labelOf(locale, 'docType', type)).join(', ');

  return (
    <>
      <Link href="/drivers" className="mb-3 inline-block text-sm text-muted hover:underline">
        {t('common.back')}
      </Link>
      <PageHeader title={driver.fullName ?? t('drivers.unnamed')}>
        <Badge tone={driverStatusTone(driver.status)}>{labelOf(locale, 'driverStatus', driver.status)}</Badge>
      </PageHeader>
      <Flash notice={notice} error={error} />
      {linksError && <Banner kind="error">{errorText(locale, linksError)}</Banner>}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t('driver.identity')}>
          <dl className="grid grid-cols-2 gap-4">
            <Field label={t('driver.phone')}>
              <span dir="ltr" className="inline-block">
                {driver.phone}
              </span>
            </Field>
            <Field label={t('driver.cin')}>
              <span dir="ltr" className="inline-block">
                {driver.cin}
              </span>
            </Field>
            <Field label={t('driver.licenseNumber')}>
              <span dir="ltr" className="inline-block">
                {driver.licenseNumber}
              </span>
            </Field>
            <Field label={t('driver.licenseExpiry')}>{formatDate(driver.licenseExpiry, locale)}</Field>
          </dl>
          {driver.rejectionReason && (
            <p className="mt-4 text-sm text-red-700 dark:text-red-300">
              {t('driver.rejectionReason', { reason: driver.rejectionReason })}
            </p>
          )}
        </Card>

        <Card title={t('driver.vehicle')}>
          {driver.vehicle ? (
            <dl className="grid grid-cols-2 gap-4">
              <Field label={t('driver.vehicle')}>
                {driver.vehicle.make} {driver.vehicle.model} ({driver.vehicle.year})
              </Field>
              <Field label={t('driver.plate')}>
                <span dir="ltr" className="inline-block">
                  {driver.vehicle.plate}
                </span>
              </Field>
            </dl>
          ) : (
            <p className="text-sm text-muted">{t('driver.noVehicle')}</p>
          )}
        </Card>
      </div>

      {wallet && (
        <Card title={t('wallet.title')} className="mt-4">
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <dl className="grid grid-cols-3 gap-4">
                <Field label={t('wallet.balance')}>
                  <span dir="auto">{formatDt(wallet.balance, locale)}</span>
                </Field>
                <Field label={t('wallet.debt')}>
                  <span dir="auto">{wallet.debt > 0 ? formatDt(wallet.debt, locale) : t('wallet.noDebt')}</span>
                </Field>
                <Field label={t('wallet.ceiling')}>
                  <span dir="auto">{formatDt(wallet.ceiling, locale)}</span>
                </Field>
              </dl>
              <div className="mt-3 flex items-center gap-3">
                <CeilingMeter debt={wallet.debt} ceiling={wallet.ceiling} state={wallet.state} />
                <Badge tone={walletStateTone(wallet.state)}>{labelOf(locale, 'walletState', wallet.state)}</Badge>
              </div>

              <h3 className="mb-2 mt-5 text-xs font-semibold text-muted">{t('wallet.transactions')}</h3>
              {wallet.transactions.items.length === 0 ? (
                <p className="text-sm text-muted">{t('wallet.noTransactions')}</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {wallet.transactions.items.map((entry) => (
                    <li key={entry.id} className="flex items-start justify-between gap-3 py-2">
                      <span>
                        {labelOf(locale, 'walletTx', entry.type)}
                        <span className="block text-xs text-muted">
                          {formatDate(entry.createdAt, locale, true)}
                          {entry.note ? ` · ${entry.note}` : ''}
                        </span>
                      </span>
                      <span className="whitespace-nowrap font-medium" dir="auto">
                        {entry.amount > 0 ? '+' : ''}
                        {formatDt(entry.amount, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-3">
              <details className="rounded-md border border-line p-3">
                <summary className="cursor-pointer text-sm font-medium">{t('wallet.settle.title')}</summary>
                <form action={settleAction} className="mt-3 space-y-2">
                  <p className="text-xs text-muted">{t('wallet.settle.help')}</p>
                  <input type="hidden" name="driverId" value={driver.userId} />
                  <label className="block text-xs text-muted">
                    {t('wallet.amount')}
                    <input name="amount" required inputMode="decimal" dir="ltr" className={`${inputClass} mt-1 text-fg`} />
                  </label>
                  <label className="block text-xs text-muted">
                    {t('wallet.note')}
                    <input name="note" maxLength={300} className={`${inputClass} mt-1 text-fg`} />
                  </label>
                  <button type="submit" className={button.primary}>
                    {t('common.save')}
                  </button>
                </form>
              </details>

              <details className="rounded-md border border-line p-3">
                <summary className="cursor-pointer text-sm font-medium">{t('wallet.adjust.title')}</summary>
                <form action={adjustAction} className="mt-3 space-y-2">
                  <p className="text-xs text-muted">{t('wallet.adjust.help')}</p>
                  <input type="hidden" name="driverId" value={driver.userId} />
                  <label className="block text-xs text-muted">
                    {t('wallet.amount')}
                    <input name="amount" required inputMode="decimal" dir="ltr" placeholder="-5,000" className={`${inputClass} mt-1 text-fg`} />
                  </label>
                  <label className="block text-xs text-muted">
                    {t('driver.reason')}
                    <input name="reason" required minLength={3} maxLength={300} className={`${inputClass} mt-1 text-fg`} />
                  </label>
                  <button type="submit" className={button.danger}>
                    {t('common.save')}
                  </button>
                </form>
              </details>
            </div>
          </div>
        </Card>
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold text-muted">{t('driver.documents')}</h2>
      {driver.documents.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">{t('driver.noDocuments')}</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {driver.documents.map((doc) => (
            <Card key={doc.id}>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{labelOf(locale, 'docType', doc.type)}</p>
                  {doc.expiresAt && (
                    <p className="text-xs text-muted">{t('driver.expiresOn', { date: formatDate(doc.expiresAt, locale) })}</p>
                  )}
                </div>
                <Badge tone={docStatusTone(doc.status)}>{labelOf(locale, 'docStatus', doc.status)}</Badge>
              </div>

              {fileUrl(doc.id) &&
                (doc.mimeType?.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element -- scan servi par l'API (lien signé), pas un asset optimisable
                  <img
                    src={fileUrl(doc.id)}
                    alt={labelOf(locale, 'docType', doc.type)}
                    referrerPolicy="no-referrer"
                    className="h-72 w-full rounded-md border border-line bg-bg object-contain"
                  />
                ) : (
                  <object
                    data={fileUrl(doc.id)}
                    type={doc.mimeType ?? undefined}
                    aria-label={labelOf(locale, 'docType', doc.type)}
                    className="h-72 w-full rounded-md border border-line bg-bg"
                  />
                ))}
              {/* Passe par une route qui émet un lien neuf : celui de la page a pu expirer si la fiche est restée ouverte */}
              <a
                href={`/drivers/${driver.userId}/documents/${doc.id}/open`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs text-accent hover:underline"
              >
                {t('driver.openFile')}
              </a>

              {doc.rejectionReason && (
                <p className="mt-2 text-sm text-red-700 dark:text-red-300">
                  {t('driver.rejectionReason', { reason: doc.rejectionReason })}
                </p>
              )}

              {doc.status === 'pending' && (
                <div className="mt-4 flex flex-wrap items-start gap-2">
                  <form action={reviewDocumentAction}>
                    <input type="hidden" name="driverId" value={driver.userId} />
                    <input type="hidden" name="docId" value={doc.id} />
                    <input type="hidden" name="decision" value="approve" />
                    <button type="submit" className={button.primary}>
                      {t('driver.approveDocument')}
                    </button>
                  </form>
                  <details className="min-w-48 flex-1">
                    <summary className={`${button.danger} cursor-pointer list-none`}>{t('driver.rejectDocument')}</summary>
                    <form action={reviewDocumentAction} className="mt-2 space-y-2">
                      <input type="hidden" name="driverId" value={driver.userId} />
                      <input type="hidden" name="docId" value={doc.id} />
                      <input type="hidden" name="decision" value="reject" />
                      <label className="block text-xs text-muted" htmlFor={`reason-${doc.id}`}>
                        {t('driver.reason')}
                      </label>
                      <input id={`reason-${doc.id}`} name="reason" required minLength={3} maxLength={500} className={inputClass} />
                      <button type="submit" className={button.danger}>
                        {t('driver.rejectDocument')}
                      </button>
                    </form>
                  </details>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Card title={t('driver.decision')} className="mt-8">
        {decidable ? (
          <>
            {driver.missingForApproval.length > 0 && (
              <p className="mb-4 text-sm text-amber-800 dark:text-amber-300">{t('driver.missing', { list: missing })}</p>
            )}
            <div className="flex flex-wrap items-start gap-4">
              <form action={decideDriverAction}>
                <input type="hidden" name="driverId" value={driver.userId} />
                <input type="hidden" name="decision" value="approve" />
                <button type="submit" disabled={driver.missingForApproval.length > 0} className={button.primary}>
                  {t('driver.approveDriver')}
                </button>
              </form>
              <details className="min-w-64">
                <summary className={`${button.danger} cursor-pointer list-none`}>{t('driver.rejectDriver')}</summary>
                <form action={decideDriverAction} className="mt-2 space-y-2">
                  <input type="hidden" name="driverId" value={driver.userId} />
                  <input type="hidden" name="decision" value="reject" />
                  <label className="block text-xs text-muted" htmlFor="driver-reason">
                    {t('driver.reason')}
                  </label>
                  <input id="driver-reason" name="reason" required minLength={3} maxLength={500} className={inputClass} />
                  <button type="submit" className={button.danger}>
                    {t('driver.rejectDriver')}
                  </button>
                </form>
              </details>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">{t('driver.alreadyDecided')}</p>
        )}
      </Card>
    </>
  );
}
