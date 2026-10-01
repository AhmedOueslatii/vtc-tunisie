import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service.js';
import { DriversController } from './drivers.controller.js';
import { DriversService } from './drivers.service.js';
import { PresenceService } from './presence.service.js';

@Module({
  controllers: [DriversController],
  providers: [DriversService, DocumentsService, PresenceService],
  exports: [DriversService, DocumentsService, PresenceService],
})
export class DriversModule {}
