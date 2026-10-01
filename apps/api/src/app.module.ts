import { Controller, Get, Inject, Module } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { DB, type Db } from './db/db.js';
import { InfraModule, REDIS } from './infra/infra.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { Public } from './modules/auth/auth.guard.js';
import { DriversModule } from './modules/drivers/drivers.module.js';
import { MatchingModule } from './modules/matching/matching.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PlacesModule } from './modules/places/places.module.js';
import { SupportModule } from './modules/support/support.module.js';
import { RealtimeModule } from './modules/realtime/realtime.server.js';
import { TripsModule } from './modules/trips/trips.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Public()
@Controller('health')
class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async check() {
    await this.db.execute(sql`SELECT 1`);
    await this.redis.ping();
    return { status: 'ok' };
  }
}

@Module({
  imports: [InfraModule, AuthModule, NotificationsModule, UsersModule, DriversModule, MatchingModule, TripsModule, PlacesModule, RealtimeModule, SupportModule, AdminModule],
  controllers: [HealthController],
})
export class AppModule {}
