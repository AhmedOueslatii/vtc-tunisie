import 'package:flutter/material.dart';

/// Sur un grand écran (navigateur), on simule la largeur d'un téléphone au centre ; sur un vrai téléphone, plein écran.
class MobileFrame extends StatelessWidget {
  const MobileFrame({super.key, required this.child});

  final Widget child;

  static const width = 420.0;

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    if (size.width <= width + 40) return child;
    final scheme = Theme.of(context).colorScheme;
    return ColoredBox(
      color: scheme.surfaceContainerHighest,
      child: Center(
        child: Container(
          width: width,
          height: size.height > 900 ? 860 : size.height - 32,
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: scheme.outlineVariant),
            boxShadow: const [BoxShadow(blurRadius: 24, color: Color(0x22000000))],
          ),
          // MediaQuery réduit à la taille du cadre : le contenu se met en page comme sur un téléphone
          child: MediaQuery(
            data: MediaQuery.of(context).copyWith(size: Size(width, size.height > 900 ? 860 : size.height - 32)),
            child: child,
          ),
        ),
      ),
    );
  }
}
