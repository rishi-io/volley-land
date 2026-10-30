/*
 * Deployment-level MCP settings from env. MCP has no authentication yet, so exposure is decided
 * here: what a caller may do (MCP_ACCESS), and which hosts and browser origins may reach it.
 */
import { allowedOrigins } from '../config/server-config.js';

export const MCP_CONFIG = Symbol('MCP_CONFIG');

/** What MCP callers may do: nothing, read-only tools, or every tool. */
export type McpAccessLevel = 'off' | 'read' | 'write';

export interface McpConfig {
  access: McpAccessLevel;
  /** Hostnames (no port) the Host header may name: DNS rebinding protection for an unauthenticated server. */
  allowedHosts: string[];
  /** Browser origins allowed to call MCP. Requests without an Origin header (CLI clients) are allowed. */
  allowedOrigins: string[];
  /** Per-caller token bucket: burst size and sustained requests per minute. */
  rateLimit: { burst: number; perMinute: number };
}

const ACCESS_LEVELS: readonly McpAccessLevel[] = ['off', 'read', 'write'];
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const splitList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

export function loadMcpConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const production = env.NODE_ENV === 'production';
  const access = (env.MCP_ACCESS?.trim().toLowerCase() || (production ? 'off' : 'write')) as McpAccessLevel;
  if (!ACCESS_LEVELS.includes(access)) throw new Error(`MCP_ACCESS must be one of ${ACCESS_LEVELS.join(', ')}`);

  const origins = allowedOrigins(env);
  const webHosts = origins.flatMap((origin) => {
    try {
      return [new URL(origin).hostname];
    } catch {
      return [];
    }
  });
  const allowedHosts = [...new Set([...LOOPBACK_HOSTS, ...webHosts, ...splitList(env.MCP_ALLOWED_HOSTS)].map((h) => h.toLowerCase()))];

  const perMinute = Number(env.MCP_RATE_LIMIT_PER_MINUTE ?? 120);
  if (!Number.isInteger(perMinute) || perMinute < 1) throw new Error('MCP_RATE_LIMIT_PER_MINUTE must be a positive integer');

  return { access, allowedHosts, allowedOrigins: origins, rateLimit: { burst: Math.min(30, perMinute), perMinute } };
}
