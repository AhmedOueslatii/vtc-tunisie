import { Injectable, Logger } from '@nestjs/common';

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

export interface PushMessage {
  title: string;
  body: string;
  /** Valeurs textuelles uniquement (contrainte FCM/APNs). */
  data: Record<string, string>;
}

export interface PushProvider {
  /** Renvoie les jetons que le fournisseur déclare invalides (appli désinstallée) : ils sont supprimés. */
  send(tokens: string[], message: PushMessage): Promise<{ invalidTokens: string[] }>;
}

/** Dev uniquement : écrit la notification dans les logs. Brancher ici FCM / Expo Push le moment venu. */
@Injectable()
export class ConsolePushProvider implements PushProvider {
  private readonly logger = new Logger('PUSH');

  async send(tokens: string[], message: PushMessage) {
    this.logger.log(`→ ${tokens.length} appareil(s) : ${message.title} — ${message.body}`);
    return { invalidTokens: [] };
  }
}
