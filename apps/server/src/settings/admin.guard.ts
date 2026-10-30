import { timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AdminError } from '@volleyland/contracts';
import { ADMIN_AUTH, type AdminAuth } from '../config/server-config.js';
import type { Principal } from '../operations/operation.js';

/** The admin request after AdminGuard: it says who the caller is. */
export interface AdminRequest {
  headers: { authorization?: string; 'user-agent'?: string };
  ip?: string;
  socket?: { remoteAddress?: string };
  adminPrincipal?: Principal;
}

const matches = (given: string, expected: string): boolean => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Phase 0 admin access: a shared bearer token (ADMIN_TOKEN). Without one the admin API is open in
 * development and disabled in production. Phase 1 replaces this with real accounts and roles.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(ADMIN_AUTH) private readonly auth: AdminAuth) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    if (this.auth.token === null) {
      if (this.auth.openWithoutToken) {
        req.adminPrincipal = { kind: 'anonymous', key: req.ip ?? req.socket?.remoteAddress ?? 'unknown' };
        return true;
      }
      throw new ForbiddenException({ error: 'forbidden', message: 'The admin API is disabled: set ADMIN_TOKEN on the server' } satisfies AdminError);
    }
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!matches(token, this.auth.token)) {
      throw new UnauthorizedException({ error: 'unauthorized', message: 'Admin token required' } satisfies AdminError);
    }
    req.adminPrincipal = { kind: 'admin-token' };
    return true;
  }
}
