import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:vtc_core/vtc_core.dart';

import 'driver_controller.dart';
import 'home_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Active l'arbre d'accessibilité dès le départ : lecteurs d'écran, et tests automatisés du navigateur
  SemanticsBinding.instance.ensureSemantics();

  const config = ApiConfig();
  final api = ApiClient(config: config, store: PrefsTokenStore('vtc.driver'));
  final session = AuthSession(api);
  final locale = LocaleController();
  final realtime = RealtimeClient(config: config, api: api);

  locale.restore();
  session.restore();

  runApp(DriverApp(session: session, locale: locale, realtime: realtime, api: api));
}

class DriverApp extends StatelessWidget {
  const DriverApp({super.key, required this.session, required this.locale, required this.realtime, required this.api});

  final AuthSession session;
  final LocaleController locale;
  final RealtimeClient realtime;
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return VtcApp(
      title: 'VTC Tunisie Pro',
      loginSubtitle: locale.lang == 'ar' ? 'تطبيق السائقين' : 'Application chauffeur',
      session: session,
      locale: locale,
      home: (context) => _Home(session: session, locale: locale, realtime: realtime, api: api),
    );
  }
}

/// Crée le contrôleur à la connexion et le détruit à la déconnexion (avec la connexion temps réel).
class _Home extends StatefulWidget {
  const _Home({required this.session, required this.locale, required this.realtime, required this.api});

  final AuthSession session;
  final LocaleController locale;
  final RealtimeClient realtime;
  final ApiClient api;

  @override
  State<_Home> createState() => _HomeState();
}

class _HomeState extends State<_Home> {
  late final DriverController _controller = DriverController(api: widget.api, realtime: widget.realtime)..start();

  @override
  void dispose() {
    widget.realtime.disconnect();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => HomeScreen(controller: _controller, session: widget.session, locale: widget.locale);
}
