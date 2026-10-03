import 'package:flutter/material.dart';
import 'package:vtc_core/vtc_core.dart';

import 'driver_controller.dart';
import 'onboarding_screen.dart';
import 'wallet_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.controller, required this.session, required this.locale});

  final DriverController controller;
  final AuthSession session;
  final LocaleController locale;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final c = widget.controller;
    return Scaffold(
      appBar: AppBar(
        title: Text(_tab == 0 ? s.t('d.tabHome') : s.t('d.tabWallet')),
        actions: [
          TextButton(key: const ValueKey('lang'), onPressed: widget.locale.toggle, child: Text(s.t('common.language'))),
          IconButton(key: const ValueKey('logout'), tooltip: s.t('common.logout'), icon: const Icon(Icons.logout), onPressed: widget.session.logout),
        ],
      ),
      body: ListenableBuilder(
        listenable: c,
        builder: (context, _) {
          if (!c.profileLoaded) return const Center(child: CircularProgressIndicator());
          if (c.profile == null) return OnboardingScreen(controller: c);
          return _tab == 0 ? _HomeTab(controller: c) : WalletScreen(controller: c);
        },
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.directions_car_outlined), label: s.t('d.tabHome')),
          NavigationDestination(icon: const Icon(Icons.account_balance_wallet_outlined), label: s.t('d.tabWallet')),
        ],
      ),
    );
  }
}

class _HomeTab extends StatelessWidget {
  const _HomeTab({required this.controller});

  final DriverController controller;

  @override
  Widget build(BuildContext context) {
    final trip = controller.trip;
    final offer = controller.offer;
    return Stack(
      children: [
        Column(
          children: [
            Expanded(child: _DriverMap(controller: controller)),
            Material(
              elevation: 8,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: SingleChildScrollView(
                  child: trip != null ? _TripPanel(controller: controller, trip: trip) : _AvailabilityPanel(controller: controller),
                ),
              ),
            ),
          ],
        ),
        if (offer != null && trip == null) _OfferSheet(controller: controller, offer: offer),
      ],
    );
  }
}

class _DriverMap extends StatelessWidget {
  const _DriverMap({required this.controller});

  final DriverController controller;

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final trip = controller.trip;
    final offer = controller.offer;
    final pins = <MapPin>[
      MapPin(point: controller.position, icon: Icons.directions_car, color: VtcColors.brand, label: s.t('d.online')),
      if (trip != null) ...[
        MapPin(point: trip.pickup, icon: Icons.trip_origin, color: VtcColors.warning, label: s.t('p.pickup')),
        MapPin(point: trip.dropoff, icon: Icons.location_on, color: VtcColors.danger, label: s.t('p.dropoff')),
      ] else if (offer != null) ...[
        MapPin(point: offer.pickup, icon: Icons.trip_origin, color: VtcColors.warning, label: s.t('p.pickup')),
        MapPin(point: offer.dropoff, icon: Icons.location_on, color: VtcColors.danger, label: s.t('p.dropoff')),
      ],
    ];
    return VtcMap(center: controller.position, fitToPins: pins.length > 1, pins: pins);
  }
}

// ─── Disponibilité ───────────────────────────────────────────────────────────

class _AvailabilityPanel extends StatelessWidget {
  const _AvailabilityPanel({required this.controller});

  final DriverController controller;

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final theme = Theme.of(context);
    final profile = controller.profile!;
    final approved = controller.approved;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          approved ? (controller.online ? s.t('d.online') : s.t('d.offline')) : s.t('d.status.${profile.status.key}'),
          key: const ValueKey('availability'),
          style: theme.textTheme.titleLarge,
        ),
        if (profile.status == DriverStatus.rejected && profile.rejectionReason != null) Text(profile.rejectionReason!),
        if (approved && controller.online) ...[
          const SizedBox(height: 4),
          Text(s.t('d.waiting')),
        ],
        const SizedBox(height: 12),
        if (controller.error != null) _ErrorText(code: controller.error!.code),
        if (approved)
          controller.online
              ? OutlinedButton(key: const ValueKey('go-offline'), onPressed: controller.busy ? null : () => controller.setOnline(false), child: Text(s.t('d.goOffline')))
              : FilledButton(key: const ValueKey('go-online'), onPressed: controller.busy ? null : () => controller.setOnline(true), child: Text(s.t('d.goOnline'))),
      ],
    );
  }
}

// ─── Offre ───────────────────────────────────────────────────────────────────

class _OfferSheet extends StatelessWidget {
  const _OfferSheet({required this.controller, required this.offer});

  final DriverController controller;
  final Offer offer;

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final theme = Theme.of(context);
    return Positioned(
      left: 12,
      right: 12,
      top: 12,
      child: Card(
        elevation: 8,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(child: Text(s.t('d.offerTitle'), key: const ValueKey('offer-title'), style: theme.textTheme.titleLarge)),
                  Text(s.t('d.offerExpiresIn', {'s': controller.offerSecondsLeft}), style: theme.textTheme.labelLarge),
                ],
              ),
              const SizedBox(height: 4),
              Text(formatDinars(offer.price), key: const ValueKey('offer-price'), style: theme.textTheme.headlineMedium),
              const SizedBox(height: 4),
              Text(s.t('d.toPickup', {'distance': formatDistance(offer.distanceToPickupM)})),
              Text(s.t('d.tripLength', {'distance': formatDistance(offer.distanceM), 'duration': formatMinutes(offer.durationS)})),
              if (offer.pickupAddress != null) Text('${s.t('p.pickup')} : ${offer.pickupAddress}', maxLines: 1, overflow: TextOverflow.ellipsis),
              if (offer.dropoffAddress != null) Text('${s.t('p.dropoff')} : ${offer.dropoffAddress}', maxLines: 1, overflow: TextOverflow.ellipsis),
              if (offer.passengerFirstName != null) Text(s.t('d.passenger', {'name': offer.passengerFirstName})),
              if (controller.error != null) _ErrorText(code: controller.error!.code),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: OutlinedButton(key: const ValueKey('decline'), onPressed: controller.busy ? null : controller.declineOffer, child: Text(s.t('d.offerDecline')))),
                  const SizedBox(width: 12),
                  Expanded(child: FilledButton(key: const ValueKey('accept'), onPressed: controller.busy ? null : controller.acceptOffer, child: Text(s.t('d.offerAccept')))),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Course ──────────────────────────────────────────────────────────────────

class _TripPanel extends StatelessWidget {
  const _TripPanel({required this.controller, required this.trip});

  final DriverController controller;
  final Trip trip;

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final theme = Theme.of(context);
    final status = trip.status;
    final busy = controller.busy;

    FilledButton action(String key, String label, VoidCallback onPressed) =>
        FilledButton(key: ValueKey(key), onPressed: busy ? null : onPressed, child: Text(label));

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          liveRegion: true,
          child: Text(s.t('tripStatus.${status.key}'), key: const ValueKey('trip-status'), style: theme.textTheme.titleLarge),
        ),
        const SizedBox(height: 4),
        if (trip.dropoffAddress != null) Text('${s.t('p.dropoff')} : ${trip.dropoffAddress}'),
        Text(formatDinars(trip.price), key: const ValueKey('trip-price'), style: theme.textTheme.headlineSmall),
        const SizedBox(height: 12),
        if (controller.error != null) _ErrorText(code: controller.error!.code),
        if (status == TripStatus.driverAssigned) action('arrived', s.t('d.arrived'), controller.markArrived),
        if (status == TripStatus.driverArrived) action('start', s.t('d.start'), controller.startTrip),
        if (status == TripStatus.inProgress) action('complete', s.t('d.complete'), controller.completeTrip),
        if (status == TripStatus.completed) ...[
          if (trip.payment?.status == 'succeeded')
            Text(s.t('d.cashCollected'), key: const ValueKey('cash-done'), style: theme.textTheme.titleMedium)
          else
            action('collect-cash', s.t('d.collectCash', {'amount': formatDinars(trip.price)}), controller.confirmCash),
          const SizedBox(height: 8),
          if (trip.payment?.status == 'succeeded') FilledButton(key: const ValueKey('close-trip'), onPressed: controller.closeTrip, child: Text(s.t('common.close'))),
        ],
        if (!status.isActive && status != TripStatus.completed)
          FilledButton(key: const ValueKey('close-trip'), onPressed: controller.closeTrip, child: Text(s.t('common.close'))),
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
