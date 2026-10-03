import 'package:flutter/material.dart';
import 'package:vtc_core/vtc_core.dart';

import 'driver_controller.dart';

/// Portefeuille : dette envers la plateforme (commission sur les courses en espèces) et gains.
class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key, required this.controller});

  final DriverController controller;

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  @override
  void initState() {
    super.initState();
    widget.controller.loadWallet();
  }

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final theme = Theme.of(context);
    final c = widget.controller;
    final wallet = c.wallet;

    if (wallet == null) {
      if (c.error != null) {
        return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [Text(s.error(c.error!.code)), TextButton(onPressed: c.loadWallet, child: Text(s.t('common.retry')))]));
      }
      return const Center(child: CircularProgressIndicator());
    }

    final stateColor = switch (wallet.state) {
      DebtState.ok => theme.colorScheme.primary,
      DebtState.warning => VtcColors.warning,
      DebtState.blocked => VtcColors.danger,
    };

    return RefreshIndicator(
      onRefresh: c.loadWallet,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(s.t('d.walletDebt'), style: theme.textTheme.labelLarge),
                  Text(formatDinars(wallet.debt), key: const ValueKey('wallet-debt'), style: theme.textTheme.headlineMedium?.copyWith(color: stateColor)),
                  Text(s.t('d.walletCeiling', {'ceiling': formatDinars(wallet.ceiling)})),
                  const SizedBox(height: 8),
                  // Barre de remplissage : la part du plafond déjà utilisée, avec le texte en clair à côté (jamais la couleur seule)
                  LinearProgressIndicator(value: wallet.ceiling == 0 ? 0 : (wallet.debt / wallet.ceiling).clamp(0, 1).toDouble(), color: stateColor, minHeight: 8),
                  if (wallet.state == DebtState.warning) Padding(padding: const EdgeInsets.only(top: 8), child: Text(s.t('d.debtWarning'), key: const ValueKey('debt-warning'))),
                  if (wallet.state == DebtState.blocked) Padding(padding: const EdgeInsets.only(top: 8), child: Text(s.t('d.debtBlocked'), key: const ValueKey('debt-blocked'))),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(s.t('d.walletNet', {'days': wallet.earnings.days}), style: theme.textTheme.labelLarge),
                  Text(formatDinars(wallet.earnings.net), key: const ValueKey('wallet-net'), style: theme.textTheme.headlineMedium),
                  const SizedBox(height: 8),
                  _row(s.t('d.walletTrips'), '${wallet.earnings.trips}'),
                  _row(s.t('d.walletGross'), formatDinars(wallet.earnings.gross)),
                  _row(s.t('d.walletCommission'), formatDinars(wallet.earnings.commission)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(s.t('d.walletHistory'), style: theme.textTheme.titleMedium),
          if (wallet.transactions.isEmpty) Padding(padding: const EdgeInsets.all(16), child: Text(s.t('d.walletEmpty'))),
          for (final tx in wallet.transactions)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(stringTables['fr']!.containsKey('d.txType.${tx.type}') ? s.t('d.txType.${tx.type}') : tx.type),
              subtitle: tx.createdAt == null ? null : Text(_date(tx.createdAt!)),
              // Signe explicite : le montant négatif augmente la dette
              trailing: Text('${tx.amount > 0 ? '+' : ''}${formatDinars(tx.amount)}'),
            ),
        ],
      ),
    );
  }

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text(label), Text(value)]),
      );

  String _date(DateTime d) => '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}
