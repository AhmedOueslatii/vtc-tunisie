import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Errors } from '../../common/errors.js';
import { type AuthUser, TokensService } from './tokens.service.js';

const IS_PUBLIC = 'auth:public';
const ADMIN_ONLY = 'auth:admin';

/** Route accessible sans jeton. Par défaut, toutes les routes exigent une authentification. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest<Request & { user: AuthUser }>().user,
);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw Errors.unauthorized();
    req.user = await this.tokens.verifyAccess(token);

    if (this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY, targets) && !req.user.isAdmin) throw Errors.forbidden();
    return true;
  }
}
