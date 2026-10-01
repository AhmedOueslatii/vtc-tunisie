export type Locale = 'fr' | 'ar';

export const NOTIFICATION_TYPES = [
  'trip.offer',
  'trip.driver_assigned',
  'trip.driver_arrived',
  'trip.completed',
  'trip.cancelled_by_driver',
  'trip.cancelled_by_passenger',
  'trip.no_driver_found',
  'driver.approved',
  'driver.rejected',
  'driver.document_rejected',
  'support.ticket_updated',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type Params = Record<string, string | number | undefined>;
interface Text {
  title: string;
  body: string;
}
interface Definition {
  /** Conservée dans la boîte de réception de l'app. Faux pour les offres : éphémères, déjà poussées en temps réel. */
  inbox: boolean;
  /** Doublée d'un SMS (événements critiques : le push peut ne pas arriver sans réseau data). */
  sms: boolean;
  text: (p: Params) => Record<Locale, Text>;
}

/** Montants en millimes (1 DT = 1000 millimes). */
const dt = (millimes: number | undefined, locale: Locale) => {
  const amount = ((millimes ?? 0) / 1000).toFixed(3).replace('.', ',');
  return locale === 'ar' ? `${amount} د.ت` : `${amount} DT`;
};

const TICKET_STATUS: Record<string, Record<Locale, string>> = {
  open: { fr: 'ouvert', ar: 'مفتوح' },
  in_progress: { fr: 'en cours de traitement', ar: 'قيد المعالجة' },
  resolved: { fr: 'résolu', ar: 'تم الحل' },
  closed: { fr: 'clos', ar: 'مغلق' },
};

export const DEFINITIONS: Record<NotificationType, Definition> = {
  'trip.offer': {
    inbox: false,
    sms: false,
    text: (p) => ({
      fr: { title: 'Nouvelle course', body: `À ${p.distanceM} m de vous — ${dt(Number(p.price), 'fr')}` },
      ar: { title: 'رحلة جديدة', body: `على بعد ${p.distanceM} م منك — ${dt(Number(p.price), 'ar')}` },
    }),
  },
  'trip.driver_assigned': {
    inbox: true,
    sms: false,
    text: (p) => ({
      fr: { title: 'Chauffeur en route', body: `${p.driverName ?? 'Votre chauffeur'} arrive${p.plate ? ` (${p.plate})` : ''}.` },
      ar: { title: 'السائق في الطريق', body: `${p.driverName ?? 'سائقك'} في طريقه إليك${p.plate ? ` (${p.plate})` : ''}.` },
    }),
  },
  'trip.driver_arrived': {
    inbox: true,
    sms: false,
    text: () => ({
      fr: { title: 'Votre chauffeur est arrivé', body: 'Il vous attend au point de prise en charge.' },
      ar: { title: 'وصل سائقك', body: 'في انتظارك عند نقطة الالتقاط.' },
    }),
  },
  'trip.completed': {
    inbox: true,
    sms: false,
    text: (p) => ({
      fr: { title: 'Course terminée', body: `Montant à régler en espèces : ${dt(Number(p.price), 'fr')}.` },
      ar: { title: 'انتهت الرحلة', body: `المبلغ المطلوب دفعه نقدًا: ${dt(Number(p.price), 'ar')}.` },
    }),
  },
  'trip.cancelled_by_driver': {
    inbox: true,
    sms: true,
    text: () => ({
      fr: { title: 'Course annulée par le chauffeur', body: 'Vous pouvez refaire une demande.' },
      ar: { title: 'ألغى السائق الرحلة', body: 'يمكنك تقديم طلب جديد.' },
    }),
  },
  'trip.cancelled_by_passenger': {
    inbox: true,
    sms: false,
    text: () => ({
      fr: { title: 'Course annulée', body: 'Le passager a annulé la course.' },
      ar: { title: 'تم إلغاء الرحلة', body: 'قام الراكب بإلغاء الرحلة.' },
    }),
  },
  'trip.no_driver_found': {
    inbox: true,
    sms: false,
    text: () => ({
      fr: { title: 'Aucun chauffeur disponible', body: 'Réessayez dans quelques minutes.' },
      ar: { title: 'لا يوجد سائق متاح', body: 'حاول مرة أخرى بعد بضع دقائق.' },
    }),
  },
  'driver.approved': {
    inbox: true,
    sms: true,
    text: () => ({
      fr: { title: 'Compte chauffeur validé', body: 'Vous pouvez maintenant recevoir des courses.' },
      ar: { title: 'تم تفعيل حساب السائق', body: 'يمكنك الآن البدء في استقبال الرحلات.' },
    }),
  },
  'driver.rejected': {
    inbox: true,
    sms: true,
    text: (p) => ({
      fr: { title: 'Dossier chauffeur refusé', body: `Motif : ${p.reason}` },
      ar: { title: 'تم رفض ملف السائق', body: `السبب: ${p.reason}` },
    }),
  },
  'driver.document_rejected': {
    inbox: true,
    sms: false,
    text: (p) => ({
      fr: { title: 'Document refusé', body: `${p.reason}. Merci d'en envoyer un nouveau.` },
      ar: { title: 'تم رفض المستند', body: `${p.reason}. يرجى إرسال مستند جديد.` },
    }),
  },
  'support.ticket_updated': {
    inbox: true,
    sms: false,
    text: (p) => {
      const status = TICKET_STATUS[String(p.status)];
      return {
        fr: { title: 'Votre signalement a évolué', body: `Statut : ${status?.fr ?? p.status}.` },
        ar: { title: 'تم تحديث بلاغك', body: `الحالة: ${status?.ar ?? p.status}.` },
      };
    },
  },
};

export function renderNotification(type: NotificationType, locale: Locale, params: Params = {}): Text {
  return DEFINITIONS[type].text(params)[locale];
}
