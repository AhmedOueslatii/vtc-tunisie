import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:latlong2/latlong.dart';
import 'package:vtc_core/vtc_core.dart';

/// Tunis centre : tant que la géolocalisation n'est pas branchée, c'est le départ proposé par défaut.
const defaultPickup = Place(id: 'default', name: 'Tunis centre', address: 'Tunis', point: tunisCenter);

/// État et actions de l'application passager : commande d'une course, suivi en direct, notation.
class PassengerController extends ChangeNotifier {
  PassengerController({required this.api, required this.realtime});

  final ApiClient api;
  final RealtimeClient realtime;

  Place pickup = defaultPickup;
  Place? dropoff;
  Estimate? estimate;
  Trip? trip;
  List<TripSummary> history = const [];
  bool busy = false;
  bool rated = false;

  /// Dernière erreur d'API, à traduire à l'affichage.
  ApiException? error;

  StreamSubscription<Trip>? _tripSub;
  StreamSubscription<bool>? _connSub;
  bool _disposed = false;

  Future<void> start() async {
    _tripSub = realtime.tripUpdates.listen(_onTrip);
    // Les événements manqués pendant une coupure ne sont pas rejoués : on se resynchronise à chaque reconnexion.
    _connSub = realtime.connection.where((up) => up).listen((_) => syncActive());
    realtime.connect();
    await syncActive();
  }

  Future<void> syncActive() async {
    try {
      final data = await api.get('/trips/active') as Json;
      final active = data['trip'];
      _setTrip(active == null ? null : Trip.fromJson(active as Json));
    } on ApiException catch (e) {
      error = e;
      _notify();
    }
  }

  void _onTrip(Trip updated) {
    // On ignore les courses qui ne sont pas celle qu'on suit (ancienne course terminée, par exemple)
    if (trip != null && trip!.id != updated.id && !updated.status.isActive) return;
    _setTrip(updated);
  }

  void _setTrip(Trip? next) {
    if (next?.id != trip?.id) rated = false;
    trip = next;
    if (next != null && next.status.isActive) estimate = null;
    _notify();
  }

  // ─── Commande ──────────────────────────────────────────────────────────────

  Future<List<Place>> search(String query) async {
    final data = await api.get('/places/search', query: {
      'q': query,
      'lat': pickup.point.latitude,
      'lng': pickup.point.longitude,
      'limit': 6,
    });
    return [for (final p in (data as List)) Place.fromJson(p as Json)];
  }

  void setPickup(Place place) {
    pickup = place;
    estimate = null;
    _notify();
  }

  void setDropoff(Place place) {
    dropoff = place;
    estimate = null;
    _notify();
  }

  Future<void> getEstimate() async {
    final to = dropoff;
    if (to == null) return;
    await _guard(() async {
      final data = await api.post('/trips/estimate', body: {
        'pickup': {'lat': pickup.point.latitude, 'lng': pickup.point.longitude},
        'dropoff': {'lat': to.point.latitude, 'lng': to.point.longitude},
        'pickupAddress': pickup.label,
        'dropoffAddress': to.label,
      }) as Json;
      estimate = Estimate.fromJson(data);
    });
  }

  Future<void> order() async {
    final quote = estimate;
    if (quote == null) return;
    await _guard(() async {
      // Clé d'idempotence : si la réponse se perd, un nouvel essai ne crée pas une deuxième course.
      final key = 'web-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(0x7fffffff)}';
      final data = await api.post('/trips', body: {'quoteId': quote.quoteId, 'paymentMethod': 'cash'}, headers: {'idempotency-key': key}) as Json;
      _setTrip(Trip.fromJson(data));
    });
  }

  Future<void> cancel() async {
    final current = trip;
    if (current == null) return;
    await _guard(() async {
      final data = await api.post('/trips/${current.id}/cancel', body: {}) as Json;
      _setTrip(Trip.fromJson(data));
    });
  }

  Future<void> rate(int score) async {
    final current = trip;
    if (current == null) return;
    await _guard(() async {
      await api.post('/trips/${current.id}/rating', body: {'score': score});
      rated = true;
    });
  }

  /// Retour à l'écran de commande après une course terminée ou annulée.
  void reset() {
    trip = null;
    estimate = null;
    dropoff = null;
    rated = false;
    error = null;
    _notify();
  }

  Future<void> loadHistory() async {
    await _guard(() async {
      final data = await api.get('/trips', query: {'limit': 20}) as Json;
      history = [for (final item in (data['items'] as List)) TripSummary.fromJson(item as Json)];
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

  /// Repères de la carte : départ, arrivée et, pendant l'approche, le chauffeur n'est pas positionné (l'API ne
  /// diffuse pas sa position au passager dans cette version : seulement l'ETA).
  LatLng get mapCenter => trip?.pickup ?? pickup.point;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _tripSub?.cancel();
    _connSub?.cancel();
    super.dispose();
  }
}
