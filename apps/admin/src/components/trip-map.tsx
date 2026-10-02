'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { LatLng } from '@/lib/types';

interface Props {
  pickup: LatLng;
  dropoff: LatLng;
  /** Positions enregistrées du chauffeur, dans l'ordre. */
  track: LatLng[];
  labels: { pickup: string; dropoff: string; aria: string };
}

const COLOR = '#2a78d6'; // emplacement 1 de la palette des graphiques

/**
 * Carte OpenStreetMap : départ, arrivée et trace GPS du chauffeur. Leaflet touche à `window` : il n'est chargé
 * qu'après le montage. Les fonds de carte viennent du serveur public d'OSM — acceptable pour un back-office à faible
 * trafic ; prévoir un fournisseur de tuiles dédié en production.
 */
export function TripMap({ pickup, dropoff, track, labels }: Props) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import('leaflet').Map | undefined;
    let cancelled = false;

    void import('leaflet').then((module) => {
      const L = module.default;
      if (cancelled || !container.current) return;

      map = L.map(container.current, { scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      const from = L.latLng(pickup.lat, pickup.lng);
      const to = L.latLng(dropoff.lat, dropoff.lng);
      const path = track.map((p) => L.latLng(p.lat, p.lng));

      // Sans trace, un trait pointillé relie le départ à l'arrivée pour situer la course
      L.polyline(path.length > 1 ? path : [from, to], {
        color: COLOR,
        weight: 3,
        opacity: 0.9,
        dashArray: path.length > 1 ? undefined : '6 8',
      }).addTo(map);
      // Départ creux, arrivée pleine ; anneau blanc pour rester lisible sur le fond de carte
      L.circleMarker(from, { radius: 8, color: COLOR, weight: 3, fillColor: '#ffffff', fillOpacity: 1 })
        .bindTooltip(labels.pickup)
        .addTo(map);
      L.circleMarker(to, { radius: 8, color: '#ffffff', weight: 2, fillColor: COLOR, fillOpacity: 1 })
        .bindTooltip(labels.dropoff)
        .addTo(map);

      map.fitBounds(L.latLngBounds([from, to, ...path]), { padding: [32, 32], maxZoom: 16 });
    });

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [pickup, dropoff, track, labels]);

  return <div ref={container} role="img" aria-label={labels.aria} className="h-80 w-full rounded-md border border-line" />;
}
