import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../api/token_store.dart';
import '../models/models.dart';

enum SessionStatus { unknown, signedOut, signedIn }

/// Qui est connecté. L'API crée le compte au premier code valide : connexion et inscription ne font qu'un.
class AuthSession extends ChangeNotifier {
  AuthSession(this.api) {
    api.onSessionEnded = (reason) {
      _user = null;
      endReason = reason;
      _status = SessionStatus.signedOut;
      notifyListeners();
    };
  }

  final ApiClient api;

  SessionStatus _status = SessionStatus.unknown;
  UserProfile? _user;

  /// Pourquoi la dernière session s'est terminée sans action de l'utilisateur, pour l'afficher sur l'écran de connexion.
  SessionEnd? endReason;

  SessionStatus get status => _status;
  UserProfile? get user => _user;

  /// Reprend la session mémorisée, si elle est encore valable.
  Future<void> restore() async {
    if (!await api.hasSession) {
      _status = SessionStatus.signedOut;
    } else {
      try {
        _user = UserProfile.fromJson(await api.get('/me') as Json);
        _status = SessionStatus.signedIn;
      } on ApiException {
        // Session refusée (déjà nettoyée par onSessionEnded) ou serveur injoignable : retour à la connexion.
        // Les jetons ne sont effacés que sur refus explicite, une panne réseau ne coûte donc pas la session.
        _status = SessionStatus.signedOut;
      }
    }
    notifyListeners();
  }

  Future<void> requestCode(String phone, String locale) async {
    await api.post('/auth/otp/request', body: {'phone': phone, 'locale': locale}, authenticated: false);
  }

  Future<void> verifyCode(String phone, String code) async {
    final data = await api.post('/auth/otp/verify', body: {'phone': phone, 'code': code}, authenticated: false) as Json;
    await api.setTokens(Tokens(accessToken: data['accessToken'] as String, refreshToken: data['refreshToken'] as String));
    _user = UserProfile.fromJson(data['user'] as Json);
    endReason = null;
    _status = SessionStatus.signedIn;
    notifyListeners();
  }

  Future<void> refreshUser() async {
    _user = UserProfile.fromJson(await api.get('/me') as Json);
    notifyListeners();
  }

  Future<void> logout() async {
    try {
      // On révoque côté serveur ; si le réseau est coupé, la session locale est quand même effacée.
      await api.post('/auth/logout', body: {'refreshToken': (await api.store.read())?.refreshToken ?? ''});
    } catch (_) {}
    await api.clearTokens();
    _user = null;
    endReason = null;
    _status = SessionStatus.signedOut;
    notifyListeners();
  }
}
