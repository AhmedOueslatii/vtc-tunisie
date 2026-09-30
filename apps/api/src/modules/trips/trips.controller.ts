import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { latLngSchema, ZodPipe } from '../../common/zod.pipe.js';
import { CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { TripsService } from './trips.service.js';

const estimateSchema = z.object({
  pickup: latLngSchema,
  dropoff: latLngSchema,
  pickupAddress: z.string().max(300).optional(),
  dropoffAddress: z.string().max(300).optional(),
  category: z.enum(['standard', 'premium', 'van']).default('standard'),
});

const requestSchema = z.object({
  quoteId: z.uuid(),
  // Phase 1 : cash uniquement. Flouci / Konnect / ClicToPay en phase 2.
  paymentMethod: z.literal('cash').default('cash'),
});

const cancelSchema = z.object({ reason: z.string().max(300).optional() });
const idempotencyKey = z.string().min(8).max(64).optional();

@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Post('estimate')
  @HttpCode(HttpStatus.OK)
  estimate(@CurrentUser() user: AuthUser, @Body(new ZodPipe(estimateSchema)) body: z.infer<typeof estimateSchema>) {
    return this.trips.estimate(user.id, body);
  }

  @Post()
  request(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(requestSchema)) body: z.infer<typeof requestSchema>,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.trips.request(user.id, body.quoteId, new ZodPipe(idempotencyKey).transform(key));
  }

  @Get('active')
  active(@CurrentUser() user: AuthUser) {
    return this.trips.active(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.trips.get(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(cancelSchema)) body: z.infer<typeof cancelSchema>,
  ) {
    return this.trips.cancel(user.id, id, body.reason);
  }

  // ─── Actions chauffeur ─────────────────────────────────────────────────────

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.trips.accept(user.id, id);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  decline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.trips.decline(user.id, id);
  }

  @Post(':id/arrived')
  @HttpCode(HttpStatus.OK)
  arrived(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.trips.markArrived(user.id, id);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.trips.start(user.id, id);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.trips.complete(user.id, id);
  }
}
