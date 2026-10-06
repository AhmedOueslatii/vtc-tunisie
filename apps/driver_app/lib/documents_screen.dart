import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:vtc_core/vtc_core.dart';

import 'driver_controller.dart';

/// Envoi des pièces du dossier. Le sélecteur de fichier (galerie, appareil photo, PDF) est celui de la plateforme :
/// navigateur ici, système natif sur mobile.
class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key, required this.controller});

  final DriverController controller;

  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  final _expiry = TextEditingController();
  String? _sent;

  @override
  void initState() {
    super.initState();
    widget.controller.loadDocuments();
  }

  @override
  void dispose() {
    _expiry.dispose();
    super.dispose();
  }

  Future<void> _pick(String type) async {
    final s = Strings.of(context);
    final c = widget.controller;
    if (DriverDocument.needsExpiry(type) && !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(_expiry.text.trim())) {
      setState(() => _sent = null);
      c.fail('EXPIRY_REQUIRED');
      return;
    }
    final result = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: ['jpg', 'jpeg', 'png', 'pdf'], withData: true);
    final file = result?.files.single;
    if (file == null || file.bytes == null) return;
    setState(() => _sent = null);
    final ok = await c.uploadDocument(type: type, bytes: file.bytes!, filename: file.name, expiresAt: DriverDocument.needsExpiry(type) ? _expiry.text.trim() : null);
    if (mounted) setState(() => _sent = ok ? s.t('d.docSent') : null);
  }

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final theme = Theme.of(context);
    final c = widget.controller;
    final byType = {for (final d in c.documents) d.type: d};

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(s.t('d.docsTitle'), style: theme.textTheme.titleLarge),
        const SizedBox(height: 4),
        Text(s.t('d.docsHelp')),
        const SizedBox(height: 12),
        if (c.error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(s.error(c.error!.code), key: const ValueKey('error'), style: TextStyle(color: theme.colorScheme.error))),
        if (_sent != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_sent!, key: const ValueKey('doc-sent'))),
        for (final type in DriverDocument.required) _tile(context, s, type, byType[type]),
        const SizedBox(height: 8),
        TextField(
          key: const ValueKey('doc-expiry'),
          controller: _expiry,
          decoration: InputDecoration(labelText: '${s.t('d.docType.insurance')} · ${s.t('d.docExpiry')}'),
        ),
      ],
    );
  }

  Widget _tile(BuildContext context, Strings s, String type, DriverDocument? doc) {
    final status = doc == null ? 'none' : doc.status;
    final color = switch (status) {
      'approved' => Theme.of(context).colorScheme.primary,
      'rejected' || 'expired' => VtcColors.danger,
      'pending' => VtcColors.warning,
      _ => Theme.of(context).colorScheme.outline,
    };
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        title: Text(s.t('d.docType.$type')),
        // Le statut est écrit en toutes lettres : jamais la couleur seule
        subtitle: Text(
          [
            s.t('d.docStatus.$status'),
            if (doc?.rejectionReason != null) s.t('d.docReason', {'reason': doc!.rejectionReason}),
          ].join(' · '),
          style: TextStyle(color: color),
        ),
        trailing: OutlinedButton(
          key: ValueKey('doc-$type'),
          // Le thème impose une largeur pleine aux boutons : dans une ligne de liste il faut une taille propre
          style: OutlinedButton.styleFrom(minimumSize: const Size(96, 40)),
          onPressed: widget.controller.busy || status == 'approved' ? null : () => _pick(type),
          child: Text(doc == null ? s.t('d.docSend') : s.t('d.docReplace')),
        ),
      ),
    );
  }
}
