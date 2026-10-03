import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

/// Tunis centre : position par défaut tant qu'il n'y a pas de géolocalisation (branchée plus tard, côté natif).
const tunisCenter = LatLng(36.8065, 10.1815);

class MapPin {
  const MapPin({required this.point, required this.icon, required this.color, this.label});

  final LatLng point;
  final IconData icon;
  final Color color;

  /// Texte lu par les lecteurs d'écran (et par les tests).
  final String? label;
}

/// La carte, isolée dans un seul widget : le jour où l'on passe au natif (Google Maps / Mapbox), seul ce fichier change.
/// Fond OpenStreetMap : usage de démonstration uniquement, un serveur de tuiles dédié est requis en production.
class VtcMap extends StatefulWidget {
  const VtcMap({super.key, this.center = tunisCenter, this.zoom = 13, this.pins = const [], this.route, this.onTap, this.fitToPins = false});

  final LatLng center;
  final double zoom;
  final List<MapPin> pins;
  final List<LatLng>? route;
  final void Function(LatLng point)? onTap;

  /// Recadre la carte pour montrer tous les repères (course en cours).
  final bool fitToPins;

  @override
  State<VtcMap> createState() => _VtcMapState();
}

class _VtcMapState extends State<VtcMap> {
  final _controller = MapController();

  @override
  void didUpdateWidget(VtcMap old) {
    super.didUpdateWidget(old);
    if (widget.fitToPins && widget.pins.length >= 2 && _changed(old.pins, widget.pins)) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        try {
          _controller.fitCamera(
            CameraFit.coordinates(coordinates: [for (final p in widget.pins) p.point], padding: const EdgeInsets.all(48), maxZoom: 16),
          );
        } catch (_) {
          // Carte pas encore prête : le recadrage se fera à la mise à jour suivante
        }
      });
    } else if (!widget.fitToPins && old.center != widget.center) {
      try {
        _controller.move(widget.center, widget.zoom);
      } catch (_) {}
    }
  }

  bool _changed(List<MapPin> a, List<MapPin> b) {
    if (a.length != b.length) return true;
    for (var i = 0; i < a.length; i++) {
      if (a[i].point != b[i].point) return true;
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    return FlutterMap(
      mapController: _controller,
      options: MapOptions(
        initialCenter: widget.center,
        initialZoom: widget.zoom,
        interactionOptions: const InteractionOptions(flags: InteractiveFlag.drag | InteractiveFlag.pinchZoom | InteractiveFlag.scrollWheelZoom),
        onTap: widget.onTap == null ? null : (_, point) => widget.onTap!(point),
      ),
      children: [
        TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'tn.vtc.poc'),
        if (widget.route != null && widget.route!.length >= 2)
          PolylineLayer(polylines: [Polyline(points: widget.route!, strokeWidth: 4, color: Theme.of(context).colorScheme.primary)]),
        MarkerLayer(
          markers: [
            for (final pin in widget.pins)
              Marker(
                point: pin.point,
                width: 40,
                height: 40,
                alignment: Alignment.topCenter,
                child: Semantics(label: pin.label, child: Icon(pin.icon, color: pin.color, size: 36)),
              ),
          ],
        ),
        const SimpleAttributionWidget(source: Text('© OpenStreetMap')),
      ],
    );
  }
}
