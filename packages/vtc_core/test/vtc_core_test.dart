import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:vtc_core/vtc_core.dart';

http.Response json(int status, Object body) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});

ApiClient client(MockClient mock, {Tokens? tokens, void Function(SessionEnd)? onEnd}) => ApiClient(
      config: const ApiConfig(baseUrl: 'http://api.test/v1'),
      store: MemoryTokenStore(tokens ?? const Tokens(accessToken: 'old', refreshToken: 'refresh')),
      client: mock,
      onSessionEnded: onEnd,
    );

void main() {
  group('ApiClient', () {
    test('ajoute le jeton et décode la réponse', () async {
      final api = client(MockClient((req) async {
        expect(req.headers['authorization'], 'Bearer old');
        expect(req.url.toString(), 'http://api.test/v1/me?limit=5');
        return json(200, {'id': 'u1'});
      }));
      expect(await api.get('/me', query: {'limit': 5, 'cursor': null}), {'id': 'u1'});
    });

    test('renouvelle le jeton une seule fois pour plusieurs appels simultanés', () async {
      var refreshes = 0;
      final api = client(MockClient((req) async {
        if (req.url.path.endsWith('/auth/refresh')) {
          refreshes++;
          return json(200, {'accessToken': 'new', 'refreshToken': 'refresh2'});
        }
        return req.headers['authorization'] == 'Bearer new' ? json(200, {'ok': true}) : json(401, {'code': 'TOKEN_INVALID'});
      }));
      final results = await Future.wait([api.get('/a'), api.get('/b'), api.get('/c')]);
      expect(results, everyElement({'ok': true}));
      expect(refreshes, 1);
      expect(api.accessToken, 'new');
    });

    test('refus du renouvellement : session terminée et jetons effacés', () async {
      SessionEnd? ended;
      final api = client(
        MockClient((req) async => json(401, {'code': req.url.path.endsWith('/refresh') ? 'REFRESH_INVALID' : 'TOKEN_INVALID'})),
        onEnd: (r) => ended = r,
      );
      await expectLater(api.get('/me'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'TOKEN_INVALID')));
      expect(ended, SessionEnd.expired);
      expect(api.accessToken, isNull);
    });

    test('panne du serveur pendant le renouvellement : la session est conservée', () async {
      SessionEnd? ended;
      final api = client(
        MockClient((req) async => req.url.path.endsWith('/refresh') ? json(503, {}) : json(401, {'code': 'TOKEN_INVALID'})),
        onEnd: (r) => ended = r,
      );
      await expectLater(api.get('/me'), throwsA(isA<ApiException>()));
      expect(ended, isNull);
      expect(api.accessToken, 'old');
    });

    test('compte suspendu : session terminée avec la bonne raison', () async {
      SessionEnd? ended;
      final api = client(MockClient((req) async => json(403, {'code': 'ACCOUNT_SUSPENDED', 'message': 'x'})), onEnd: (r) => ended = r);
      await expectLater(api.get('/me'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'ACCOUNT_SUSPENDED')));
      expect(ended, SessionEnd.suspended);
    });

    test('erreur sans corps JSON : code HTTP_<statut>', () async {
      final api = client(MockClient((req) async => http.Response('<html>', 502)));
      await expectLater(api.get('/me'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'HTTP_502')));
    });

    test('serveur injoignable : erreur réseau', () async {
      final api = client(MockClient((req) async => throw http.ClientException('refused')));
      await expectLater(api.get('/me'), throwsA(isA<ApiException>().having((e) => e.isNetwork, 'isNetwork', true)));
    });

    test('sans jeton : refus immédiat sans appel réseau', () async {
      var calls = 0;
      final api = ApiClient(
        config: const ApiConfig(baseUrl: 'http://api.test/v1'),
        store: MemoryTokenStore(),
        client: MockClient((req) async {
          calls++;
          return json(200, {});
        }),
      );
      await expectLater(api.get('/me'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)));
      expect(calls, 0);
    });
  });

  group('ApiConfig', () {
    test('le temps réel vise le namespace /rt du même hôte', () {
      expect(const ApiConfig(baseUrl: 'http://localhost:3000/v1').realtimeUrl, 'http://localhost:3000/rt');
    });
  });

  group('format', () {
    test('montants en dinars à trois décimales', () {
      expect(formatDinars(12500), '12,500 DT');
      expect(formatDinars(0), '0,000 DT');
      expect(formatDinars(1234567), '1 234,567 DT');
      expect(formatDinars(-3000), '-3,000 DT');
    });

    test('distances et durées', () {
      expect(formatDistance(850), '850 m');
      expect(formatDistance(3400), '3,4 km');
      expect(formatMinutes(30), '1 min');
      expect(formatMinutes(601), '11 min');
    });

    test('numéros tunisiens', () {
      expect(normalizeTunisianPhone('22 123 456'), '+21622123456');
      expect(normalizeTunisianPhone('+216 22 123 456'), '+21622123456');
      expect(normalizeTunisianPhone('0021622123456'), '+21622123456');
      expect(normalizeTunisianPhone('12345678'), isNull);
      expect(normalizeTunisianPhone('2212345'), isNull);
    });
  });

  group('textes', () {
    test('le français et l\'arabe ont exactement les mêmes clés', () {
      final fr = stringTables['fr']!.keys.toSet();
      final ar = stringTables['ar']!.keys.toSet();
      expect(fr.difference(ar), isEmpty, reason: 'clés absentes en arabe');
      expect(ar.difference(fr), isEmpty, reason: 'clés absentes en français');
    });

    test('les paramètres {nom} sont identiques dans les deux langues', () {
      final placeholder = RegExp(r'\{(\w+)\}');
      for (final key in stringTables['fr']!.keys) {
        Set<String> names(String lang) => placeholder.allMatches(stringTables[lang]![key]!).map((m) => m.group(1)!).toSet();
        expect(names('ar'), names('fr'), reason: key);
      }
    });

    test('chaque statut de course et chaque code d\'erreur courant est traduit', () {
      for (final status in TripStatus.values) {
        expect(stringTables['fr']!.containsKey('tripStatus.${status.key}'), isTrue, reason: status.key);
      }
      for (final status in DriverStatus.values) {
        expect(stringTables['fr']!.containsKey('d.status.${status.key}'), isTrue, reason: status.key);
      }
    });

    test('substitution et repli', () {
      const s = Strings('fr');
      expect(s.t('login.codeHelp', {'phone': '+21622123456'}), 'Code envoyé au +21622123456');
      expect(s.error('CODE_INCONNU'), '${s.t('err.UNKNOWN')} (CODE_INCONNU)');
    });
  });

  group('modèles', () {
    test('Trip complet avec chauffeur, ETA et paiement', () {
      final trip = Trip.fromJson({
        'id': 't1',
        'status': 'driver_assigned',
        'category': 'standard',
        'pickup': {'lat': 36.8, 'lng': 10.18},
        'dropoff': {'lat': 36.85, 'lng': 10.2},
        'pickupAddress': 'A',
        'dropoffAddress': 'B',
        'estimatedDistanceM': 5000,
        'estimatedDurationS': 600,
        'quotedPrice': 4500,
        'finalPrice': null,
        'requestedAt': '2026-10-02T10:00:00.000Z',
        'driver': {
          'id': 'd1',
          'fullName': 'Sami',
          'rating': '4.80',
          'vehicle': {'make': 'Kia', 'model': 'Picanto', 'color': 'Blanc', 'plate': '123 TUN 4567'},
        },
        'driverEta': {'distanceM': 900, 'durationS': 120},
        'payment': null,
      });
      expect(trip.status, TripStatus.driverAssigned);
      expect(trip.status.isActive, isTrue);
      expect(trip.price, 4500);
      expect(trip.driver!.rating, 4.8);
      expect(trip.driver!.vehicle!.label, 'Kia Picanto · Blanc');
      expect(trip.driverEta!.durationS, 120);
    });

    test('Offer depuis l\'événement temps réel', () {
      final offer = Offer.fromJson({
        'offerId': 'o1',
        'expiresAt': '2026-10-02T10:00:15.000Z',
        'distanceToPickupM': 640.4,
        'trip': {
          'id': 't1',
          'pickup': {'lat': 36.8, 'lng': 10.18},
          'dropoff': {'lat': 36.85, 'lng': 10.2},
          'pickupAddress': 'A',
          'dropoffAddress': 'B',
          'estimatedDistanceM': 5000,
          'estimatedDurationS': 600,
          'price': 4500,
          'passenger': {'firstName': 'Leila', 'rating': null},
        },
      });
      expect(offer.distanceToPickupM, 640);
      expect(offer.price, 4500);
      expect(offer.passengerFirstName, 'Leila');
      expect(offer.passengerRating, isNull);
    });

    test('un événement temps réel aux sous-objets non typés se lit correctement', () {
      // Socket.IO livre des Map<dynamic, dynamic> imbriquées
      final raw = <dynamic, dynamic>{
        'offerId': 'o1',
        'expiresAt': '2026-10-02T10:00:15.000Z',
        'distanceToPickupM': 0,
        'trip': <dynamic, dynamic>{
          'id': 't1',
          'pickup': <dynamic, dynamic>{'lat': 36.8, 'lng': 10.18},
          'dropoff': <dynamic, dynamic>{'lat': 36.85, 'lng': 10.2},
          'estimatedDistanceM': 5000,
          'estimatedDurationS': 600,
          'price': 4500,
          'passenger': <dynamic, dynamic>{'firstName': 'Leila', 'rating': null},
        },
      };
      expect(() => Offer.fromJson(raw as Map<String, dynamic>), throwsA(isA<TypeError>()));
      final offer = Offer.fromJson(asJson(raw));
      expect(offer.tripId, 't1');
      expect(offer.passengerFirstName, 'Leila');
    });

    test('statut inconnu : repli sans planter', () {
      expect(TripStatus.parse('nouveau_statut'), TripStatus.requested);
    });
  });
}
