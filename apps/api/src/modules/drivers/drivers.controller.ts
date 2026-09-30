import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { z } from 'zod';
import { latLngSchema, ZodPipe } from '../../common/zod.pipe.js';
import { CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { DriversService } from './drivers.service.js';

const onboardingSchema = z.object({
  cinNumber: z.string().regex(/^\d{8}$/, 'CIN_INVALID'),
  licenseNumber: z.string().trim().min(5).max(20),
  licenseExpiry: z.iso.date(),
});

const vehicleSchema = z.object({
  make: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(40),
  color: z.string().trim().min(1).max(30),
  year: z.number().int().min(2005).max(new Date().getFullYear() + 1),
  plate: z.string().min(3).max(30),
  category: z.enum(['standard', 'premium', 'van']).default('standard'),
});

const availabilitySchema = z.object({ online: z.boolean() });

export const locationPointSchema = latLngSchema.extend({
  ts: z.number().int().positive(),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).optional(),
});
const locationSchema = z.object({ points: z.array(locationPointSchema).min(1).max(100) });

@Controller('drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Post('onboarding')
  onboard(@CurrentUser() user: AuthUser, @Body(new ZodPipe(onboardingSchema)) body: z.infer<typeof onboardingSchema>) {
    return this.drivers.onboard(user.id, body);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.drivers.getProfile(user.id);
  }

  @Post('me/vehicles')
  addVehicle(@CurrentUser() user: AuthUser, @Body(new ZodPipe(vehicleSchema)) body: z.infer<typeof vehicleSchema>) {
    return this.drivers.addVehicle(user.id, body);
  }

  @Post('me/availability')
  @HttpCode(HttpStatus.OK)
  availability(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(availabilitySchema)) body: z.infer<typeof availabilitySchema>,
  ) {
    return this.drivers.setAvailability(user.id, body.online);
  }

  /** Fallback HTTP du WebSocket `driver:location`, utile quand le socket ne tient pas. */
  @Post('me/location')
  @HttpCode(HttpStatus.OK)
  location(@CurrentUser() user: AuthUser, @Body(new ZodPipe(locationSchema)) body: z.infer<typeof locationSchema>) {
    return this.drivers.updateLocation(user.id, body.points);
  }
}
