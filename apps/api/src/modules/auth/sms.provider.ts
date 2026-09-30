import { Injectable, Logger } from '@nestjs/common';

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsProvider {
  send(to: string, body: string): Promise<void>;
}

/** Dev uniquement : écrit le SMS dans les logs. Brancher ici l'agrégateur SMS retenu. */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SMS');

  async send(to: string, body: string): Promise<void> {
    this.logger.log(`→ ${to} : ${body}`);
  }
}

export const otpMessage = (code: string, locale: 'fr' | 'ar') =>
  locale === 'ar'
    ? `رمز التحقق الخاص بك: ${code}. لا تشاركه مع أي شخص.`
    : `Votre code de vérification : ${code}. Ne le partagez avec personne.`;
