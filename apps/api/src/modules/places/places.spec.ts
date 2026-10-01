import { describe, expect, it } from 'vitest';
import { normalizeText, STATIC_PLACES, StaticGeocodingProvider } from './geocoding.provider.js';

const geocoder = new StaticGeocodingProvider();
const SFAX = { lat: 34.74, lng: 10.76 };

describe('normalizeText', () => {
  it('ignore accents, casse et voyelles arabes', () => {
    expect(normalizeText('  Gabès ')).toBe('gabes');
    expect(normalizeText('المَرسى')).toBe('المرسى');
  });
});

describe('StaticGeocodingProvider', () => {
  it('trouve un lieu par son nom, sans tenir compte des accents', async () => {
    expect((await geocoder.search('gabes', undefined, 5))[0]?.name).toBe('Gabès');
    expect((await geocoder.search('MARSA', undefined, 5))[0]?.name).toBe('La Marsa');
  });

  it('cherche aussi en arabe', async () => {
    expect((await geocoder.search('المرسى', undefined, 5))[0]?.name).toBe('La Marsa');
    expect((await geocoder.search('سوسة', undefined, 5))[0]?.name).toBe('Sousse');
  });

  it("classe les résultats par proximité quand la position de l'utilisateur est connue", async () => {
    expect((await geocoder.search('aeroport', undefined, 5)).length).toBeGreaterThan(1);
    expect((await geocoder.search('aeroport', SFAX, 5))[0]?.name).toBe('Aéroport Sfax-Thyna');
    expect((await geocoder.search('aeroport', { lat: 36.8, lng: 10.18 }, 5))[0]?.name).toBe('Aéroport Tunis-Carthage');
  });

  it('respecte la limite et ne renvoie rien pour une requête inconnue', async () => {
    expect(await geocoder.search('aeroport', undefined, 2)).toHaveLength(2);
    expect(await geocoder.search('zzzzzz', undefined, 5)).toEqual([]);
  });

  it("n'expose pas les alias", async () => {
    expect(Object.keys((await geocoder.search('marsa', undefined, 1))[0]!).sort()).toEqual(['address', 'id', 'lat', 'lng', 'name']);
  });

  it('géocode à l\'envers : lieu le plus proche, ou rien dans le désert', async () => {
    expect((await geocoder.reverse({ lat: 36.879, lng: 10.325 }))?.name).toBe('La Marsa');
    expect(await geocoder.reverse({ lat: 31.0, lng: 9.0 })).toBeNull();
  });

  it('chaque lieu est dans la zone de service avec un identifiant unique', () => {
    expect(new Set(STATIC_PLACES.map((p) => p.id)).size).toBe(STATIC_PLACES.length);
    for (const p of STATIC_PLACES) {
      expect(p.lat).toBeGreaterThan(30.2);
      expect(p.lat).toBeLessThan(37.6);
      expect(p.lng).toBeGreaterThan(7.5);
      expect(p.lng).toBeLessThan(11.7);
    }
  });
});
