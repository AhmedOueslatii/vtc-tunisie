import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { haversineMeters, type LatLng } from '../../common/geo.js';
import { env } from '../../config/env.js';

export const GEOCODING_PROVIDER = Symbol('GEOCODING_PROVIDER');

export interface Place {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export interface GeocodingProvider {
  /** Recherche d'adresses ou de lieux en Tunisie ; `near` privilégie les résultats proches sans les restreindre. */
  search(query: string, near: LatLng | undefined, limit: number): Promise<Place[]>;
  reverse(point: LatLng): Promise<Place | null>;
}

const unavailable = (cause: unknown) =>
  new AppError('GEOCODING_UNAVAILABLE', `Service d'adresses indisponible : ${String(cause)}`, HttpStatus.SERVICE_UNAVAILABLE);

/** Minuscules, sans accents ni voyelles arabes : « Aéroport » et « aeroport », « المَرسى » et « المرسى » se valent. */
export const normalizeText = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ًͯ-ٟ]/g, '')
    .toLowerCase()
    .trim();

// ─── Jeu de lieux intégré (dev, tests, démo hors-ligne) ──────────────────────

interface StaticPlace extends Place {
  aliases: string[];
}

const p = (name: string, address: string, lat: number, lng: number, ...aliases: string[]): StaticPlace => ({
  id: `static:${normalizeText(name).replace(/[^a-z0-9]+/g, '-')}`,
  name,
  address,
  lat,
  lng,
  aliases,
});

export const STATIC_PLACES: StaticPlace[] = [
  p('Avenue Habib Bourguiba', 'Centre-ville, Tunis', 36.8008, 10.18, 'tunis centre', 'تونس', 'شارع الحبيب بورقيبة'),
  p('Gare de Tunis', 'Place de Barcelone, Tunis', 36.7947, 10.1786, 'gare', 'محطة تونس'),
  p('Aéroport Tunis-Carthage', 'Tunis-Carthage (TUN)', 36.851, 10.2272, 'aeroport', 'airport', 'مطار تونس قرطاج'),
  p('La Marsa', 'La Marsa, Tunis', 36.8782, 10.3247, 'المرسى'),
  p('Carthage', 'Carthage, Tunis', 36.8529, 10.3231, 'قرطاج'),
  p('Sidi Bou Saïd', 'Sidi Bou Saïd, Tunis', 36.87, 10.3416, 'سيدي بوسعيد'),
  p('La Goulette', 'La Goulette, Tunis', 36.8183, 10.3055, 'حلق الوادي'),
  p('Le Bardo', 'Le Bardo, Tunis', 36.8092, 10.1344, 'باردو', 'musee du bardo'),
  p('Ariana', 'Ariana', 36.8665, 10.1647, 'أريانة'),
  p('Ben Arous', 'Ben Arous', 36.7531, 10.2189, 'بن عروس'),
  p('Les Berges du Lac', 'Lac 1, Tunis', 36.8337, 10.2358, 'lac', 'lac 1', 'البحيرة'),
  p('El Menzah', 'El Menzah, Tunis', 36.8419, 10.1743, 'menzah', 'المنزه'),
  p('Sousse', 'Sousse', 35.8256, 10.6369, 'سوسة'),
  p('Monastir', 'Monastir', 35.7643, 10.8113, 'المنستير'),
  p('Hammamet', 'Hammamet', 36.4, 10.6167, 'الحمامات'),
  p('Nabeul', 'Nabeul', 36.4513, 10.7357, 'نابل'),
  p('Sfax', 'Sfax', 34.7406, 10.7603, 'صفاقس'),
  p('Bizerte', 'Bizerte', 37.2744, 9.8739, 'بنزرت'),
  p('Kairouan', 'Kairouan', 35.6781, 10.0963, 'القيروان'),
  p('Gabès', 'Gabès', 33.8815, 10.0982, 'gabes', 'قابس'),
  p('Houmt Souk (Djerba)', 'Djerba', 33.876, 10.8575, 'djerba', 'جربة'),
  p('Tozeur', 'Tozeur', 33.9197, 8.1335, 'توزر'),
  p('Aéroport Monastir Habib Bourguiba', 'Monastir (MIR)', 35.7581, 10.7547, 'aeroport monastir'),
  p('Aéroport Enfidha-Hammamet', 'Enfidha (NBE)', 36.0758, 10.4386, 'aeroport enfidha'),
  p('Aéroport Sfax-Thyna', 'Sfax (SFA)', 34.7179, 10.691, 'aeroport sfax'),
];

const toPlace = ({ aliases: _a, ...place }: StaticPlace): Place => place;
const STATIC_REVERSE_MAX_M = 3_000;

/** Fournisseur sans réseau : suffisant pour développer et tester, refusé en production (voir `env.ts`). */
@Injectable()
export class StaticGeocodingProvider implements GeocodingProvider {
  async search(query: string, near: LatLng | undefined, limit: number): Promise<Place[]> {
    const q = normalizeText(query);
    const scored = STATIC_PLACES.flatMap((place) => {
      const names = [place.name, place.address, ...place.aliases].map(normalizeText);
      if (!names.some((n) => n.includes(q))) return [];
      const rank = names.some((n) => n.startsWith(q)) ? 0 : 1;
      return [{ place, rank, distance: near ? haversineMeters(near, place) : 0 }];
    });
    return scored
      .sort((a, b) => a.rank - b.rank || a.distance - b.distance)
      .slice(0, limit)
      .map((s) => toPlace(s.place));
  }

  async reverse(point: LatLng): Promise<Place | null> {
    const nearest = STATIC_PLACES.map((place) => ({ place, distance: haversineMeters(point, place) })).sort(
      (a, b) => a.distance - b.distance,
    )[0];
    return nearest && nearest.distance <= STATIC_REVERSE_MAX_M ? toPlace(nearest.place) : null;
  }
}

// ─── OpenStreetMap / Nominatim ───────────────────────────────────────────────

interface NominatimItem {
  place_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
}

/**
 * Nominatim (OSM). L'instance publique est limitée à ~1 requête/s et interdit l'autocomplétion à la frappe :
 * en production, pointer `NOMINATIM_URL` vers une instance auto-hébergée (extrait OSM Tunisie) ou remplacer
 * ce fournisseur par Mapbox/Google — l'interface `GeocodingProvider` reste la même.
 */
@Injectable()
export class NominatimGeocodingProvider implements GeocodingProvider {
  async search(query: string, near: LatLng | undefined, limit: number): Promise<Place[]> {
    const params = new URLSearchParams({ q: query, format: 'jsonv2', countrycodes: 'tn', limit: String(limit) });
    if (near) {
      // Biais de proximité sans restriction (bounded=0 par défaut) : ±0,3° autour de l'utilisateur.
      params.set('viewbox', `${near.lng - 0.3},${near.lat + 0.3},${near.lng + 0.3},${near.lat - 0.3}`);
    }
    const items = await this.fetchJson<NominatimItem[]>(`/search?${params}`);
    return items.map((i) => this.toPlace(i));
  }

  async reverse(point: LatLng): Promise<Place | null> {
    const params = new URLSearchParams({ lat: String(point.lat), lon: String(point.lng), format: 'jsonv2' });
    const item = await this.fetchJson<NominatimItem & { error?: string }>(`/reverse?${params}`);
    return item.error ? null : this.toPlace(item);
  }

  private toPlace(i: NominatimItem): Place {
    const [first = '', ...rest] = i.display_name.split(', ');
    return {
      id: `osm:${i.place_id}`,
      name: i.name || first,
      address: rest.join(', ') || i.display_name,
      lat: Number(i.lat),
      lng: Number(i.lon),
    };
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const { NOMINATIM_URL, NOMINATIM_USER_AGENT } = env();
    try {
      const res = await fetch(new URL(path, NOMINATIM_URL), {
        headers: { 'user-agent': NOMINATIM_USER_AGENT, accept: 'application/json' },
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      throw unavailable(e);
    }
  }
}
