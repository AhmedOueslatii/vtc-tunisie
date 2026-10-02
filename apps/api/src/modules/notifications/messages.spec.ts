import { describe, expect, it } from 'vitest';
import { DEFINITIONS, NOTIFICATION_TYPES, renderNotification } from './messages.js';

const params = { distanceM: 700, price: 12_300, debt: 42_000, ceiling: 50_000, amount: 10_000, driverName: 'Sami', plate: '123TU4567', reason: 'Photo floue', status: 'in_progress' };

describe('messages de notification', () => {
  it.each(NOTIFICATION_TYPES)('%s : rendu en français et en arabe, sans valeur manquante', (type) => {
    for (const locale of ['fr', 'ar'] as const) {
      const { title, body } = renderNotification(type, locale, params);
      expect(title.length).toBeGreaterThan(0);
      expect(body.length).toBeGreaterThan(0);
      expect(`${title} ${body}`).not.toMatch(/undefined|NaN|\[object/);
    }
    expect(renderNotification(type, 'ar', params).title).not.toBe(renderNotification(type, 'fr', params).title);
  });

  it('affiche les montants en dinars (1 DT = 1000 millimes)', () => {
    expect(renderNotification('trip.completed', 'fr', { price: 12_300 }).body).toContain('12,300 DT');
    expect(renderNotification('trip.completed', 'ar', { price: 12_300 }).body).toContain('12,300 د.ت');
  });

  it("n'affiche pas de valeur absente pour un chauffeur sans nom", () => {
    expect(renderNotification('trip.driver_assigned', 'fr', {}).body).toBe('Votre chauffeur arrive.');
  });

  it('les offres ne vont que sur push ; les événements critiques sont doublés par SMS', () => {
    expect(DEFINITIONS['trip.offer']).toMatchObject({ inbox: false, sms: false });
    for (const type of ['driver.approved', 'driver.rejected', 'trip.cancelled_by_driver', 'wallet.debt_limit'] as const) {
      expect(DEFINITIONS[type].sms).toBe(true);
    }
    expect(NOTIFICATION_TYPES.filter((t) => DEFINITIONS[t].sms)).toHaveLength(4);
  });
});
