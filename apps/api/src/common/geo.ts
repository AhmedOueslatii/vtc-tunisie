export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Emprise large de la Tunisie : on refuse les courses dont le départ est hors zone de service. */
export function isInTunisia({ lat, lng }: LatLng): boolean {
  return lat >= 30.2 && lat <= 37.6 && lng >= 7.5 && lng <= 11.7;
}

/** EWKT accepté en entrée par PostGIS pour une colonne geography(Point, 4326). */
export function toEwktPoint({ lat, lng }: LatLng): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

/** Décode le hex EWKB renvoyé par PostGIS pour un Point (avec ou sans SRID). */
export function parseEwkbPoint(hex: string): LatLng {
  const buf = Buffer.from(hex, 'hex');
  const le = buf.readUInt8(0) === 1;
  const type = le ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
  if ((type & 0xff) !== 1) throw new Error(`EWKB : type géométrique ${type} non supporté`);
  const offset = type & 0x20000000 ? 9 : 5;
  const x = le ? buf.readDoubleLE(offset) : buf.readDoubleBE(offset);
  const y = le ? buf.readDoubleLE(offset + 8) : buf.readDoubleBE(offset + 8);
  return { lat: y, lng: x };
}
