import { Module } from '@nestjs/common';
import { DriversController } from './drivers.controller.js';
import { DriversService } from './drivers.service.js';
import { PresenceService } from './presence.service.js';

@Module({
  controllers: [DriversController],
  providers: [DriversService, PresenceService],
  exports: [DriversService, PresenceService],
})
export class DriversModule {}
