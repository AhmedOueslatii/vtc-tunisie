import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'api_exception.dart';
import 'config.dart';
import 'token_store.dart';

typedef Json = Map<String, dynamic>;

/// Raison pour laquelle la session s'est terminée sans que l'utilisateur l'ait demandé.
enum SessionEnd { expired, suspended }

/// Client de l'API REST. Ajoute le jeton, le renouvelle tout seul quand il expire (une seule demande de renouvellement à
/// la fois, même si plusieurs appels échouent en même temps) et traduit les erreurs en [ApiException].
class ApiClient {
  ApiClient({
    required this.config,
    required this.store,
    http.Client? client,
    this.timeout = const Duration(seconds: 15),
    this.onSessionEnded,
  }) : _http = client ?? http.Client();

  final ApiConfig config;
  final TokenStore store;
  final Duration timeout;

  /// Appelé quand la session ne peut plus continuer (renouvellement refusé, compte suspendu) : l'app revient à la connexion.
  void Function(SessionEnd reason)? onSessionEnded;

  final http.Client _http;
  Tokens? _tokens;
  bool _loaded = false;
  Future<bool>? _refreshing;

  /// Jeton d'accès courant (pour le temps réel), `null` si personne n'est connecté.
  String? get accessToken => _tokens?.accessToken;

  Future<bool> get hasSession async {
    // Les jetons sont lus une fois depuis le stockage, puis gardés en mémoire.
    await _load();
    return _tokens != null;
  }

  Future<void> _load() async {
    if (_loaded) return;
    _tokens = await store.read();
    _loaded = true;
  }

  Future<void> setTokens(Tokens tokens) async {
    _tokens = tokens;
    _loaded = true;
    await store.write(tokens);
  }

  Future<void> clearTokens() async {
    _tokens = null;
    _loaded = true;
    await store.clear();
  }

  // ─── Appels ────────────────────────────────────────────────────────────────

  Future<dynamic> get(String path, {Map<String, Object?>? query}) => _send('GET', path, query: query);

  Future<dynamic> post(String path, {Object? body, Map<String, String>? headers, bool authenticated = true}) =>
      _send('POST', path, body: body, headers: headers, authenticated: authenticated);

  Future<dynamic> put(String path, {Object? body}) => _send('PUT', path, body: body);

  Future<dynamic> patch(String path, {Object? body}) => _send('PATCH', path, body: body);

  Future<dynamic> delete(String path, {Map<String, Object?>? query}) => _send('DELETE', path, query: query);

  /// Envoi d'un fichier en multipart (scans de documents). Même renouvellement de session que les autres appels.
  Future<dynamic> upload(
    String path, {
    required Map<String, String> fields,
    required String fileField,
    required List<int> bytes,
    required String filename,
  }) async {
    await _load();
    Future<http.Response> attempt() async {
      final token = _tokens?.accessToken;
      if (token == null) throw const ApiException(401, 'UNAUTHORIZED', 'Authentification requise');
      final request = http.MultipartRequest('POST', Uri.parse('${config.baseUrl}$path'))
        ..headers.addAll({'accept': 'application/json', 'authorization': 'Bearer $token'})
        ..fields.addAll(fields)
        ..files.add(http.MultipartFile.fromBytes(fileField, bytes, filename: filename));
      try {
        // Un scan peut être lourd sur un réseau mobile : délai plus large que pour un appel JSON
        return await http.Response.fromStream(await _http.send(request).timeout(const Duration(seconds: 60)));
      } on TimeoutException catch (e) {
        throw ApiException.network(e);
      } on http.ClientException catch (e) {
        throw ApiException.network(e);
      }
    }

    var response = await attempt();
    if (response.statusCode == 401 && await _refresh()) response = await attempt();
    final parsed = _parse(response);
    if (response.statusCode >= 400) throw _error(response.statusCode, parsed);
    return parsed;
  }

  /// Renouvelle la session maintenant (le temps réel en a besoin quand son jeton a expiré). `false` si impossible.
  Future<bool> refreshNow() => _refresh();

  Future<dynamic> _send(
    String method,
    String path, {
    Map<String, Object?>? query,
    Object? body,
    Map<String, String>? headers,
    bool authenticated = true,
    bool canRetry = true,
  }) async {
    await _load();
    final token = authenticated ? _tokens?.accessToken : null;
    if (authenticated && token == null) throw const ApiException(401, 'UNAUTHORIZED', 'Authentification requise');

    final response = await _request(method, path, query: query, body: body, headers: headers, token: token);
    final parsed = _parse(response);

    if (response.statusCode == 401 && authenticated && canRetry) {
      // Jeton d'accès expiré : on le renouvelle une fois et on rejoue l'appel
      if (await _refresh()) {
        return _send(method, path, query: query, body: body, headers: headers, authenticated: authenticated, canRetry: false);
      }
      throw _error(response.statusCode, parsed);
    }
    if (response.statusCode >= 400) {
      final error = _error(response.statusCode, parsed);
      if (error.code == 'ACCOUNT_SUSPENDED' && authenticated) {
        await clearTokens();
        onSessionEnded?.call(SessionEnd.suspended);
      }
      throw error;
    }
    return parsed;
  }

  Future<http.Response> _request(
    String method,
    String path, {
    Map<String, Object?>? query,
    Object? body,
    Map<String, String>? headers,
    String? token,
  }) async {
    final uri = Uri.parse('${config.baseUrl}$path').replace(
      queryParameters: {
        for (final entry in (query ?? const <String, Object?>{}).entries)
          if (entry.value != null) entry.key: '${entry.value}',
      },
    );
    final request = http.Request(method, uri)
      ..headers.addAll({
        'accept': 'application/json',
        if (body != null) 'content-type': 'application/json',
        if (token != null) 'authorization': 'Bearer $token',
        ...?headers,
      });
    if (body != null) request.body = jsonEncode(body);
    try {
      return await http.Response.fromStream(await _http.send(request).timeout(timeout));
    } on TimeoutException catch (e) {
      throw ApiException.network(e);
    } on http.ClientException catch (e) {
      throw ApiException.network(e);
    }
  }

  dynamic _parse(http.Response response) {
    if (response.statusCode == 204 || response.bodyBytes.isEmpty) return null;
    try {
      return jsonDecode(utf8.decode(response.bodyBytes));
    } on FormatException {
      return null;
    }
  }

  ApiException _error(int status, dynamic parsed) {
    if (parsed is Map) {
      final code = parsed['code'];
      final message = parsed['message'];
      final details = parsed['details'];
      return ApiException(
        status,
        code is String ? code : 'HTTP_$status',
        message is String ? message : 'Erreur $status',
        details is Map<String, dynamic> ? details : null,
      );
    }
    return ApiException(status, 'HTTP_$status', 'Erreur $status');
  }

  // ─── Renouvellement de session ─────────────────────────────────────────────

  Future<bool> _refresh() => _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);

  Future<bool> _doRefresh() async {
    await _load();
    final tokens = _tokens;
    if (tokens == null) return false;
    try {
      final response = await _request('POST', '/auth/refresh', body: {'refreshToken': tokens.refreshToken});
      if (response.statusCode == 200) {
        final data = _parse(response) as Json;
        await setTokens(Tokens(accessToken: data['accessToken'] as String, refreshToken: data['refreshToken'] as String));
        return true;
      }
      // Refus explicite : la session est terminée. Toute autre réponse (panne serveur) ne doit pas déconnecter l'utilisateur.
      if (response.statusCode == 401 || response.statusCode == 400 || response.statusCode == 403) {
        final suspended = _error(response.statusCode, _parse(response)).code == 'ACCOUNT_SUSPENDED';
        await clearTokens();
        onSessionEnded?.call(suspended ? SessionEnd.suspended : SessionEnd.expired);
      }
      return false;
    } on ApiException {
      return false; // réseau coupé : on garde la session, l'appel échouera avec une erreur réseau
    }
  }

  void close() => _http.close();
}
