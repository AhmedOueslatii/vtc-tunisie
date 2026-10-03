import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:latlong2/latlong.dart';
import 'package:vtc_core/vtc_core.dart';

/// Position de départ simulée : le navigateur ne remplace pas un GPS de véhicule. La position du chauffeur est isolée
/// dans [DriverController.position] pour être remplacée par la vraie géolocalisation (plugin natif) dans l'app mobile.
const simulatedStart = tunisCenter;

/// État et actions de l'application chauffeur : disponibilité, offres, déroulé de la course, portefeuille.
class DriverController extends ChangeNotifier {
  DriverController({required this.api, required this.realtime});

  final ApiClient api;
  final RealtimeClient realtime;

  /// `null` tant que le chauffeur n'a pas déposé de candidature.
  DriverProfile? profile;
  bool profileLoaded = false;
  Offer? offer;
  Trip? trip;
  Wallet? wallet;
  bool busy = false;
  ApiException? error;

  /// Position envoyée à l'API. Simulée : elle ne bouge que pour « rejoindre » le client avant de signaler l'arrivée.
  LatLng position = simulatedStart;

  /// Chaque seconde tant qu'une offre est affichée, pour le compte à rebours.
  int offerSecondsLeft = 0;

  StreamSubscription<Trip>? _tripSub;
  StreamSubscription<Offer>? _offerSub;
  StreamSubscription<String>? _offerEndSub;
  StreamSubscription<bool>? _connSub;
  Timer? _offerTimer;
  Timer? _locationTimer;
  bool _disposed = false;

  bool get online => profile?.online ?? false;
  bool get approved => profile?.status == DriverStatus.approved;

  Future<void> start() async {
    _tripSub = realtime.tripUpdates.listen(_onTrip);
    _offerSub = realtime.offers.listen(_onOffer);
    _offerEndSub = realtime.offerEnds.listen((id) {
      if (offer?.offerId == id) _clearOffer();
    });
    _connSub = realtime.connection.where((up) => up).listen((_) => syncActive());
    realtime.connect();
    await loadProfile();
    await syncActive();
  }

  Future<void> loadProfile() async {
    try {
      final data = await api.get('/drivers/me');
      profile = data == null ? null : DriverProfile.fromJson(data as Json);
      profileLoaded = true;
      if (online) _startLocationLoop();
      _notify();
    } on ApiException catch (e) {
      // Pas de candidature : l'API répond « introuvable » ou un corps vide selon le cas
      if (e.status == 404) {
        profile = null;
        profileLoaded = true;
      } else {
        error = e;
      }
      _notify();
    }
  }

  Future<void> syncActive() async {
    try {
      final data = await api.get('/trips/active') as Json;
      final active = data['trip'];
      trip = active == null ? null : Trip.fromJson(active as Json);
      if (trip != null) _clearOffer();
      _notify();
    } on ApiException catch (e) {
      error = e;
      _notify();
    }
  }

  // ─── Candidature ───────────────────────────────────────────────────────────

  Future<void> apply({
    required String cin,
    required String license,
    required String licenseExpiry,
    required String make,
    required String model,
    required String color,
    required int year,
    required String plate,
  }) async {
    await _guard(() async {
      try {
        await api.post('/drivers/onboarding', body: {'cinNumber': cin, 'licenseNumber': license, 'licenseExpiry': licenseExpiry});
      } on ApiException catch (e) {
        // Candidature déjà créée par un essai précédent (le véhicule avait échoué) : on poursuit avec le véhicule
        if (e.code != 'DRIVER_ALREADY_REGISTERED') rethrow;
      }
      await api.post('/drivers/me/vehicles', body: {'make': make, 'model': model, 'color': color, 'year': year, 'plate': plate});
      await loadProfile();
    });
  }

  // ─── Disponibilité ─────────────────────────────────────────────────────────

  Future<void> setOnline(bool value) async {
    await _guard(() async {
      if (value) await _sendLocation(); // l'API ne propose des courses qu'aux chauffeurs dont la position est connue
      await api.post('/drivers/me/availability', body: {'online': value});
      await loadProfile();
      if (value) {
        await _sendLocation();
        _startLocationLoop();
      } else {
        _locationTimer?.cancel();
        _clearOffer();
      }
    });
  }

  Future<void> _sendLocation() async {
    final p = position;
    await api.post('/drivers/me/location', body: {
      'points': [
        {'lat': p.latitude, 'lng': p.longitude, 'ts': DateTime.now().millisecondsSinceEpoch},
      ],
    });
  }

  void _startLocationLoop() {
    _locationTimer?.cancel();
    // Fréquence réduite pour le POC ; l'app native enverra par lots selon le mouvement
    _locationTimer = Timer.periodic(const Duration(seconds: 10), (_) => realtime.sendLocation(position));
  }

  // ─── Offres ────────────────────────────────────────────────────────────────

  void _onOffer(Offer incoming) {
    offer = incoming;
    _offerTimer?.cancel();
    void tick() {
      offerSecondsLeft = incoming.expiresAt.difference(DateTime.now()).inSeconds.clamp(0, 999);
      if (offerSecondsLeft == 0) {
        _clearOffer();
      } else {
        _notify();
      }
    }

    tick();
    _offerTimer = Timer.periodic(const Duration(seconds: 1), (_) => tick());
  }

  void _clearOffer() {
    _offerTimer?.cancel();
    offer = null;
    _notify();
  }

  Future<void> acceptOffer() async {
    final current = offer;
    if (current == null) return;
    await _guard(() async {
      final data = await api.post('/trips/${current.tripId}/accept') as Json;
      trip = Trip.fromJson(data);
      _clearOffer();
      await loadProfile();
    });
    // L'offre a pu être reprise par un autre chauffeur entre-temps : on n'affiche plus rien
    if (error != null) _clearOffer();
  }

  Future<void> declineOffer() async {
    final current = offer;
    if (current == null) return;
    _clearOffer();
    await _guard(() async {
      await api.post('/trips/${current.tripId}/decline');
    });
  }

  // ─── Déroulé de la course ──────────────────────────────────────────────────

  void _onTrip(Trip updated) {
    trip = updated;
    if (updated.status.isActive) _clearOffer();
    _notify();
    if (!updated.status.isActive) loadProfile(); // la course se termine : le chauffeur redevient disponible
  }

  Future<void> _step(String action) async {
    final current = trip;
    if (current == null) return;
    await _guard(() async {
      final data = await api.post('/trips/${current.id}/$action') as Json;
      trip = Trip.fromJson(data);
    });
  }

  Future<void> markArrived() async {
    final current = trip;
    if (current == null) return;
    // L'API vérifie que le chauffeur est à moins de 500 m du départ : en simulation, on s'y « rend » d'abord.
    position = current.pickup;
    try {
      await _sendLocation();
    } on ApiException catch (e) {
      error = e;
      _notify();
      return;
    }
    await _step('arrived');
  }

  Future<void> startTrip() => _step('start');
  Future<void> completeTrip() => _step('complete');
  Future<void> confirmCash() => _step('cash-collected');

  /// Revient à l'accueil une fois la course terminée et encaissée.
  void closeTrip() {
    trip = null;
    error = null;
    _notify();
    loadProfile();
  }

  // ─── Portefeuille ──────────────────────────────────────────────────────────

  Future<void> loadWallet({int days = 30}) async {
    await _guard(() async {
      wallet = Wallet.fromJson(await api.get('/drivers/me/wallet', query: {'days': days}) as Json);
    });
  }

  Future<void> _guard(Future<void> Function() action) async {
    busy = true;
    error = null;
    _notify();
    try {
      await action();
    } on ApiException catch (e) {
      error = e;
    } finally {
      busy = false;
      _notify();
    }
  }

  void clearError() {
    error = null;
    _notify();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _offerTimer?.cancel();
    _locationTimer?.cancel();
    _tripSub?.cancel();
    _offerSub?.cancel();
    _offerEndSub?.cancel();
    _connSub?.cancel();
    super.dispose();
  }
}
