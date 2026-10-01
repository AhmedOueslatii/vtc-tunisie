import { Injectable, Logger } from '@nestjs/common';
import { haversineMeters, type LatLng } from '../../common/geo.js';
import { env } from '../../config/env.js';

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

/**
 * Distance et durée réelles par la route via un serveur OSRM (extrait OSM Tunisie, profil voiture).
 * Un devis ne doit jamais échouer parce que le serveur de routage est lent ou en panne : au-delà de
 * `TIMEOUT_MS` ou sur toute erreur, on se replie sur l'estimation à vol d'oiseau.
 */
@Injectable()
export class OsrmRoutingProvider implements RoutingProvider {
  static readonly TIMEOUT_MS = 2_000;
  private readonly logger = new Logger(OsrmRoutingProvider.name);
  private readonly fallback = new StraightLineRoutingProvider();

  async route(from: LatLng, to: LatLng): Promise<RouteEstimate> {
    try {
      const url = new URL(
        `/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`,
        env().OSRM_URL,
      );
      const res = await fetch(url, { signal: AbortSignal.timeout(OsrmRoutingProvider.TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { code?: string; routes?: { distance: number; duration: number }[] };
      const best = body.routes?.[0];
      if (body.code !== 'Ok' || !best) throw new Error(`réponse ${body.code ?? 'inattendue'}`);
      return { distanceM: Math.round(best.distance), durationS: Math.round(best.duration) };
    } catch (e) {
      this.logger.warn(`OSRM indisponible, estimation à vol d'oiseau : ${(e as Error).message}`);
      return this.fallback.route(from, to);
    }
  }
}

export const createRoutingProvider = (): RoutingProvider =>
  env().ROUTING_PROVIDER === 'osrm' ? new OsrmRoutingProvider() : new StraightLineRoutingProvider();
