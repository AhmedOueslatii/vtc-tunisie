import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module.js';
import { MatchingService } from './matching.service.js';
import { MatchingWorker } from './matching.worker.js';

@Module({
  imports: [DriversModule],
  providers: [MatchingService, MatchingWorker],
  exports: [MatchingService],
})
export class MatchingModule {}
