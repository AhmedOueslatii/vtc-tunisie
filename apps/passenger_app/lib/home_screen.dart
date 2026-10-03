import 'package:flutter/material.dart';
import 'package:vtc_core/vtc_core.dart';

import 'history_screen.dart';
import 'passenger_controller.dart';
import 'place_search.dart';

/// Carte en haut, panneau d'action en bas : commande, attente, suivi, fin de course.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key, required this.controller, required this.session, required this.locale});

  final PassengerController controller;
  final AuthSession session;
  final LocaleController locale;

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(s.t('p.where')),
        actions: [
          IconButton(
            key: const ValueKey('history'),
            tooltip: s.t('p.history'),
            icon: const Icon(Icons.history),
            onPressed: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => HistoryScreen(controller: controller))),
          ),
          TextButton(key: const ValueKey('lang'), onPressed: locale.toggle, child: Text(s.t('common.language'))),
          IconButton(key: const ValueKey('logout'), tooltip: s.t('common.logout'), icon: const Icon(Icons.logout), onPressed: session.logout),
        ],
      ),
      body: ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final trip = controller.trip;
          return Column(
            children: [
              Expanded(child: _MapArea(controller: controller)),
              Material(
                elevation: 8,
                child: SafeArea(
                  top: false,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: SingleChildScrollView(
                      child: trip == null ? _OrderPanel(controller: controller) : _TripPanel(controller: controller, trip: trip),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _MapArea extends StatelessWidget {
  const _MapArea({required this.controller});

  final PassengerController controller;

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final trip = controller.trip;
    final pickup = trip?.pickup ?? controller.pickup.point;
    final dropoff = trip?.dropoff ?? controller.dropoff?.point;
    return VtcMap(
      center: pickup,
      fitToPins: dropoff != null,
      pins: [
        MapPin(point: pickup, icon: Icons.trip_origin, color: VtcColors.brand, label: s.t('p.pickup')),
        if (dropoff != null) MapPin(point: dropoff, icon: Icons.location_on, color: VtcColors.danger, label: s.t('p.dropoff')),
      ],
    );
  }
}

// ─── Commande ────────────────────────────────────────────────────────────────

class _OrderPanel extends StatelessWidget {
  const _OrderPanel({required this.controller});

  final PassengerController controller;

  Future<void> _pick(BuildContext context, {required bool pickup}) async {
    final s = Strings.of(context);
    final place = await Navigator.push<Place>(
      context,
      MaterialPageRoute(
        builder: (_) => PlaceSearchScreen(
          title: s.t(pickup ? 'p.pickup' : 'p.dropoff'),
          search: controller.search,
          suggestion: pickup ? defaultPickup : null,
        ),
      ),
    );
    if (place == null) return;
    pickup ? controller.setPickup(place) : controller.setDropoff(place);
  }

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final estimate = controller.estimate;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _AddressField(
          fieldKey: const ValueKey('pickup-field'),
          icon: Icons.trip_origin,
          label: s.t('p.pickup'),
          value: controller.pickup.label,
          onTap: () => _pick(context, pickup: true),
        ),
        const SizedBox(height: 8),
        _AddressField(
          fieldKey: const ValueKey('dropoff-field'),
          icon: Icons.location_on,
          label: s.t('p.dropoff'),
          value: controller.dropoff?.label,
          onTap: () => _pick(context, pickup: false),
        ),
        const SizedBox(height: 12),
        if (controller.error != null) _ErrorText(code: controller.error!.code),
        if (estimate == null)
          FilledButton(
            key: const ValueKey('estimate'),
            onPressed: controller.busy || controller.dropoff == null ? null : controller.getEstimate,
            child: Text(s.t('p.estimate')),
          )
        else ...[
          _EstimateCard(estimate: estimate),
          const SizedBox(height: 12),
          FilledButton(
            key: const ValueKey('order'),
            onPressed: controller.busy ? null : controller.order,
            child: Text(controller.busy ? s.t('p.ordering') : s.t('p.order')),
          ),
        ],
      ],
    );
  }
}

class _AddressField extends StatelessWidget {
  const _AddressField({required this.fieldKey, required this.icon, required this.label, required this.value, required this.onTap});

  final Key fieldKey;
  final IconData icon;
  final String label;
  final String? value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: '$label : ${value ?? ''}',
      excludeSemantics: true,
      child: InkWell(
        key: fieldKey,
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: InputDecorator(
          decoration: InputDecoration(labelText: label, prefixIcon: Icon(icon)),
          child: Text(value ?? Strings.of(context).t('p.searchPlace'), maxLines: 1, overflow: TextOverflow.ellipsis),
        ),
      ),
    );
  }
}

class _EstimateCard extends StatelessWidget {
  const _EstimateCard({required this.estimate});

  final Estimate estimate;

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(s.t('p.price'), style: theme.textTheme.labelLarge),
            Text(formatDinars(estimate.price), key: const ValueKey('estimate-price'), style: theme.textTheme.headlineMedium),
            const SizedBox(height: 4),
            Text('${formatDistance(estimate.distanceM)} · ${formatMinutes(estimate.durationS)}'),
            const SizedBox(height: 4),
            Text(s.t('p.priceHint'), style: theme.textTheme.bodySmall),
            const SizedBox(height: 4),
            Row(children: [const Icon(Icons.payments_outlined, size: 18), const SizedBox(width: 6), Expanded(child: Text(s.t('p.payCash')))]),
          ],
        ),
      ),
    );
  }
}

// ─── Course en cours ─────────────────────────────────────────────────────────

class _TripPanel extends StatelessWidget {
  const _TripPanel({required this.controller, required this.trip});

  final PassengerController controller;
  final Trip trip;

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final theme = Theme.of(context);
    final driver = trip.driver;
    final status = trip.status;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          liveRegion: true,
          child: Text(s.t('tripStatus.${status.key}'), key: const ValueKey('trip-status'), style: theme.textTheme.titleLarge),
        ),
        const SizedBox(height: 8),
        if (status == TripStatus.requested) const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: LinearProgressIndicator()),
        if (driver != null && status.isActive) _DriverCard(driver: driver, eta: status == TripStatus.driverAssigned ? trip.driverEta : null),
        if (status.isActive) ...[
          const SizedBox(height: 8),
          Text('${s.t('p.price')} : ${formatDinars(trip.quotedPrice)}'),
        ],
        if (controller.error != null) _ErrorText(code: controller.error!.code),
        if (status == TripStatus.completed) ..._completed(context, s, theme),
        if (status == TripStatus.cancelledByPassenger && (trip.cancellationFee ?? 0) > 0)
          Text(s.t('p.cancelledFee', {'fee': formatDinars(trip.cancellationFee!)})),
        if (status.isActive && status != TripStatus.inProgress) ...[
          const SizedBox(height: 12),
          OutlinedButton(key: const ValueKey('cancel-trip'), onPressed: controller.busy ? null : () => _confirmCancel(context), child: Text(s.t('p.cancelTrip'))),
        ],
        if (!status.isActive && status != TripStatus.completed) ...[
          const SizedBox(height: 12),
          FilledButton(key: const ValueKey('new-trip'), onPressed: controller.reset, child: Text(s.t('p.newTrip'))),
        ],
      ],
    );
  }

  List<Widget> _completed(BuildContext context, Strings s, ThemeData theme) {
    return [
      Text(s.t('p.total'), style: theme.textTheme.labelLarge),
      Text(formatDinars(trip.price), key: const ValueKey('final-price'), style: theme.textTheme.headlineMedium),
      Text(s.t('p.payDriver')),
      const SizedBox(height: 12),
      if (controller.rated)
        Text(s.t('p.rateThanks'), key: const ValueKey('rated'))
      else
        _Rating(onRate: controller.busy ? null : controller.rate),
      const SizedBox(height: 12),
      FilledButton(key: const ValueKey('new-trip'), onPressed: controller.reset, child: Text(s.t('p.newTrip'))),
    ];
  }

  Future<void> _confirmCancel(BuildContext context) async {
    final s = Strings.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(s.t('p.cancelTrip')),
        content: Text(trip.status == TripStatus.requested ? s.t('common.confirm') : s.t('p.cancelFeeMaybe')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(s.t('common.back'))),
          FilledButton(key: const ValueKey('confirm-cancel'), onPressed: () => Navigator.pop(context, true), child: Text(s.t('common.confirm'))),
        ],
      ),
    );
    if (ok == true) await controller.cancel();
  }
}

class _DriverCard extends StatelessWidget {
  const _DriverCard({required this.driver, required this.eta});

  final DriverCard driver;
  final DriverEta? eta;

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final vehicle = driver.vehicle;
    return Card(
      margin: EdgeInsets.zero,
      child: ListTile(
        leading: const CircleAvatar(child: Icon(Icons.person)),
        title: Text('${driver.fullName ?? ''}${driver.rating == null ? '' : '  ★ ${driver.rating!.toStringAsFixed(1)}'}'),
        subtitle: Text([
          if (vehicle != null) vehicle.label,
          if (vehicle != null) s.t('p.plate', {'plate': vehicle.plate}),
          if (eta != null) s.t('p.driverEta', {'eta': formatMinutes(eta!.durationS)}),
        ].join('\n')),
        isThreeLine: true,
      ),
    );
  }
}

class _Rating extends StatefulWidget {
  const _Rating({required this.onRate});

  final Future<void> Function(int score)? onRate;

  @override
  State<_Rating> createState() => _RatingState();
}

class _RatingState extends State<_Rating> {
  int _score = 5;

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(s.t('p.rateTitle'), style: Theme.of(context).textTheme.titleMedium),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            for (var i = 1; i <= 5; i++)
              IconButton(
                key: ValueKey('star-$i'),
                tooltip: '$i',
                icon: Icon(i <= _score ? Icons.star : Icons.star_border, color: Colors.amber.shade700, size: 32),
                onPressed: () => setState(() => _score = i),
              ),
          ],
        ),
        OutlinedButton(key: const ValueKey('send-rating'), onPressed: widget.onRate == null ? null : () => widget.onRate!(_score), child: Text(s.t('p.rateSend'))),
      ],
    );
  }
}

class _ErrorText extends StatelessWidget {
  const _ErrorText({required this.code});

  final String code;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(Strings.of(context).error(code), key: const ValueKey('error'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
      ),
    );
  }
}
