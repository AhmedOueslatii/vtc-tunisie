import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:latlong2/latlong.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../api/api_client.dart';
import '../api/config.dart';
import '../models/models.dart';

/// Les objets reçus par Socket.IO ont des sous-objets en `Map<dynamic, dynamic>` : les modèles attendent des
/// `Map<String, dynamic>` et échoueraient sans bruit. On repasse par JSON pour tout typer d'un coup.
Map<String, dynamic> asJson(Object? data) => jsonDecode(jsonEncode(data)) as Map<String, dynamic>;

/// Connexion temps réel (Socket.IO, namespace `/rt`). Les événements manqués pendant une coupure ne sont pas rejoués :
/// à chaque (re)connexion, [onConnected] sert à se resynchroniser par l'API REST (`GET /trips/active`).
class RealtimeClient {
  RealtimeClient({required this.config, required this.api});

  final ApiConfig config;
  final ApiClient api;

  io.Socket? _socket;

  final _trips = StreamController<Trip>.broadcast();
  final _offers = StreamController<Offer>.broadcast();
  final _offerEnds = StreamController<String>.broadcast();
  final _notifications = StreamController<AppNotification>.broadcast();
  final _connection = StreamController<bool>.broadcast();

  /// Course mise à jour (passager ou chauffeur).
  Stream<Trip> get tripUpdates => _trips.stream;

  /// Nouvelle proposition de course (chauffeur).
  Stream<Offer> get offers => _offers.stream;

  /// Identifiant d'une proposition devenue caduque (expirée ou retirée).
  Stream<String> get offerEnds => _offerEnds.stream;

  Stream<AppNotification> get notifications => _notifications.stream;

  /// `true` à chaque connexion établie, `false` à chaque perte.
  Stream<bool> get connection => _connection.stream;

  bool get connected => _socket?.connected ?? false;

  void connect() {
    final token = api.accessToken;
    if (token == null || _socket != null) return;
    final socket = io.io(
      config.realtimeUrl,
      io.OptionBuilder().setTransports(['websocket']).setAuth({'token': token}).disableAutoConnect().build(),
    );
    _socket = socket;

    socket.onConnect((_) => _connection.add(true));
    socket.onDisconnect((_) => _connection.add(false));
    // Jeton expiré au handshake : on le renouvelle puis on réessaie avec le nouveau.
    socket.onConnectError((_) async {
      if (await api.refreshNow() && api.accessToken != null && _socket == socket) {
        socket.auth = {'token': api.accessToken};
        socket.connect();
      }
    });
    socket.on('trip:updated', (data) => _safe(() => _trips.add(Trip.fromJson(asJson(data)))));
    socket.on('trip:offer', (data) => _safe(() => _offers.add(Offer.fromJson(asJson(data)))));
    for (final event in ['trip:offer_expired', 'trip:offer_cancelled']) {
      socket.on(event, (data) => _safe(() => _offerEnds.add(asJson(data)['offerId'] as String)));
    }
    socket.on('notification:new', (data) => _safe(() => _notifications.add(AppNotification.fromJson(asJson(data)))));
    socket.connect();
  }

  /// Position du chauffeur. Sans accusé de réception positif (hors ligne côté serveur), l'appel est ignoré.
  void sendLocation(LatLng point) {
    _socket?.emit('driver:location', {'lat': point.latitude, 'lng': point.longitude, 'ts': DateTime.now().millisecondsSinceEpoch});
  }

  void disconnect() {
    _socket?.dispose();
    _socket = null;
  }

  Future<void> dispose() async {
    disconnect();
    await Future.wait([_trips.close(), _offers.close(), _offerEnds.close(), _notifications.close(), _connection.close()]);
  }

  /// Un événement mal formé ne doit pas faire tomber la connexion : on l'ignore.
  void _safe(void Function() action) {
    try {
      action();
    } catch (e) {
      // Journalisé plutôt qu'avalé : un événement illisible est un bug à voir, pas un silence
      debugPrint('Temps réel : événement ignoré ($e)');
    }
  }
}
