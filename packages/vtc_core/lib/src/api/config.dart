/// Adresse de l'API. Se règle à la compilation : `flutter run --dart-define=API_URL=https://api.exemple.tn/v1`.
class ApiConfig {
  const ApiConfig({this.baseUrl = const String.fromEnvironment('API_URL', defaultValue: 'http://localhost:3000/v1')});

  /// URL de base de l'API REST, préfixe `/v1` inclus, sans barre finale.
  final String baseUrl;

  /// Serveur temps réel : même hôte, namespace Socket.IO `/rt`.
  String get realtimeUrl => Uri.parse(baseUrl).replace(path: '/rt').toString();
}
