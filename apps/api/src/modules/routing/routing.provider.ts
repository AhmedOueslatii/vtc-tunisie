import { Injectable } from '@nestjs/common';
import { haversineMeters, type LatLng } from '../../common/geo.js';

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');

export interface RouteEstimate {
  distanceM: number;
  durationS: number;
}

export interface RoutingProvider {
  route(from: LatLng, to: LatLng): Promise<RouteEstimate>;
}

/**
 * Approximation MVP sans service externe : distance à vol d'oiseau × facteur de détour,
 * vitesse moyenne urbaine. À remplacer par OSRM (extrait OSM Tunisie) — même interface.
 */
@Injectable()
export class StraightLineRoutingProvider implements RoutingProvider {
  static readonly DETOUR_FACTOR = 1.35;
  static readonly AVG_SPEED_KMH = 24;

  async route(from: LatLng, to: LatLng): Promise<RouteEstimate> {
    const distanceM = Math.round(haversineMeters(from, to) * StraightLineRoutingProvider.DETOUR_FACTOR);
    const durationS = Math.round((distanceM / 1000 / StraightLineRoutingProvider.AVG_SPEED_KMH) * 3600);
    return { distanceM, durationS };
  }
}
