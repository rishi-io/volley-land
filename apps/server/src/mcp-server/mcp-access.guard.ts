import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { type CanActivate, type ExecutionContext, ForbiddenException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { TokenBucket } from '../game-gateway/token-bucket.js';
import type { Actor } from '../operations/operation.js';
import { MCP_CONFIG, type McpConfig } from './mcp-config.js';

export type McpRequest = IncomingMessage & { ip?: string; body?: unknown; mcpActor?: Actor };

/** Above this many tracked callers, buckets idle long enough to be full again are dropped. */
const MAX_BUCKETS = 1_000;

/** Port-agnostic hostname of a Host header, including bracketed IPv6. */
const hostnameOf = (host: string): string => {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith('[')) return trimmed.slice(0, trimmed.indexOf(']') + 1);
  return trimmed.split(':')[0] ?? '';
};

/**
 * Admits an MCP request before the transport sees it, so refusals are ordinary HTTP errors:
 * MCP enabled → Host allowed (DNS rebinding) → Origin allowed (browsers) → rate limit. Then it
 * attaches the McpCaller. There is no authentication yet: the caller is anonymous and keyed by
 * network address; this is where a principal from a token or session will be resolved.
 */
@Injectable()
export class McpAccessGuard implements CanActivate {
  private readonly buckets = new Map<string, { bucket: TokenBucket; seenAt: number }>();
  /** Clock for the rate limiter; injectable so tests can drive time. */
  now: () => number = () => Date.now();

  constructor(@Inject(MCP_CONFIG) private readonly config: McpConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<McpRequest>();
    const { access } = this.config;
    if (access === 'off') throw new ForbiddenException({ error: 'forbidden', message: 'MCP is disabled on this server (MCP_ACCESS=off)' });

    const host = hostnameOf(req.headers.host ?? '');
    if (!this.config.allowedHosts.includes(host)) {
      throw new ForbiddenException({ error: 'forbidden', message: `Host "${host}" is not allowed (MCP_ALLOWED_HOSTS)` });
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !this.config.allowedOrigins.includes(origin)) {
      throw new ForbiddenException({ error: 'forbidden', message: `Origin "${origin}" is not allowed` });
    }

    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    if (!this.take(key)) {
      const retryAfterSeconds = Math.ceil(60 / this.config.rateLimit.perMinute);
      throw new HttpException({ error: 'rate_limited', message: 'Too many MCP requests', retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const userAgent = req.headers['user-agent'];
    req.mcpActor = { requestId: randomUUID(), principal: { kind: 'anonymous', key }, access, via: 'mcp', userAgent: userAgent ?? null };
    return true;
  }

  private take(key: string): boolean {
    const now = this.now();
    const { burst, perMinute } = this.config.rateLimit;
    if (this.buckets.size >= MAX_BUCKETS) {
      const refillMs = (burst / perMinute) * 60_000;
      for (const [k, entry] of this.buckets) if (now - entry.seenAt > refillMs) this.buckets.delete(k);
    }
    const entry = this.buckets.get(key) ?? { bucket: new TokenBucket(burst, perMinute / 60, now), seenAt: now };
    entry.seenAt = now;
    this.buckets.set(key, entry);
    return entry.bucket.tryTake(now);
  }
}
