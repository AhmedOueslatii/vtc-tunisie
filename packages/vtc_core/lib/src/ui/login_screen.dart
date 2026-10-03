import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../auth/session.dart';
import '../i18n/format.dart';
import '../i18n/strings.dart';

/// Message d'erreur lisible pour une exception de l'API, dans la langue courante.
String errorText(Strings s, Object error) => error is ApiException ? s.error(error.code) : '${s.t('err.UNKNOWN')} (${error.runtimeType})';

/// Connexion par code SMS, commune aux deux applications.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.session, required this.locale, required this.title, this.subtitle});

  final AuthSession session;
  final LocaleController locale;
  final String title;
  final String? subtitle;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  String? _sentTo;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final s = Strings.of(context);
    try {
      await action();
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendCode() => _run(() async {
        final phone = normalizeTunisianPhone(_phone.text);
        if (phone == null) throw const ApiException(400, 'PHONE_INVALID', 'Numéro invalide');
        await widget.session.requestCode(phone, widget.locale.lang);
        if (mounted) setState(() => _sentTo = phone);
      });

  Future<void> _verify() => _run(() => widget.session.verifyCode(_sentTo!, _code.text.trim()));

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final theme = Theme.of(context);
    final reason = widget.session.endReason;
    final notice = reason == SessionEnd.suspended ? s.t('login.suspended') : reason == SessionEnd.expired ? s.t('login.expired') : null;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [TextButton(key: const ValueKey('lang'), onPressed: widget.locale.toggle, child: Text(s.t('common.language')))],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            if (widget.subtitle != null) Text(widget.subtitle!, style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(s.t('login.title'), style: theme.textTheme.headlineMedium),
            const SizedBox(height: 8),
            if (notice != null) _Banner(text: notice, color: theme.colorScheme.errorContainer),
            if (_sentTo == null) ...[
              Text(s.t('login.phoneHelp')),
              const SizedBox(height: 16),
              TextField(
                key: const ValueKey('phone'),
                controller: _phone,
                keyboardType: TextInputType.phone,
                autofillHints: const [AutofillHints.telephoneNumber],
                decoration: InputDecoration(labelText: s.t('login.phone'), prefixText: '+216 '),
                onSubmitted: (_) => _sendCode(),
              ),
              const SizedBox(height: 16),
              FilledButton(key: const ValueKey('send-code'), onPressed: _busy ? null : _sendCode, child: Text(s.t('login.sendCode'))),
            ] else ...[
              Text(s.t('login.codeHelp', {'phone': _sentTo})),
              const SizedBox(height: 4),
              Text(s.t('login.devCode'), style: theme.textTheme.bodySmall),
              const SizedBox(height: 16),
              TextField(
                key: const ValueKey('code'),
                controller: _code,
                keyboardType: TextInputType.number,
                maxLength: 6,
                autofillHints: const [AutofillHints.oneTimeCode],
                decoration: InputDecoration(labelText: s.t('login.code')),
                onSubmitted: (_) => _verify(),
              ),
              const SizedBox(height: 8),
              FilledButton(key: const ValueKey('verify'), onPressed: _busy ? null : _verify, child: Text(s.t('login.verify'))),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  TextButton(onPressed: _busy ? null : () => setState(() => _sentTo = null), child: Text(s.t('login.changeNumber'))),
                  TextButton(onPressed: _busy ? null : _sendCode, child: Text(s.t('login.resend'))),
                ],
              ),
            ],
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: _Banner(text: _error!, color: theme.colorScheme.errorContainer, role: true)),
          ],
        ),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text, required this.color, this.role = false});

  final String text;
  final Color color;
  final bool role;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: role,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(8)),
        child: Text(text),
      ),
    );
  }
}
