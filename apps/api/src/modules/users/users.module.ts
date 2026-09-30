import { Body, Controller, Get, Inject, Module, Patch } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { Errors } from '../../common/errors.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { DB, type Db } from '../../db/db.js';
import { users } from '../../db/schema.js';
import { CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/tokens.service.js';

const updateSchema = z
  .object({
    fullName: z.string().trim().min(2).max(80),
    email: z.email(),
    locale: z.enum(['fr', 'ar']),
  })
  .partial();

@Controller('me')
export class MeController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async me(@CurrentUser() auth: AuthUser) {
    const [user] = await this.db.select().from(users).where(eq(users.id, auth.id));
    if (!user) throw Errors.notFound('Utilisateur');
    return user;
  }

  @Patch()
  async update(@CurrentUser() auth: AuthUser, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    if (Object.keys(body).length === 0) return this.me(auth);
    const [user] = await this.db.update(users).set(body).where(eq(users.id, auth.id)).returning();
    return user;
  }
}

@Module({ controllers: [MeController] })
export class UsersModule {}
