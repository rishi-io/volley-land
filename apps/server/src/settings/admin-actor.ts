import { randomUUID } from 'node:crypto';
import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Actor } from '../operations/operation.js';
import type { AdminRequest } from './admin.guard.js';

/** The Actor for an admin REST request, from what AdminGuard established. Admin REST callers may write. */
export const AdminActor = createParamDecorator((_data: unknown, context: ExecutionContext): Actor => {
  const req = context.switchToHttp().getRequest<AdminRequest>();
  if (!req.adminPrincipal) throw new Error('AdminActor used on a route without AdminGuard');
  return { requestId: randomUUID(), principal: req.adminPrincipal, access: 'write', via: 'rest', userAgent: req.headers['user-agent'] ?? null };
});
