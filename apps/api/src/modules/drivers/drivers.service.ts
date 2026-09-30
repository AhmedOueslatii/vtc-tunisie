import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { FieldCipher } from '../../common/crypto.js';
import { uniqueViolation } from '../../common/db-errors.js';
import { normalizePlate } from '../../common/plate.js';
import { AppError, Errors } from '../../common/errors.js';
import type { LatLng } from '../../common/geo.js';
import { env } from '../../config/env.js';
import { DB, type Db } from '../../db/db.js';
import { driverProfiles, vehicles } from '../../db/schema.js';
import { RealtimeEmitter } from '../../infra/infra.module.js';
import { PresenceService, type VehicleCategory } from './presence.service.js';

export interface OnboardingInput {
  cinNumber: string;
  licenseNumber: string;
  licenseExpiry: string;
}

export interface VehicleInput {
  make: string;
  model: string;
  color: string;
  year: number;
  plate: string;
  category: VehicleCategory;
}

export interface LocationPoint extends LatLng {
  ts: number;
  heading?: number;
  speed?: number;
}

@Injectable()
export class DriversService {
  private readonly cipher = new FieldCipher(env().DATA_ENCRYPTION_KEY);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly presence: PresenceService,
    private readonly realtime: RealtimeEmitter,
  ) {}

  async getProfile(driverId: string) {
    const [profile] = await this.db.select().from(driverProfiles).where(eq(driverProfiles.userId, driverId));
    if (!profile) return null;
    const [vehicle] = await this.db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.driverId, driverId), eq(vehicles.isActive, true)));
    return {
      status: profile.status,
      licenseExpiry: profile.licenseExpiry,
      rejectionReason: profile.rejectionReason,
      vehicle: vehicle ?? null,
      presence: await this.presence.getState(driverId),
    };
  }

  async onboard(userId: string, input: OnboardingInput) {
    try {
      await this.db.insert(driverProfiles).values({
        userId,
        cinEncrypted: this.cipher.encrypt(input.cinNumber),
        cinHash: this.cipher.lookupHash(input.cinNumber),
        licenseEncrypted: this.cipher.encrypt(input.licenseNumber),
        licenseHash: this.cipher.lookupHash(input.licenseNumber),
        licenseExpiry: input.licenseExpiry,
      });
    } catch (e) {
      const constraint = uniqueViolation(e);
      if (constraint === 'driver_profiles_pkey') throw Errors.conflict('DRIVER_ALREADY_REGISTERED', 'Profil chauffeur déjà créé');
      if (constraint !== null) throw Errors.conflict('DRIVER_IDENTITY_IN_USE', 'CIN ou permis déjà utilisé par un autre compte');
      throw e;
    }
    return this.getProfile(userId);
  }

  async addVehicle(driverId: string, input: VehicleInput) {
    const plate = normalizePlate(input.plate);
    if (!plate) throw new AppError('PLATE_INVALID', 'Immatriculation non reconnue');
    await this.requireProfile(driverId);
    if ((await this.presence.getState(driverId))?.status === 'on_trip') {
      throw new AppError('DRIVER_ON_TRIP', 'Impossible de changer de véhicule pendant une course', HttpStatus.CONFLICT);
    }

    try {
      return await this.db.transaction(async (tx) => {
        await tx.update(vehicles).set({ isActive: false }).where(eq(vehicles.driverId, driverId));
        const [vehicle] = await tx
          .insert(vehicles)
          .values({ ...input, plate, driverId, isActive: true })
          .returning();
        return vehicle;
      });
    } catch (e) {
      if (uniqueViolation(e) === 'vehicles_plate_unique') throw Errors.conflict('PLATE_IN_USE', 'Immatriculation déjà enregistrée');
      throw e;
    }
  }

  async setAvailability(driverId: string, online: boolean) {
    if (!online) {
      if ((await this.presence.getState(driverId))?.status === 'on_trip') {
        throw new AppError('DRIVER_ON_TRIP', 'Terminer la course avant de passer hors ligne', HttpStatus.CONFLICT);
      }
      await this.presence.goOffline(driverId);
      return { online: false };
    }

    const profile = await this.requireProfile(driverId);
    if (profile.status !== 'approved') {
      throw new AppError('DRIVER_NOT_APPROVED', 'Compte chauffeur en attente de validation', HttpStatus.FORBIDDEN, {
        status: profile.status,
      });
    }
    if (new Date(profile.licenseExpiry) < new Date()) {
      throw new AppError('LICENSE_EXPIRED', 'Permis de conduire expiré', HttpStatus.FORBIDDEN);
    }
    const [vehicle] = await this.db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.driverId, driverId), eq(vehicles.isActive, true)));
    if (!vehicle) throw new AppError('NO_ACTIVE_VEHICLE', 'Aucun véhicule actif', HttpStatus.FORBIDDEN);
    // Phase 1b : refuser si la dette de commissions cash dépasse le plafond.

    const current = await this.presence.getState(driverId);
    if (current?.status !== 'on_trip') await this.presence.goOnline(driverId, vehicle.category, vehicle.id);
    return { online: true, category: vehicle.category };
  }

  /**
   * Accepte un lot de points (l'app les met en file quand le réseau coupe) ; seul le plus récent
   * sert à la présence. Pendant une course, la position est relayée au passager.
   */
  async updateLocation(driverId: string, points: LocationPoint[]): Promise<{ accepted: boolean }> {
    const latest = points.reduce((a, b) => (b.ts > a.ts ? b : a));
    const state = await this.presence.updateLocation(driverId, latest, latest.ts);
    if (!state) return { accepted: false };
    if (state.status === 'on_trip' && state.passengerId) {
      this.realtime.toUser(state.passengerId, 'driver:location', {
        tripId: state.tripId,
        lat: latest.lat,
        lng: latest.lng,
        heading: latest.heading,
        ts: latest.ts,
      });
    }
    return { accepted: true };
  }

  private async requireProfile(driverId: string) {
    const [profile] = await this.db.select().from(driverProfiles).where(eq(driverProfiles.userId, driverId));
    if (!profile) throw new AppError('NOT_A_DRIVER', 'Profil chauffeur inexistant', HttpStatus.FORBIDDEN);
    return profile;
  }
}
