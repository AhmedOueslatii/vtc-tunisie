import 'package:flutter/material.dart';
import 'package:vtc_core/vtc_core.dart';

import 'passenger_controller.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key, required this.controller});

  final PassengerController controller;

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  @override
  void initState() {
    super.initState();
    widget.controller.loadHistory();
  }

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(s.t('p.history'))),
      body: ListenableBuilder(
        listenable: widget.controller,
        builder: (context, _) {
          final c = widget.controller;
          if (c.busy && c.history.isEmpty) return const Center(child: CircularProgressIndicator());
          if (c.error != null && c.history.isEmpty) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [Text(s.error(c.error!.code)), TextButton(onPressed: c.loadHistory, child: Text(s.t('common.retry')))],
              ),
            );
          }
          if (c.history.isEmpty) return Center(child: Text(s.t('p.noHistory')));
          return ListView.separated(
            itemCount: c.history.length,
            separatorBuilder: (_, _) => const Divider(height: 1),
            itemBuilder: (context, i) {
              final trip = c.history[i];
              return ListTile(
                title: Text(trip.dropoffAddress ?? '—', maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text('${s.t('tripStatus.${trip.status.key}')}${trip.requestedAt == null ? '' : ' · ${_date(trip.requestedAt!)}'}'),
                trailing: Text(trip.status == TripStatus.completed ? formatDinars(trip.price) : ''),
              );
            },
          );
        },
      ),
    );
  }

  String _date(DateTime d) => '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}
