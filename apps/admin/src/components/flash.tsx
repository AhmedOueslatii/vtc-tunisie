import { getLocale } from '@/lib/i18n';
import { createT, errorText } from '@/lib/intl';
import type { MessageKey } from '@/lib/messages';
import { Banner } from './ui';

/** Messages de retour d'une action (`?notice=…` / `?error=…`). Seules des clés connues sont affichées, jamais du texte libre de l'URL. */
export async function Flash({ notice, error }: { notice?: string; error?: string }) {
  const locale = await getLocale();
  const t = createT(locale);
  const noticeKey = `notice.${notice}` as MessageKey;
  const known = notice !== undefined && ['driver_approved', 'driver_rejected', 'doc_approved', 'doc_rejected', 'ticket_updated', 'pricing_updated', 'wallet_settled', 'wallet_adjusted', 'user_suspended', 'user_reactivated'].includes(notice);

  return (
    <>
      {error && <Banner kind="error">{errorText(locale, error)}</Banner>}
      {known && <Banner kind="success">{t(noticeKey)}</Banner>}
    </>
  );
}
