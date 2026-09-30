import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type Job, type Queue, Worker } from 'bullmq';
import { env } from '../../config/env.js';
import { createBullConnection, MATCHING_QUEUE } from '../../infra/infra.module.js';
import { PresenceService } from '../drivers/presence.service.js';
import { MatchingService } from './matching.service.js';

/** Consommateur de la file `matching`. Ne démarre que si PROCESS_ROLE vaut `worker` ou `all`. */
@Injectable()
export class MatchingWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MatchingWorker.name);
  private worker?: Worker;

  constructor(
    @Inject(MATCHING_QUEUE) private readonly queue: Queue,
    private readonly matching: MatchingService,
    private readonly presence: PresenceService,
  ) {}

  async onApplicationBootstrap() {
    if (env().PROCESS_ROLE === 'api') return;

    this.worker = new Worker('matching', (job) => this.handle(job), {
      connection: createBullConnection(),
      concurrency: 20,
    });
    this.worker.on('failed', (job, err) => this.logger.error(`job ${job?.name} ${job?.id} échoué : ${err.message}`));
    await this.queue.upsertJobScheduler('sweep-stale-drivers', { every: 60_000 }, { name: 'sweep-stale-drivers' });
    this.logger.log('worker matching démarré');
  }

  async onApplicationShutdown() {
    await this.worker?.close();
  }

  private async handle(job: Job): Promise<void> {
    switch (job.name) {
      case 'dispatch':
        return this.matching.dispatch(job.data.tripId);
      case 'offer-timeout':
        return this.matching.onOfferTimeout(job.data.offerId).then(() => undefined);
      case 'sweep-stale-drivers': {
        const removed = await this.presence.sweepStale();
        if (removed > 0) this.logger.log(`${removed} chauffeur(s) inactif(s) retiré(s) de l'index`);
        return;
      }
      default:
        this.logger.warn(`job inconnu : ${job.name}`);
    }
  }
}
