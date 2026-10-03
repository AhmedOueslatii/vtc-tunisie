import 'package:latlong2/latlong.dart';

/// Modèles des réponses de l'API. Montants en millimes (1 DT = 1000 millimes), jamais de flottants.

LatLng _point(dynamic json) {
  final map = json as Map<String, dynamic>;
  return LatLng((map['lat'] as num).toDouble(), (map['lng'] as num).toDouble());
}

DateTime? _date(dynamic value) => value is String ? DateTime.tryParse(value)?.toLocal() : null;

// ─── Lieux et devis ──────────────────────────────────────────────────────────

class Place {
  const Place({required this.id, required this.name, required this.address, required this.point});

  factory Place.fromJson(Map<String, dynamic> json) => Place(
        id: json['id'] as String,
        name: json['name'] as String,
        address: (json['address'] as String?) ?? '',
        point: LatLng((json['lat'] as num).toDouble(), (json['lng'] as num).toDouble()),
      );

  final String id;
  final String name;
  final String address;
  final LatLng point;

  /// Libellé complet envoyé à l'API comme adresse de la course.
  String get label => address.isEmpty ? name : '$name, $address';
}

class Estimate {
  const Estimate({
    required this.quoteId,
    required this.price,
    required this.distanceM,
    required this.durationS,
    required this.expiresAt,
  });

  factory Estimate.fromJson(Map<String, dynamic> json) => Estimate(
        quoteId: json['quoteId'] as String,
        price: json['price'] as int,
        distanceM: json['distanceM'] as int,
        durationS: json['durationS'] as int,
        expiresAt: _date(json['expiresAt']) ?? DateTime.now().add(const Duration(minutes: 5)),
      );

  final String quoteId;
  final int price;
  final int distanceM;
  final int durationS;

  /// Le prix est garanti jusqu'à cette échéance.
  final DateTime expiresAt;
}

// ─── Courses ─────────────────────────────────────────────────────────────────

enum TripStatus {
  requested,
  driverAssigned,
  driverArrived,
  inProgress,
  completed,
  cancelledByPassenger,
  cancelledByDriver,
  noDriverFound;

  static TripStatus parse(String value) => switch (value) {
        'requested' => requested,
        'driver_assigned' => driverAssigned,
        'driver_arrived' => driverArrived,
        'in_progress' => inProgress,
        'completed' => completed,
        'cancelled_by_passenger' => cancelledByPassenger,
        'cancelled_by_driver' => cancelledByDriver,
        'no_driver_found' => noDriverFound,
        _ => requested,
      };

  /// Clé de traduction (`tripStatus.driver_assigned`…).
  String get key => switch (this) {
        requested => 'requested',
        driverAssigned => 'driver_assigned',
        driverArrived => 'driver_arrived',
        inProgress => 'in_progress',
        completed => 'completed',
        cancelledByPassenger => 'cancelled_by_passenger',
        cancelledByDriver => 'cancelled_by_driver',
        noDriverFound => 'no_driver_found',
      };

  /// Course en cours : elle bloque une nouvelle commande et se suit en direct.
  bool get isActive => this == requested || this == driverAssigned || this == driverArrived || this == inProgress;
}

class Vehicle {
  const Vehicle({required this.make, required this.model, required this.color, required this.plate});

  factory Vehicle.fromJson(Map<String, dynamic> json) => Vehicle(
        make: json['make'] as String,
        model: json['model'] as String,
        color: json['color'] as String,
        plate: json['plate'] as String,
      );

  final String make;
  final String model;
  final String color;
  final String plate;

  String get label => '$make $model · $color';
}

class DriverCard {
  const DriverCard({required this.id, required this.fullName, required this.rating, required this.vehicle});

  factory DriverCard.fromJson(Map<String, dynamic> json) => DriverCard(
        id: json['id'] as String,
        fullName: json['fullName'] as String?,
        rating: double.tryParse('${json['rating']}'),
        vehicle: json['vehicle'] is Map<String, dynamic> ? Vehicle.fromJson(json['vehicle'] as Map<String, dynamic>) : null,
      );

  final String id;
  final String? fullName;
  final double? rating;
  final Vehicle? vehicle;
}

class DriverEta {
  const DriverEta({required this.distanceM, required this.durationS});

  factory DriverEta.fromJson(Map<String, dynamic> json) =>
      DriverEta(distanceM: json['distanceM'] as int, durationS: json['durationS'] as int);

  final int distanceM;
  final int durationS;
}

class Payment {
  const Payment({required this.method, required this.amount, required this.status});

  factory Payment.fromJson(Map<String, dynamic> json) =>
      Payment(method: json['method'] as String, amount: json['amount'] as int, status: json['status'] as String);

  final String method;
  final int amount;

  /// `pending` tant que le chauffeur n'a pas confirmé l'encaissement, puis `succeeded`.
  final String status;
}

class Trip {
  const Trip({
    required this.id,
    required this.status,
    required this.category,
    required this.pickup,
    required this.dropoff,
    required this.pickupAddress,
    required this.dropoffAddress,
    required this.estimatedDistanceM,
    required this.estimatedDurationS,
    required this.quotedPrice,
    required this.finalPrice,
    required this.cancellationFee,
    required this.requestedAt,
    required this.driver,
    required this.driverEta,
    required this.payment,
  });

  factory Trip.fromJson(Map<String, dynamic> json) => Trip(
        id: json['id'] as String,
        status: TripStatus.parse(json['status'] as String),
        category: (json['category'] as String?) ?? 'standard',
        pickup: _point(json['pickup']),
        dropoff: _point(json['dropoff']),
        pickupAddress: json['pickupAddress'] as String?,
        dropoffAddress: json['dropoffAddress'] as String?,
        estimatedDistanceM: (json['estimatedDistanceM'] as int?) ?? 0,
        estimatedDurationS: (json['estimatedDurationS'] as int?) ?? 0,
        quotedPrice: json['quotedPrice'] as int,
        finalPrice: json['finalPrice'] as int?,
        cancellationFee: json['cancellationFee'] as int?,
        requestedAt: _date(json['requestedAt']),
        driver: json['driver'] is Map<String, dynamic> ? DriverCard.fromJson(json['driver'] as Map<String, dynamic>) : null,
        driverEta: json['driverEta'] is Map<String, dynamic> ? DriverEta.fromJson(json['driverEta'] as Map<String, dynamic>) : null,
        payment: json['payment'] is Map<String, dynamic> ? Payment.fromJson(json['payment'] as Map<String, dynamic>) : null,
      );

  final String id;
  final TripStatus status;
  final String category;
  final LatLng pickup;
  final LatLng dropoff;
  final String? pickupAddress;
  final String? dropoffAddress;
  final int estimatedDistanceM;
  final int estimatedDurationS;
  final int quotedPrice;
  final int? finalPrice;
  final int? cancellationFee;
  final DateTime? requestedAt;
  final DriverCard? driver;
  final DriverEta? driverEta;
  final Payment? payment;

  /// Prix à régler : le prix final une fois la course terminée, sinon le prix annoncé (garanti).
  int get price => finalPrice ?? quotedPrice;
}

/// Proposition de course reçue par le chauffeur (événement temps réel `trip:offer`).
class Offer {
  const Offer({
    required this.offerId,
    required this.tripId,
    required this.expiresAt,
    required this.distanceToPickupM,
    required this.pickup,
    required this.dropoff,
    required this.pickupAddress,
    required this.dropoffAddress,
    required this.distanceM,
    required this.durationS,
    required this.price,
    required this.passengerFirstName,
    required this.passengerRating,
  });

  factory Offer.fromJson(Map<String, dynamic> json) {
    final trip = json['trip'] as Map<String, dynamic>;
    final passenger = (trip['passenger'] as Map<String, dynamic>?) ?? const {};
    return Offer(
      offerId: json['offerId'] as String,
      tripId: trip['id'] as String,
      expiresAt: _date(json['expiresAt']) ?? DateTime.now().add(const Duration(seconds: 15)),
      distanceToPickupM: (json['distanceToPickupM'] as num?)?.round() ?? 0,
      pickup: _point(trip['pickup']),
      dropoff: _point(trip['dropoff']),
      pickupAddress: trip['pickupAddress'] as String?,
      dropoffAddress: trip['dropoffAddress'] as String?,
      distanceM: (trip['estimatedDistanceM'] as num?)?.round() ?? 0,
      durationS: (trip['estimatedDurationS'] as num?)?.round() ?? 0,
      price: trip['price'] as int,
      passengerFirstName: passenger['firstName'] as String?,
      passengerRating: double.tryParse('${passenger['rating']}'),
    );
  }

  final String offerId;
  final String tripId;
  final DateTime expiresAt;
  final int distanceToPickupM;
  final LatLng pickup;
  final LatLng dropoff;
  final String? pickupAddress;
  final String? dropoffAddress;
  final int distanceM;
  final int durationS;
  final int price;
  final String? passengerFirstName;
  final double? passengerRating;
}

/// Ligne de l'historique des courses (`GET /trips`), vue du participant connecté.
class TripSummary {
  const TripSummary({
    required this.id,
    required this.status,
    required this.pickupAddress,
    required this.dropoffAddress,
    required this.price,
    required this.requestedAt,
    required this.counterpartName,
    required this.myRating,
  });

  factory TripSummary.fromJson(Map<String, dynamic> json) {
    final counterpart = json['counterpart'] as Map<String, dynamic>?;
    return TripSummary(
      id: json['id'] as String,
      status: TripStatus.parse(json['status'] as String),
      pickupAddress: json['pickupAddress'] as String?,
      dropoffAddress: json['dropoffAddress'] as String?,
      price: (json['finalPrice'] as int?) ?? json['quotedPrice'] as int,
      requestedAt: _date(json['requestedAt']),
      counterpartName: counterpart?['fullName'] as String?,
      myRating: json['myRating'] as int?,
    );
  }

  final String id;
  final TripStatus status;
  final String? pickupAddress;
  final String? dropoffAddress;
  final int price;
  final DateTime? requestedAt;
  final String? counterpartName;
  final int? myRating;
}

// ─── Chauffeur ───────────────────────────────────────────────────────────────

enum DriverStatus {
  pendingDocuments,
  underReview,
  approved,
  rejected,
  suspended;

  static DriverStatus parse(String value) => switch (value) {
        'pending_documents' => pendingDocuments,
        'under_review' => underReview,
        'approved' => approved,
        'rejected' => rejected,
        'suspended' => suspended,
        _ => pendingDocuments,
      };

  String get key => switch (this) {
        pendingDocuments => 'pending_documents',
        underReview => 'under_review',
        approved => 'approved',
        rejected => 'rejected',
        suspended => 'suspended',
      };
}

class DriverProfile {
  const DriverProfile({required this.status, required this.rejectionReason, required this.vehicle, required this.online});

  factory DriverProfile.fromJson(Map<String, dynamic> json) {
    final presence = json['presence'] as Map<String, dynamic>?;
    return DriverProfile(
      status: DriverStatus.parse(json['status'] as String),
      rejectionReason: json['rejectionReason'] as String?,
      vehicle: json['vehicle'] is Map<String, dynamic> ? Vehicle.fromJson(json['vehicle'] as Map<String, dynamic>) : null,
      online: presence != null && presence['status'] != null,
    );
  }

  final DriverStatus status;
  final String? rejectionReason;
  final Vehicle? vehicle;

  /// Présent dans l'index de disponibilité (en ligne ou en course).
  final bool online;
}

class WalletTransaction {
  const WalletTransaction({required this.id, required this.type, required this.amount, required this.createdAt, required this.note});

  factory WalletTransaction.fromJson(Map<String, dynamic> json) => WalletTransaction(
        id: json['id'] as String,
        type: json['type'] as String,
        amount: json['amount'] as int,
        createdAt: _date(json['createdAt']),
        note: json['note'] as String?,
      );

  final String id;
  final String type;

  /// Signé : négatif = le chauffeur doit davantage (commission), positif = il doit moins (règlement).
  final int amount;
  final DateTime? createdAt;
  final String? note;
}

enum DebtState {
  ok,
  warning,
  blocked;

  static DebtState parse(String value) => switch (value) {
        'warning' => warning,
        'blocked' => blocked,
        _ => ok,
      };
}

class Earnings {
  const Earnings({required this.days, required this.trips, required this.gross, required this.commission, required this.net});

  factory Earnings.fromJson(Map<String, dynamic> json) => Earnings(
        days: json['days'] as int,
        trips: json['trips'] as int,
        gross: json['gross'] as int,
        commission: json['commission'] as int,
        net: json['net'] as int,
      );

  final int days;
  final int trips;
  final int gross;
  final int commission;
  final int net;
}

class Wallet {
  const Wallet({
    required this.balance,
    required this.debt,
    required this.ceiling,
    required this.state,
    required this.earnings,
    required this.transactions,
  });

  factory Wallet.fromJson(Map<String, dynamic> json) => Wallet(
        balance: json['balance'] as int,
        debt: json['debt'] as int,
        ceiling: json['ceiling'] as int,
        state: DebtState.parse(json['state'] as String),
        earnings: Earnings.fromJson(json['earnings'] as Map<String, dynamic>),
        transactions: ((json['transactions'] as Map<String, dynamic>)['items'] as List)
            .map((e) => WalletTransaction.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  final int balance;
  final int debt;
  final int ceiling;
  final DebtState state;
  final Earnings earnings;
  final List<WalletTransaction> transactions;
}

// ─── Utilisateur ─────────────────────────────────────────────────────────────

class UserProfile {
  const UserProfile({required this.id, required this.phone, required this.fullName, required this.locale});

  factory UserProfile.fromJson(Map<String, dynamic> json) => UserProfile(
        id: json['id'] as String,
        phone: json['phone'] as String,
        fullName: json['fullName'] as String?,
        locale: (json['locale'] as String?) ?? 'fr',
      );

  final String id;
  final String phone;
  final String? fullName;
  final String locale;

  String get firstName => (fullName ?? '').trim().split(' ').first;
}

/// Notification reçue en temps réel (`notification:new`).
class AppNotification {
  const AppNotification({required this.type, required this.title, required this.body});

  factory AppNotification.fromJson(Map<String, dynamic> json) {
    final payload = (json['payload'] as Map<String, dynamic>?) ?? const {};
    return AppNotification(
      type: json['type'] as String,
      title: (payload['title'] as String?) ?? '',
      body: (payload['body'] as String?) ?? '',
    );
  }

  final String type;
  final String title;
  final String body;
}
