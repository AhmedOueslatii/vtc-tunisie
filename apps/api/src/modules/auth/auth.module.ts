import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { OtpService } from './otp.service.js';
import { ConsoleSmsProvider, SMS_PROVIDER } from './sms.provider.js';
import { TokensService } from './tokens.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    OtpService,
    TokensService,
    { provide: SMS_PROVIDER, useClass: ConsoleSmsProvider },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokensService],
})
export class AuthModule {}
