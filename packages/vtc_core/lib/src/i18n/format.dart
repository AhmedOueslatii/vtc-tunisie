// Formats d'affichage. Toujours à la tunisienne (virgule décimale, espace entre les milliers), y compris en arabe :
// « 3.000 » se lirait 3 dinars, alors que c'est 3 000 millimes.

/// 12 500 millimes → « 12,500 DT » (le dinar tunisien se divise en 1000 millimes, d'où trois décimales).
String formatDinars(int millimes) {
  final negative = millimes < 0;
  final abs = millimes.abs();
  final whole = (abs ~/ 1000).toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ' ');
  final frac = (abs % 1000).toString().padLeft(3, '0');
  return '${negative ? '-' : ''}$whole,$frac DT';
}

/// 850 → « 850 m », 3400 → « 3,4 km ».
String formatDistance(int meters) {
  if (meters < 1000) return '$meters m';
  final km = (meters / 100).round() / 10;
  return '${km.toStringAsFixed(1).replaceAll('.', ',')} km';
}

/// Durée en minutes pleines, au moins 1.
String formatMinutes(int seconds) {
  final minutes = (seconds / 60).ceil();
  return '${minutes < 1 ? 1 : minutes} min';
}

/// Numéro tunisien saisi librement → format international attendu par l'API (`+216XXXXXXXX`), `null` si invalide.
String? normalizeTunisianPhone(String raw) {
  var digits = raw.replaceAll(RegExp(r'[^\d+]'), '');
  if (digits.startsWith('+216')) digits = digits.substring(4);
  if (digits.startsWith('00216')) digits = digits.substring(5);
  if (digits.startsWith('216') && digits.length == 11) digits = digits.substring(3);
  return RegExp(r'^[2459]\d{7}$').hasMatch(digits) ? '+216$digits' : null;
}
