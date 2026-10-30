import { describe, expect, it } from 'vitest';
import { loadMcpConfig } from './mcp-config.js';

describe('loadMcpConfig', () => {
  it('allows writes in development and is off in production unless MCP_ACCESS says otherwise', () => {
    expect(loadMcpConfig({ NODE_ENV: 'development' }).access).toBe('write');
    expect(loadMcpConfig({ NODE_ENV: 'production' }).access).toBe('off');
    expect(loadMcpConfig({ NODE_ENV: 'production', MCP_ACCESS: 'READ' }).access).toBe('read');
    expect(() => loadMcpConfig({ MCP_ACCESS: 'admin' })).toThrow();
  });

  it('allows loopback hosts, the web origin hosts and MCP_ALLOWED_HOSTS', () => {
    const config = loadMcpConfig({ WEB_ORIGIN: 'https://play.example.com', MCP_ALLOWED_HOSTS: 'Admin.Example.com, ' });
    expect(config.allowedHosts).toEqual(['localhost', '127.0.0.1', '[::1]', 'play.example.com', 'admin.example.com']);
    expect(config.allowedOrigins).toEqual(['https://play.example.com']);
  });

  it('validates the rate limit', () => {
    expect(loadMcpConfig({ MCP_RATE_LIMIT_PER_MINUTE: '10' }).rateLimit).toEqual({ burst: 10, perMinute: 10 });
    expect(() => loadMcpConfig({ MCP_RATE_LIMIT_PER_MINUTE: '0' })).toThrow();
  });
});
