import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import '../auth/session.dart';
import '../i18n/strings.dart';
import 'login_screen.dart';
import 'mobile_frame.dart';
import 'theme.dart';

/// Coquille commune aux deux applications : thème, français / arabe (sens de lecture compris), cadre téléphone et
/// aiguillage connexion ↔ accueil selon la session.
class VtcApp extends StatelessWidget {
  const VtcApp({
    super.key,
    required this.title,
    required this.session,
    required this.locale,
    required this.home,
    this.loginSubtitle,
  });

  final String title;
  final AuthSession session;
  final LocaleController locale;
  final String? loginSubtitle;

  /// Écran d'accueil, construit seulement une fois connecté.
  final WidgetBuilder home;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([session, locale]),
      builder: (context, _) {
        return MaterialApp(
          title: title,
          debugShowCheckedModeBanner: false,
          theme: vtcTheme(lang: locale.lang),
          locale: locale.locale,
          supportedLocales: const [Locale('fr'), Locale('ar')],
          localizationsDelegates: const [
            StringsDelegate(),
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          builder: (context, child) => MobileFrame(child: child!),
          home: switch (session.status) {
            SessionStatus.unknown => const _Splash(),
            SessionStatus.signedOut => LoginScreen(session: session, locale: locale, title: title, subtitle: loginSubtitle),
            SessionStatus.signedIn => Builder(builder: home),
          },
        );
      },
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) => const Scaffold(body: Center(child: CircularProgressIndicator()));
}
