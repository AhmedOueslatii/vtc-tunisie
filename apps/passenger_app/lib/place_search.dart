import 'dart:async';

import 'package:flutter/material.dart';
import 'package:vtc_core/vtc_core.dart';

/// Recherche d'adresse en plein écran. Renvoie le lieu choisi.
class PlaceSearchScreen extends StatefulWidget {
  const PlaceSearchScreen({super.key, required this.title, required this.search, this.suggestion});

  final String title;
  final Future<List<Place>> Function(String query) search;

  /// Lieu proposé d'emblée (ex. la position par défaut).
  final Place? suggestion;

  @override
  State<PlaceSearchScreen> createState() => _PlaceSearchScreenState();
}

class _PlaceSearchScreenState extends State<PlaceSearchScreen> {
  final _text = TextEditingController();
  Timer? _debounce;
  List<Place> _results = const [];
  bool _loading = false;
  bool _searched = false;
  String? _error;
  int _seq = 0;

  @override
  void dispose() {
    _debounce?.cancel();
    _text.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    if (value.trim().length < 2) {
      setState(() {
        _results = const [];
        _searched = false;
      });
      return;
    }
    // Pause de frappe avant d'interroger l'API : la recherche est limitée à quelques requêtes par minute
    _debounce = Timer(const Duration(milliseconds: 450), () => _run(value.trim()));
  }

  Future<void> _run(String query) async {
    final seq = ++_seq;
    final s = Strings.of(context);
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await widget.search(query);
      if (!mounted || seq != _seq) return; // une recherche plus récente a pris le relais
      setState(() {
        _results = results;
        _searched = true;
      });
    } catch (e) {
      if (mounted && seq == _seq) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted && seq == _seq) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              key: const ValueKey('place-query'),
              controller: _text,
              autofocus: true,
              onChanged: _onChanged,
              decoration: InputDecoration(labelText: s.t('p.searchPlace'), prefixIcon: const Icon(Icons.search)),
            ),
          ),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null) Padding(padding: const EdgeInsets.all(16), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
          Expanded(
            child: ListView(
              children: [
                if (widget.suggestion != null && _text.text.isEmpty)
                  ListTile(
                    leading: const Icon(Icons.my_location),
                    title: Text(s.t('p.pickupHere')),
                    onTap: () => Navigator.pop(context, widget.suggestion),
                  ),
                for (final place in _results)
                  ListTile(
                    leading: const Icon(Icons.place_outlined),
                    title: Text(place.name),
                    subtitle: place.address.isEmpty ? null : Text(place.address),
                    onTap: () => Navigator.pop(context, place),
                  ),
                if (_searched && _results.isEmpty && !_loading) Padding(padding: const EdgeInsets.all(24), child: Text(s.t('p.noResults'))),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
