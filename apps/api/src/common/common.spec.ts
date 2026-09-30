import { describe, expect, it } from 'vitest';
import { computeFare } from '../modules/pricing/fare.js';
import { FieldCipher } from './crypto.js';
import { haversineMeters, isInTunisia, parseEwkbPoint } from './geo.js';
import { normalizeTunisianMobile } from './phone.js';
import { normalizePlate } from './plate.js';

describe('normalizeTunisianMobile', () => {
  it.each([
    ['22 123 456', '+21622123456'],
    ['+216 98 765 432', '+21698765432'],
    ['0021655123456', '+21655123456'],
    ['21640123456', '+21640123456'],
    ['29-123-456', '+21629123456'],
  ])('%s → %s', (input, expected) => expect(normalizeTunisianMobile(input)).toBe(expected));

  it.each(['71 123 456', '2212345', '221234567', '+33612345678', 'abc'])('refuse %s', (input) =>
    expect(normalizeTunisianMobile(input)).toBeNull(),
  );
});

describe('normalizePlate', () => {
  it.each([
    ['123 تونس 4567', '123TU4567'],
    ['45 TU 12', '45TU12'],
    ['123456 ن ت', '123456RS'],
  ])('%s → %s', (input, expected) => expect(normalizePlate(input)).toBe(expected));

  it('refuse une plaque étrangère', () => expect(normalizePlate('AB-123-CD')).toBeNull());
});

describe('computeFare', () => {
  const rule = { baseFare: 1_500, perKm: 700, perMinute: 100, minimumFare: 4_000, bookingFee: 0 };

  it('applique base + km + minutes, arrondi à 100 millimes', () => {
    // 1500 + 7.3 km × 700 + 18 min × 100 = 1500 + 5110 + 1800 = 8410 → 8400
    expect(computeFare(rule, 7_300, 18 * 60)).toBe(8_400);
  });

  it('applique le minimum', () => expect(computeFare(rule, 500, 120)).toBe(4_000));

  it('applique la majoration puis les frais de réservation', () => {
    expect(computeFare({ ...rule, bookingFee: 500 }, 7_300, 18 * 60, 1.5)).toBe(13_100);
  });
});

describe('geo', () => {
  it('distance Tunis (Bab Bhar) → La Marsa ≈ 17 km', () => {
    const d = haversineMeters({ lat: 36.7998, lng: 10.18 }, { lat: 36.8782, lng: 10.3247 });
    expect(d).toBeGreaterThan(15_000);
    expect(d).toBeLessThan(17_000);
  });

  it('zone de service', () => {
    expect(isInTunisia({ lat: 33.8869, lng: 9.5375 })).toBe(true); // Gabès
    expect(isInTunisia({ lat: 48.85, lng: 2.35 })).toBe(false);
  });

  it('décode un point EWKB renvoyé par PostGIS', () => {
    // SELECT 'SRID=4326;POINT(10.18 36.8)'::geography
    expect(parseEwkbPoint('0101000020E61000005C8FC2F5285C24406666666666664240')).toMatchObject({
      lng: expect.closeTo(10.18, 6),
      lat: expect.closeTo(36.8, 6),
    });
  });
});

describe('FieldCipher', () => {
  const cipher = new FieldCipher(Buffer.alloc(32, 7).toString('base64'));

  it('chiffre et déchiffre, avec un IV aléatoire', () => {
    const a = cipher.encrypt('01234567');
    expect(a).not.toBe(cipher.encrypt('01234567'));
    expect(cipher.decrypt(a)).toBe('01234567');
  });

  it("l'empreinte de recherche est stable et insensible à la casse", () => {
    expect(cipher.lookupHash(' ab123 ')).toBe(cipher.lookupHash('AB123'));
  });
});
