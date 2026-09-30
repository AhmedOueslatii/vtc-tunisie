import { Body, Controller, Headers, HttpCode, HttpStatus, Inject, Ip, Post } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { normalizeTunisianMobile } from '../../common/phone.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { DB, type Db } from '../../db/db.js';
import { users } from '../../db/schema.js';
import { Public } from './auth.guard.js';
import { OtpService } from './otp.service.js';
import { TokensService } from './tokens.service.js';

export const phoneSchema = z.string().transform((raw, ctx) => {
  const phone = normalizeTunisianMobile(raw);
  if (!phone) {
    ctx.addIssue({ code: 'custom', message: 'PHONE_INVALID' });
    return z.NEVER;
  }
  return phone;
});

const requestSchema = z.object({ phone: phoneSchema, locale: z.enum(['fr', 'ar']).default('fr') });
const verifySchema = z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/) });
const refreshSchema = z.object({ refreshToken: z.string().min(20) });

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly otp: OtpService,
    private readonly tokens: TokensService,
  ) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.ACCEPTED)
  request(@Body(new ZodPipe(requestSchema)) body: z.infer<typeof requestSchema>, @Ip() ip: string) {
    return this.otp.request(body.phone, ip, body.locale);
  }

  /** Connexion et inscription ne font qu'un : le compte est créé au premier OTP validé. */
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body(new ZodPipe(verifySchema)) body: z.infer<typeof verifySchema>,
    @Headers('user-agent') userAgent?: string,
  ) {
    await this.otp.verify(body.phone, body.code);

    const inserted = await this.db.insert(users).values({ phone: body.phone }).onConflictDoNothing().returning();
    const user = inserted[0] ?? (await this.db.select().from(users).where(eq(users.phone, body.phone)))[0];
    if (!user) throw new Error('Utilisateur introuvable après upsert');
    if (user.status !== 'active') throw new AppError('ACCOUNT_SUSPENDED', 'Compte suspendu', HttpStatus.FORBIDDEN);

    const tokens = await this.tokens.issue({ id: user.id, isAdmin: user.isAdmin }, userAgent);
    return { ...tokens, isNewUser: inserted.length > 0, user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.tokens.rotate(body.refreshToken, userAgent);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    await this.tokens.revoke(body.refreshToken);
  }
}
