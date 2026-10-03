import 'package:shared_preferences/shared_preferences.dart';

class Tokens {
  const Tokens({required this.accessToken, required this.refreshToken});

  final String accessToken;
  final String refreshToken;
}

/// Où l'on garde la session entre deux lancements.
///
/// Sur le web, `SharedPreferences` écrit dans le `localStorage` du navigateur, lisible par tout script de la page : c'est
/// acceptable pour une preuve de concept, pas pour la production. Sur mobile natif, remplacer par une implémentation
/// qui s'appuie sur le trousseau du système (Keychain / Keystore) : l'interface ne change pas.
abstract class TokenStore {
  Future<Tokens?> read();
  Future<void> write(Tokens tokens);
  Future<void> clear();
}

class MemoryTokenStore implements TokenStore {
  MemoryTokenStore([this._tokens]);

  Tokens? _tokens;

  @override
  Future<Tokens?> read() async => _tokens;

  @override
  Future<void> write(Tokens tokens) async => _tokens = tokens;

  @override
  Future<void> clear() async => _tokens = null;
}

class PrefsTokenStore implements TokenStore {
  PrefsTokenStore([this.prefix = 'vtc']);

  /// Distingue les applications qui partageraient le même stockage (deux apps sur le même domaine, en développement).
  final String prefix;

  String get _access => '$prefix.access';
  String get _refresh => '$prefix.refresh';

  @override
  Future<Tokens?> read() async {
    final prefs = await SharedPreferences.getInstance();
    final access = prefs.getString(_access);
    final refresh = prefs.getString(_refresh);
    return access == null || refresh == null ? null : Tokens(accessToken: access, refreshToken: refresh);
  }

  @override
  Future<void> write(Tokens tokens) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_access, tokens.accessToken);
    await prefs.setString(_refresh, tokens.refreshToken);
  }

  @override
  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_access);
    await prefs.remove(_refresh);
  }
}
