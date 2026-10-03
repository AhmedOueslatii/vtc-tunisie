import 'package:flutter/material.dart';

/// Couleurs propres à l'application, au-delà du thème Material : états de course et alertes de dette.
class VtcColors {
  static const brand = Color(0xFF0B6E4F);
  static const warning = Color(0xFFB45309);
  static const danger = Color(0xFFB42318);
}

ThemeData vtcTheme({required String lang}) {
  final scheme = ColorScheme.fromSeed(seedColor: VtcColors.brand);
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    // Pas de police réseau : le POC doit fonctionner hors ligne. L'arabe retombe sur la police système.
    fontFamilyFallback: const ['Noto Sans Arabic', 'Segoe UI', 'Arial'],
    inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder()),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52), textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48))),
  );
}
