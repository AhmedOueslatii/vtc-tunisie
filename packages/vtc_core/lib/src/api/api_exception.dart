/// Erreur renvoyée par l'API. `code` est stable (`DRIVER_NOT_APPROVED`, `OTP_INVALID`…) : c'est lui qu'on traduit pour
/// l'utilisateur, jamais `message` (destiné aux développeurs).
class ApiException implements Exception {
  const ApiException(this.status, this.code, this.message, [this.details]);

  /// Statut HTTP ; 0 quand le serveur n'a pas pu être joint.
  final int status;
  final String code;
  final String message;
  final Map<String, dynamic>? details;

  static const networkCode = 'NETWORK';

  factory ApiException.network(Object cause) => ApiException(0, networkCode, 'Serveur injoignable : $cause');

  bool get isNetwork => status == 0;

  @override
  String toString() => 'ApiException($status $code: $message)';
}
