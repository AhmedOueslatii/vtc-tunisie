import 'package:flutter/material.dart';
import 'package:vtc_core/vtc_core.dart';

import 'driver_controller.dart';

/// Candidature : identité et véhicule. L'envoi des scans de documents (caméra, fichiers) se fera dans l'app mobile.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, required this.controller});

  final DriverController controller;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  /// Message d'erreur, avec le nom des champs refusés par l'API quand elle les indique.
  String _errorMessage(Strings s, ApiException error) {
    final issues = error.details?['issues'];
    if (issues is! List || issues.isEmpty) return s.error(error.code);
    final fields = {for (final i in issues) if (i is Map && i['path'] != null && '${i['path']}'.isNotEmpty) '${i['path']}'};
    return fields.isEmpty ? s.error(error.code) : '${s.error(error.code)} (${fields.join(', ')})';
  }

  final _form = GlobalKey<FormState>();
  final _cin = TextEditingController();
  final _license = TextEditingController();
  final _expiry = TextEditingController();
  final _make = TextEditingController();
  final _model = TextEditingController();
  final _color = TextEditingController();
  final _year = TextEditingController();
  final _plate = TextEditingController();

  @override
  void dispose() {
    for (final c in [_cin, _license, _expiry, _make, _model, _color, _year, _plate]) {
      c.dispose();
    }
    super.dispose();
  }

  void _submit() {
    if (!_form.currentState!.validate()) return;
    widget.controller.apply(
      cin: _cin.text.trim(),
      license: _license.text.trim(),
      licenseExpiry: _expiry.text.trim(),
      make: _make.text.trim(),
      model: _model.text.trim(),
      color: _color.text.trim(),
      year: int.parse(_year.text.trim()),
      plate: _plate.text.trim(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final c = widget.controller;

    Widget field(String key, TextEditingController controller, String label, {TextInputType? type, String? Function(String)? check}) => Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: TextFormField(
            key: ValueKey(key),
            controller: controller,
            keyboardType: type,
            decoration: InputDecoration(labelText: label),
            validator: (v) {
              final value = (v ?? '').trim();
              if (value.isEmpty) return s.t('err.VALIDATION_FAILED');
              return check?.call(value);
            },
          ),
        );

    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(s.t('d.onboardTitle'), style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 8),
        Text(s.t('d.onboardHelp')),
        const SizedBox(height: 16),
        Form(
          key: _form,
          child: Column(
            children: [
              field('cin', _cin, s.t('d.cin'), type: TextInputType.number, check: (v) => RegExp(r'^\d{8}$').hasMatch(v) ? null : s.t('err.CIN_INVALID')),
              field('license', _license, s.t('d.license')),
              field('license-expiry', _expiry, s.t('d.licenseExpiry'), check: (v) => RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(v) ? null : s.t('err.VALIDATION_FAILED')),
              field('make', _make, s.t('d.vehicleMake')),
              field('model', _model, s.t('d.vehicleModel')),
              field('color', _color, s.t('d.vehicleColor')),
              field('year', _year, s.t('d.vehicleYear'), type: TextInputType.number, check: (v) => int.tryParse(v) == null ? s.t('err.VALIDATION_FAILED') : null),
              field('plate', _plate, s.t('d.vehiclePlate')),
            ],
          ),
        ),
        if (c.error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_errorMessage(s, c.error!), key: const ValueKey('error'), style: TextStyle(color: Theme.of(context).colorScheme.error))),
        FilledButton(key: const ValueKey('apply'), onPressed: c.busy ? null : _submit, child: Text(s.t('d.onboardSend'))),
      ],
    );
  }
}
