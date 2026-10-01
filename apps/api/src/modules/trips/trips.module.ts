import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module.js';
import { MatchingModule } from '../matching/matching.module.js';
import { PricingService } from '../pricing/pricing.service.js';
import { createRoutingProvider, ROUTING_PROVIDER } from '../routing/routing.provider.js';
import { TripsController } from './trips.controller.js';
import { TripsService } from './trips.service.js';

@Module({
  imports: [DriversModule, MatchingModule],
  controllers: [TripsController],
  exports: [TripsService],
  providers: [TripsService, PricingService, { provide: ROUTING_PROVIDER, useFactory: createRoutingProvider }],
})
export class TripsModule {}
