import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { Redis } from 'ioredis';
import { hmac, safeEqual } from '../../common/crypto.js';
import { AppError } from '../../common/errors.js';
import { env } from '../../config/env.js';
import { REDIS } from '../../infra/infra.module.js';
import { otpMessage, SMS_PROVIDER, type SmsProvider } from './sms.provider.js';

const OTP_TTL_S = 300;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_S = 60;
const MAX_PER_PHONE_PER_HOUR = 5;
const MAX_PER_IP_PER_HOUR = 20;

@Injectable()
export class OtpService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  async request(phone: string, ip: string, locale: 'fr' | 'ar'): Promise<{ expiresInS: number; resendInS: number }> {
    const cooldown = await this.redis.set(`otp:cooldown:${phone}`, '1', 'EX', RESEND_COOLDOWN_S, 'NX');
    if (cooldown !== 'OK') {
      const ttl = await this.redis.ttl(`otp:cooldown:${phone}`);
      throw new AppError('OTP_TOO_SOON', 'Attendre avant de redemander un code', HttpStatus.TOO_MANY_REQUESTS, {
        retryAfterS: Math.max(ttl, 1),
      });
    }
    await this.enforceHourlyLimit(`otp:rl:phone:${phone}`, MAX_PER_PHONE_PER_HOUR);
    await this.enforceHourlyLimit(`otp:rl:ip:${ip}`, MAX_PER_IP_PER_HOUR);

    const { OTP_DEV_FIXED_CODE, OTP_SECRET } = env();
    const code = OTP_DEV_FIXED_CODE ?? randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis
      .multi()
      .hset(`otp:${phone}`, { hash: hmac(OTP_SECRET, `${phone}:${code}`), attempts: 0 })
      .expire(`otp:${phone}`, OTP_TTL_S)
      .exec();
    await this.sms.send(phone, otpMessage(code, locale));
    return { expiresInS: OTP_TTL_S, resendInS: RESEND_COOLDOWN_S };
  }

  /** Consomme le code : un code valide ne sert qu'une seule fois. */
  async verify(phone: string, code: string): Promise<void> {
    const key = `otp:${phone}`;
    const stored = await this.redis.hget(key, 'hash');
    if (!stored) throw new AppError('OTP_EXPIRED', 'Code expiré ou inexistant');

    const attempts = await this.redis.hincrby(key, 'attempts', 1);
    if (attempts > MAX_ATTEMPTS) {
      await this.redis.del(key);
      throw new AppError('OTP_TOO_MANY_ATTEMPTS', 'Trop de tentatives', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!safeEqual(stored, hmac(env().OTP_SECRET, `${phone}:${code}`))) {
      throw new AppError('OTP_INVALID', 'Code incorrect', HttpStatus.BAD_REQUEST, {
        attemptsLeft: MAX_ATTEMPTS - attempts,
      });
    }
    // DEL renvoie 0 si une requête concurrente a déjà consommé ce code
    if ((await this.redis.del(key)) === 0) throw new AppError('OTP_EXPIRED', 'Code déjà utilisé');
  }

  private async enforceHourlyLimit(key: string, max: number) {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 3600);
    if (count > max) {
      throw new AppError('OTP_RATE_LIMITED', 'Trop de demandes de code', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
