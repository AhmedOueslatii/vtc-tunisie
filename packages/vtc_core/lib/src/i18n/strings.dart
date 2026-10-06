import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Textes de l'interface, en français et en arabe. Tables à plat (clé → texte) : un test vérifie que les deux langues
/// ont exactement les mêmes clés. `{nom}` est remplacé par le paramètre du même nom.
const Map<String, String> _fr = {
  // Commun
  'app.loading': 'Chargement…',
  'common.retry': 'Réessayer',
  'common.cancel': 'Annuler',
  'common.back': 'Retour',
  'common.confirm': 'Confirmer',
  'common.close': 'Fermer',
  'common.language': 'العربية',
  'common.logout': 'Se déconnecter',
  'common.dt': 'DT',

  // Connexion
  'login.title': 'Connexion',
  'login.phoneHelp': 'Entrez votre numéro tunisien, nous vous envoyons un code par SMS.',
  'login.phone': 'Numéro de téléphone',
  'login.sendCode': 'Recevoir le code',
  'login.codeHelp': 'Code envoyé au {phone}',
  'login.code': 'Code à 6 chiffres',
  'login.verify': 'Valider',
  'login.changeNumber': 'Changer de numéro',
  'login.resend': 'Renvoyer le code',
  'login.devCode': 'Mode développement : le code est dans les journaux de l\'API.',
  'login.suspended': 'Votre compte est suspendu. Contactez le support.',
  'login.expired': 'Votre session a expiré, reconnectez-vous.',

  // Statuts de course
  'tripStatus.requested': 'Recherche d\'un chauffeur…',
  'tripStatus.driver_assigned': 'Votre chauffeur arrive',
  'tripStatus.driver_arrived': 'Votre chauffeur est arrivé',
  'tripStatus.in_progress': 'Course en cours',
  'tripStatus.completed': 'Course terminée',
  'tripStatus.cancelled_by_passenger': 'Course annulée',
  'tripStatus.cancelled_by_driver': 'Annulée par le chauffeur',
  'tripStatus.no_driver_found': 'Aucun chauffeur disponible',

  // Passager
  'p.where': 'Où allez-vous ?',
  'p.pickup': 'Départ',
  'p.dropoff': 'Arrivée',
  'p.pickupHere': 'Ma position approximative (Tunis centre)',
  'p.searchPlace': 'Rechercher une adresse',
  'p.noResults': 'Aucun résultat',
  'p.estimate': 'Voir le prix',
  'p.price': 'Prix garanti',
  'p.priceHint': 'Ce prix ne changera pas, même en cas de détour ou d\'embouteillage.',
  'p.distance': 'Distance',
  'p.duration': 'Durée',
  'p.payCash': 'Paiement en espèces au chauffeur',
  'p.order': 'Commander',
  'p.ordering': 'Commande en cours…',
  'p.cancelTrip': 'Annuler la course',
  'p.cancelFeeMaybe': 'Des frais d\'annulation peuvent s\'appliquer si le chauffeur est déjà en route.',
  'p.driverEta': 'Arrivée dans {eta}',
  'p.plate': 'Plaque {plate}',
  'p.total': 'Total à payer',
  'p.payDriver': 'Payez le chauffeur en espèces',
  'p.rateTitle': 'Comment était votre course ?',
  'p.rateSend': 'Envoyer ma note',
  'p.rateThanks': 'Merci pour votre avis !',
  'p.newTrip': 'Nouvelle course',
  'p.history': 'Mes courses',
  'p.noHistory': 'Aucune course pour le moment.',
  'p.cancelledFee': 'Frais d\'annulation : {fee}',

  // Chauffeur
  'd.offline': 'Hors ligne',
  'd.online': 'En ligne',
  'd.goOnline': 'Se mettre en ligne',
  'd.goOffline': 'Se mettre hors ligne',
  'd.waiting': 'En attente de courses…',
  'd.offerTitle': 'Nouvelle course',
  'd.offerAccept': 'Accepter',
  'd.offerDecline': 'Refuser',
  'd.offerExpiresIn': 'Expire dans {s} s',
  'd.toPickup': 'Vers le client : {distance}',
  'd.tripLength': 'Trajet : {distance} · {duration}',
  'd.arrived': 'Je suis arrivé',
  'd.start': 'Démarrer la course',
  'd.complete': 'Terminer la course',
  'd.collectCash': 'Encaisser {amount} en espèces',
  'd.cashCollected': 'Espèces encaissées',
  'd.passenger': 'Passager : {name}',
  'd.earned': 'Course terminée',
  'd.tabHome': 'Accueil',
  'd.tabWallet': 'Portefeuille',
  'd.walletDebt': 'Dette envers la plateforme',
  'd.walletCeiling': 'Plafond : {ceiling}',
  'd.walletNet': 'Gains nets ({days} j)',
  'd.walletGross': 'Encaissé',
  'd.walletCommission': 'Commission',
  'd.walletTrips': 'Courses',
  'd.walletHistory': 'Mouvements',
  'd.walletEmpty': 'Aucun mouvement.',
  'd.debtWarning': 'Votre dette approche du plafond. Réglez-la auprès de la plateforme.',
  'd.debtBlocked': 'Plafond de dette atteint : vous ne pouvez plus recevoir de courses tant que vous n\'avez pas réglé.',
  'd.notApproved': 'Votre dossier n\'est pas encore validé.',
  'd.status.pending_documents': 'Dossier incomplet : envoyez vos documents.',
  'd.status.under_review': 'Dossier en cours de vérification.',
  'd.status.approved': 'Dossier validé.',
  'd.status.rejected': 'Dossier refusé.',
  'd.status.suspended': 'Compte suspendu.',
  'd.onboardTitle': 'Devenir chauffeur',
  'd.onboardHelp': 'Renseignez votre identité et votre véhicule. Vous enverrez ensuite vos documents (CIN, permis, carte grise, assurance).',
  'd.cin': 'Numéro de CIN (8 chiffres)',
  'd.license': 'Numéro de permis',
  'd.licenseExpiry': 'Fin de validité du permis (AAAA-MM-JJ)',
  'd.vehicleMake': 'Marque',
  'd.vehicleModel': 'Modèle',
  'd.vehicleColor': 'Couleur',
  'd.vehicleYear': 'Année',
  'd.vehiclePlate': 'Immatriculation',
  'd.onboardSend': 'Envoyer ma candidature',
  'd.tabDocs': 'Documents',
  'd.docsTitle': 'Mes documents',
  'd.docsHelp': 'Envoyez une photo ou un PDF de chaque pièce (JPEG, PNG ou PDF, 5 Mo maximum). Un administrateur les vérifie.',
  'd.docType.cin': 'Carte d\'identité (CIN)',
  'd.docType.driving_license': 'Permis de conduire',
  'd.docType.vehicle_registration': 'Carte grise',
  'd.docType.insurance': 'Assurance',
  'd.docStatus.none': 'Non envoyé',
  'd.docStatus.pending': 'En cours de vérification',
  'd.docStatus.approved': 'Validé',
  'd.docStatus.rejected': 'Refusé',
  'd.docStatus.expired': 'Expiré',
  'd.docSend': 'Envoyer',
  'd.docReplace': 'Remplacer',
  'd.docExpiry': 'Fin de validité (AAAA-MM-JJ)',
  'd.docSent': 'Document envoyé.',
  'd.docReason': 'Motif : {reason}',
  'd.txType.platform_commission': 'Commission de la course',
  'd.txType.settlement': 'Règlement',
  'd.txType.adjustment': 'Ajustement',

  // Erreurs (codes stables de l'API)
  'err.NETWORK': 'Serveur injoignable. Vérifiez votre connexion.',
  'err.UNKNOWN': 'Une erreur est survenue. Réessayez.',
  'err.VALIDATION_FAILED': 'Certaines informations sont invalides.',
  'err.PHONE_INVALID': 'Numéro de téléphone invalide.',
  'err.OTP_INVALID': 'Code incorrect.',
  'err.OTP_EXPIRED': 'Code expiré, demandez-en un nouveau.',
  'err.OTP_TOO_MANY_ATTEMPTS': 'Trop d\'essais. Demandez un nouveau code.',
  'err.OTP_TOO_SOON': 'Patientez un instant avant de redemander un code.',
  'err.OTP_RATE_LIMITED': 'Trop de codes demandés. Réessayez plus tard.',
  'err.RATE_LIMITED': 'Trop de requêtes, patientez un instant.',
  'err.ACCOUNT_SUSPENDED': 'Votre compte est suspendu.',
  'err.OUT_OF_SERVICE_AREA': 'Cette adresse est hors de la zone de service.',
  'err.TRIP_TOO_SHORT': 'Trajet trop court.',
  'err.TRIP_TOO_LONG': 'Trajet trop long.',
  'err.QUOTE_EXPIRED': 'Le prix a expiré, demandez-le à nouveau.',
  'err.CATEGORY_UNAVAILABLE': 'Cette catégorie n\'est pas disponible ici.',
  'err.USER_HAS_ACTIVE_TRIP': 'Vous avez déjà une course en cours.',
  'err.TRIP_NOT_CANCELLABLE': 'Cette course ne peut plus être annulée.',
  'err.OFFER_NOT_AVAILABLE': 'Cette course n\'est plus disponible.',
  'err.TOO_FAR_FROM_PICKUP': 'Vous êtes trop loin du point de départ.',
  'err.DRIVER_NOT_APPROVED': 'Votre dossier n\'est pas encore validé.',
  'err.DRIVER_NOT_AVAILABLE': 'Vous n\'êtes pas disponible.',
  'err.DRIVER_ON_TRIP': 'Impossible pendant une course.',
  'err.DEBT_LIMIT_REACHED': 'Plafond de dette atteint : réglez votre dette pour reprendre.',
  'err.NO_ACTIVE_VEHICLE': 'Aucun véhicule actif.',
  'err.DOCUMENTS_INCOMPLETE': 'Documents manquants.',
  'err.DOCUMENT_EXPIRED': 'Un document est expiré.',
  'err.LICENSE_EXPIRED': 'Votre permis est expiré.',
  'err.PLATE_INVALID': 'Immatriculation non reconnue.',
  'err.CIN_INVALID': 'Le CIN doit comporter 8 chiffres.',
  'err.DRIVER_ALREADY_REGISTERED': 'Une candidature existe déjà pour ce compte.',
  'err.DRIVER_IDENTITY_IN_USE': 'Ce CIN ou ce permis est déjà utilisé par un autre compte.',
  'err.PLATE_IN_USE': 'Cette immatriculation est déjà enregistrée.',
  'err.NOT_A_DRIVER': 'Ce compte n\'est pas un compte chauffeur.',
  'err.DOCUMENT_INVALID_TYPE': 'Format refusé : JPEG, PNG ou PDF uniquement.',
  'err.TOO_MANY_DOCUMENTS': 'Trop de documents envoyés.',
  'err.EXPIRY_REQUIRED': 'La date de fin de validité est obligatoire.',
  'err.GEOCODING_UNAVAILABLE': 'La recherche d\'adresses est indisponible.',
  'err.NOT_FOUND': 'Introuvable.',
  'err.FORBIDDEN': 'Action non autorisée.',
  'err.UNAUTHORIZED': 'Veuillez vous reconnecter.',
  'err.TOKEN_INVALID': 'Veuillez vous reconnecter.',
};

const Map<String, String> _ar = {
  'app.loading': 'جارٍ التحميل…',
  'common.retry': 'إعادة المحاولة',
  'common.cancel': 'إلغاء',
  'common.back': 'رجوع',
  'common.confirm': 'تأكيد',
  'common.close': 'إغلاق',
  'common.language': 'Français',
  'common.logout': 'تسجيل الخروج',
  'common.dt': 'د.ت',

  'login.title': 'تسجيل الدخول',
  'login.phoneHelp': 'أدخل رقمك التونسي، سنرسل لك رمزًا عبر رسالة قصيرة.',
  'login.phone': 'رقم الهاتف',
  'login.sendCode': 'استلام الرمز',
  'login.codeHelp': 'تم إرسال الرمز إلى {phone}',
  'login.code': 'الرمز المكوّن من 6 أرقام',
  'login.verify': 'تأكيد',
  'login.changeNumber': 'تغيير الرقم',
  'login.resend': 'إعادة إرسال الرمز',
  'login.devCode': 'وضع التطوير: الرمز موجود في سجلات الخادم.',
  'login.suspended': 'حسابك موقوف. تواصل مع الدعم.',
  'login.expired': 'انتهت جلستك، أعد تسجيل الدخول.',

  'tripStatus.requested': 'جارٍ البحث عن سائق…',
  'tripStatus.driver_assigned': 'سائقك في الطريق',
  'tripStatus.driver_arrived': 'وصل سائقك',
  'tripStatus.in_progress': 'الرحلة جارية',
  'tripStatus.completed': 'انتهت الرحلة',
  'tripStatus.cancelled_by_passenger': 'تم إلغاء الرحلة',
  'tripStatus.cancelled_by_driver': 'ألغاها السائق',
  'tripStatus.no_driver_found': 'لا يوجد سائق متاح',

  'p.where': 'إلى أين تذهب؟',
  'p.pickup': 'الانطلاق',
  'p.dropoff': 'الوصول',
  'p.pickupHere': 'موقعي التقريبي (وسط تونس)',
  'p.searchPlace': 'ابحث عن عنوان',
  'p.noResults': 'لا توجد نتائج',
  'p.estimate': 'عرض السعر',
  'p.price': 'السعر المضمون',
  'p.priceHint': 'هذا السعر لن يتغير حتى في حالة تغيير الطريق أو الازدحام.',
  'p.distance': 'المسافة',
  'p.duration': 'المدة',
  'p.payCash': 'الدفع نقدًا للسائق',
  'p.order': 'اطلب الآن',
  'p.ordering': 'جارٍ الطلب…',
  'p.cancelTrip': 'إلغاء الرحلة',
  'p.cancelFeeMaybe': 'قد تُطبَّق رسوم إلغاء إذا كان السائق في الطريق.',
  'p.driverEta': 'الوصول خلال {eta}',
  'p.plate': 'اللوحة {plate}',
  'p.total': 'المبلغ المستحق',
  'p.payDriver': 'ادفع للسائق نقدًا',
  'p.rateTitle': 'كيف كانت رحلتك؟',
  'p.rateSend': 'إرسال التقييم',
  'p.rateThanks': 'شكرًا على رأيك!',
  'p.newTrip': 'رحلة جديدة',
  'p.history': 'رحلاتي',
  'p.noHistory': 'لا توجد رحلات حاليًا.',
  'p.cancelledFee': 'رسوم الإلغاء: {fee}',

  'd.offline': 'غير متصل',
  'd.online': 'متصل',
  'd.goOnline': 'الاتصال بالشبكة',
  'd.goOffline': 'قطع الاتصال',
  'd.waiting': 'في انتظار الرحلات…',
  'd.offerTitle': 'رحلة جديدة',
  'd.offerAccept': 'قبول',
  'd.offerDecline': 'رفض',
  'd.offerExpiresIn': 'ينتهي خلال {s} ث',
  'd.toPickup': 'إلى الزبون: {distance}',
  'd.tripLength': 'الرحلة: {distance} · {duration}',
  'd.arrived': 'لقد وصلت',
  'd.start': 'بدء الرحلة',
  'd.complete': 'إنهاء الرحلة',
  'd.collectCash': 'تحصيل {amount} نقدًا',
  'd.cashCollected': 'تم تحصيل النقود',
  'd.passenger': 'الراكب: {name}',
  'd.earned': 'انتهت الرحلة',
  'd.tabHome': 'الرئيسية',
  'd.tabWallet': 'المحفظة',
  'd.walletDebt': 'الدين تجاه المنصة',
  'd.walletCeiling': 'السقف: {ceiling}',
  'd.walletNet': 'الأرباح الصافية ({days} يوم)',
  'd.walletGross': 'المحصَّل',
  'd.walletCommission': 'العمولة',
  'd.walletTrips': 'الرحلات',
  'd.walletHistory': 'الحركات',
  'd.walletEmpty': 'لا توجد حركات.',
  'd.debtWarning': 'دينك يقترب من السقف. سدّده لدى المنصة.',
  'd.debtBlocked': 'بلغت سقف الدين: لن تتلقى رحلات حتى تسدّد.',
  'd.notApproved': 'ملفك لم يُقبل بعد.',
  'd.status.pending_documents': 'الملف غير مكتمل: أرسل وثائقك.',
  'd.status.under_review': 'الملف قيد المراجعة.',
  'd.status.approved': 'تم قبول الملف.',
  'd.status.rejected': 'تم رفض الملف.',
  'd.status.suspended': 'الحساب موقوف.',
  'd.onboardTitle': 'كن سائقًا',
  'd.onboardHelp': 'أدخل هويتك ومعلومات سيارتك. سترسل بعد ذلك وثائقك (بطاقة التعريف، الرخصة، البطاقة الرمادية، التأمين).',
  'd.cin': 'رقم بطاقة التعريف (8 أرقام)',
  'd.license': 'رقم رخصة السياقة',
  'd.licenseExpiry': 'نهاية صلاحية الرخصة (سنة-شهر-يوم)',
  'd.vehicleMake': 'الماركة',
  'd.vehicleModel': 'الطراز',
  'd.vehicleColor': 'اللون',
  'd.vehicleYear': 'السنة',
  'd.vehiclePlate': 'رقم التسجيل',
  'd.onboardSend': 'إرسال طلبي',
  'd.tabDocs': 'الوثائق',
  'd.docsTitle': 'وثائقي',
  'd.docsHelp': 'أرسل صورة أو ملف PDF لكل وثيقة (JPEG أو PNG أو PDF، 5 ميغابايت كحد أقصى). يراجعها مشرف.',
  'd.docType.cin': 'بطاقة التعريف الوطنية',
  'd.docType.driving_license': 'رخصة السياقة',
  'd.docType.vehicle_registration': 'البطاقة الرمادية',
  'd.docType.insurance': 'التأمين',
  'd.docStatus.none': 'لم تُرسل',
  'd.docStatus.pending': 'قيد المراجعة',
  'd.docStatus.approved': 'مقبولة',
  'd.docStatus.rejected': 'مرفوضة',
  'd.docStatus.expired': 'منتهية الصلاحية',
  'd.docSend': 'إرسال',
  'd.docReplace': 'استبدال',
  'd.docExpiry': 'نهاية الصلاحية (سنة-شهر-يوم)',
  'd.docSent': 'تم إرسال الوثيقة.',
  'd.docReason': 'السبب: {reason}',
  'd.txType.platform_commission': 'عمولة الرحلة',
  'd.txType.settlement': 'تسوية',
  'd.txType.adjustment': 'تعديل',

  'err.NETWORK': 'تعذّر الاتصال بالخادم. تحقق من اتصالك.',
  'err.UNKNOWN': 'حدث خطأ. أعد المحاولة.',
  'err.VALIDATION_FAILED': 'بعض المعلومات غير صالحة.',
  'err.PHONE_INVALID': 'رقم الهاتف غير صالح.',
  'err.OTP_INVALID': 'الرمز غير صحيح.',
  'err.OTP_EXPIRED': 'انتهت صلاحية الرمز، اطلب رمزًا جديدًا.',
  'err.OTP_TOO_MANY_ATTEMPTS': 'محاولات كثيرة. اطلب رمزًا جديدًا.',
  'err.OTP_TOO_SOON': 'انتظر قليلًا قبل طلب رمز جديد.',
  'err.OTP_RATE_LIMITED': 'طلبت رموزًا كثيرة. أعد المحاولة لاحقًا.',
  'err.RATE_LIMITED': 'طلبات كثيرة، انتظر قليلًا.',
  'err.ACCOUNT_SUSPENDED': 'حسابك موقوف.',
  'err.OUT_OF_SERVICE_AREA': 'هذا العنوان خارج منطقة الخدمة.',
  'err.TRIP_TOO_SHORT': 'الرحلة قصيرة جدًا.',
  'err.TRIP_TOO_LONG': 'الرحلة طويلة جدًا.',
  'err.QUOTE_EXPIRED': 'انتهت صلاحية السعر، اطلبه من جديد.',
  'err.CATEGORY_UNAVAILABLE': 'هذه الفئة غير متوفرة هنا.',
  'err.USER_HAS_ACTIVE_TRIP': 'لديك رحلة جارية بالفعل.',
  'err.TRIP_NOT_CANCELLABLE': 'لا يمكن إلغاء هذه الرحلة بعد الآن.',
  'err.OFFER_NOT_AVAILABLE': 'هذه الرحلة لم تعد متاحة.',
  'err.TOO_FAR_FROM_PICKUP': 'أنت بعيد جدًا عن نقطة الانطلاق.',
  'err.DRIVER_NOT_APPROVED': 'ملفك لم يُقبل بعد.',
  'err.DRIVER_NOT_AVAILABLE': 'أنت غير متاح.',
  'err.DRIVER_ON_TRIP': 'غير ممكن أثناء الرحلة.',
  'err.DEBT_LIMIT_REACHED': 'بلغت سقف الدين: سدّد دينك للاستئناف.',
  'err.NO_ACTIVE_VEHICLE': 'لا توجد سيارة نشطة.',
  'err.DOCUMENTS_INCOMPLETE': 'وثائق ناقصة.',
  'err.DOCUMENT_EXPIRED': 'إحدى الوثائق منتهية الصلاحية.',
  'err.LICENSE_EXPIRED': 'رخصتك منتهية الصلاحية.',
  'err.PLATE_INVALID': 'رقم التسجيل غير معروف.',
  'err.CIN_INVALID': 'يجب أن تتكون بطاقة التعريف من 8 أرقام.',
  'err.DRIVER_ALREADY_REGISTERED': 'يوجد طلب ترشح لهذا الحساب بالفعل.',
  'err.DRIVER_IDENTITY_IN_USE': 'بطاقة التعريف أو الرخصة مستعملة من حساب آخر.',
  'err.PLATE_IN_USE': 'رقم التسجيل مسجّل بالفعل.',
  'err.NOT_A_DRIVER': 'هذا الحساب ليس حساب سائق.',
  'err.DOCUMENT_INVALID_TYPE': 'صيغة مرفوضة: JPEG أو PNG أو PDF فقط.',
  'err.TOO_MANY_DOCUMENTS': 'عدد الوثائق المرسلة كبير جدًا.',
  'err.EXPIRY_REQUIRED': 'تاريخ نهاية الصلاحية إلزامي.',
  'err.GEOCODING_UNAVAILABLE': 'البحث عن العناوين غير متاح.',
  'err.NOT_FOUND': 'غير موجود.',
  'err.FORBIDDEN': 'إجراء غير مسموح.',
  'err.UNAUTHORIZED': 'يرجى إعادة تسجيل الدخول.',
  'err.TOKEN_INVALID': 'يرجى إعادة تسجيل الدخول.',
};

/// Tables brutes, exposées pour le test de parité fr/ar.
const Map<String, Map<String, String>> stringTables = {'fr': _fr, 'ar': _ar};

class Strings {
  const Strings(this.lang);

  final String lang;

  bool get isArabic => lang == 'ar';

  String t(String key, [Map<String, Object?> params = const {}]) {
    var text = stringTables[lang]![key] ?? stringTables['fr']![key] ?? key;
    params.forEach((name, value) => text = text.replaceAll('{$name}', '$value'));
    return text;
  }

  /// Message pour un code d'erreur de l'API, avec repli générique.
  /// Un code inconnu est affiché tel quel : sans lui, impossible de savoir ce qui s'est passé.
  String error(String code) => stringTables[lang]!['err.$code'] ?? '${t('err.UNKNOWN')} ($code)';

  static Strings of(BuildContext context) => Localizations.of<Strings>(context, Strings) ?? const Strings('fr');
}

class StringsDelegate extends LocalizationsDelegate<Strings> {
  const StringsDelegate();

  @override
  bool isSupported(Locale locale) => locale.languageCode == 'fr' || locale.languageCode == 'ar';

  @override
  Future<Strings> load(Locale locale) async => Strings(locale.languageCode);

  @override
  bool shouldReload(StringsDelegate old) => false;
}

/// Langue courante, mémorisée dans le navigateur / l'appareil.
class LocaleController extends ChangeNotifier {
  LocaleController([String initial = 'fr']) : _lang = initial == 'ar' ? 'ar' : 'fr';

  static const _key = 'vtc.lang';
  String _lang;

  String get lang => _lang;
  Locale get locale => Locale(_lang);

  Future<void> restore() async {
    try {
      final saved = (await SharedPreferences.getInstance()).getString(_key);
      if (saved == 'ar' || saved == 'fr') {
        _lang = saved!;
        notifyListeners();
      }
    } catch (_) {
      // Stockage indisponible : on garde le français
    }
  }

  Future<void> toggle() async {
    _lang = _lang == 'fr' ? 'ar' : 'fr';
    notifyListeners();
    try {
      await (await SharedPreferences.getInstance()).setString(_key, _lang);
    } catch (_) {
      // Sans stockage la langue n'est simplement pas mémorisée
    }
  }
}
