import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type INestApplication, Injectable, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { McpAccessGuard } from './mcp-access.guard.js';
import { MCP_CONFIG, type McpConfig } from './mcp-config.js';
import { McpServerModule } from './mcp-server.module.js';
import { OPERATIONS_CONFIG } from '../operations/operation-runner.service.js';
import { type AnyOperation, OperationError, type OperationProvider, Operations, defineOperation } from '../operations/operation.js';

/** A stand-in domain: one read operation, write operations, and operations that reject, crash or hang. */
@Operations()
@Injectable()
class ProbeOperations implements OperationProvider {
  names = new Map<string, { name: string; version: number }>([['a', { name: 'Alpha', version: 1 }]]);

  operations(): AnyOperation[] {
    return [
      defineOperation({
        name: 'get_thing',
        title: 'Get thing',
        description: 'Read a thing by id.',
        input: z.object({ id: z.string().describe('Thing id') }),
        access: 'read',
        run: ({ id }) => {
          const thing = this.names.get(id);
          if (!thing) throw new OperationError('not_found', `No thing "${id}"`);
          return thing;
        },
      }),
      defineOperation({
        name: 'rename_thing',
        title: 'Rename thing',
        description: 'Rename a thing.',
        input: z.object({ id: z.string(), name: z.string().min(1), expectedVersion: z.int().positive() }).refine((i) => i.name !== 'reserved', {
          path: ['name'],
          message: 'is reserved',
        }),
        access: 'write',
        run: ({ id, name, expectedVersion }) => {
          const thing = this.names.get(id);
          if (!thing) throw new OperationError('not_found', `No thing "${id}"`);
          if (thing.version !== expectedVersion) throw new OperationError('conflict', `Stale version: now v${thing.version}`);
          const next = { name, version: thing.version + 1 };
          this.names.set(id, next);
          return next;
        },
      }),
      defineOperation({
        name: 'delete_thing',
        title: 'Delete thing',
        description: 'Delete a thing.',
        input: z.object({ id: z.string() }),
        access: 'write',
        destructive: true,
        run: ({ id }) => {
          this.names.delete(id);
        },
      }),
      defineOperation({
        name: 'crash',
        title: 'Crash',
        description: 'Throws a bug.',
        input: z.object({}),
        access: 'read',
        run: () => {
          throw new Error('secret internal detail');
        },
      }),
      defineOperation({
        name: 'hang',
        title: 'Hang',
        description: 'Never finishes.',
        input: z.object({}),
        access: 'read',
        run: () => new Promise(() => {}),
      }),
    ];
  }
}

const BASE_CONFIG: McpConfig = {
  access: 'write',
  allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
  allowedOrigins: ['http://localhost:3000'],
  rateLimit: { burst: 1_000, perMinute: 60_000 },
};

let app: INestApplication | null = null;
const clients: Client[] = [];

async function start(config: Partial<McpConfig> = {}): Promise<{ url: URL; guard: McpAccessGuard }> {
  const moduleRef = await Test.createTestingModule({ imports: [McpServerModule], providers: [ProbeOperations] })
    .overrideProvider(MCP_CONFIG)
    .useValue({ ...BASE_CONFIG, ...config })
    .overrideProvider(OPERATIONS_CONFIG)
    .useValue({ timeoutMs: 200 })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0);
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { url: new URL(`http://127.0.0.1:${port}/api/mcp`), guard: moduleRef.get(McpAccessGuard) };
}

async function connect(url: URL): Promise<Client> {
  const client = new Client({ name: 'vitest', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(url));
  clients.push(client);
  return client;
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as CallToolResult;
const textOf = (result: CallToolResult): string => (result.content[0] as { text: string }).text;

/** A raw POST, so a test can set headers fetch will not (Host) and read the status. */
function post(url: URL, headers: Record<string, string> = {}, body: unknown = { jsonrpc: '2.0', id: 1, method: 'tools/list' }) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers } },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await app?.close();
  app = null;
  vi.restoreAllMocks();
});

describe('MCP server', () => {
  it('lists every tool with annotations derived from access, plus get_server_info', async () => {
    const client = await connect((await start()).url);
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect([...byName.keys()].sort()).toEqual(['crash', 'delete_thing', 'get_server_info', 'get_thing', 'hang', 'rename_thing']);
    expect(byName.get('get_thing')?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(byName.get('rename_thing')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    expect(byName.get('delete_thing')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(byName.get('get_thing')?.inputSchema).toMatchObject({ type: 'object', properties: { id: { type: 'string', description: 'Thing id' } }, required: ['id'] });
    expect(client.getInstructions()).toContain('optimistic concurrency');
  });

  it('runs tools and returns their output as JSON text', async () => {
    const client = await connect((await start()).url);
    expect(JSON.parse(textOf(await call(client, 'get_thing', { id: 'a' })))).toEqual({ name: 'Alpha', version: 1 });
    expect(JSON.parse(textOf(await call(client, 'rename_thing', { id: 'a', name: 'Beta', expectedVersion: 1 })))).toEqual({ name: 'Beta', version: 2 });
    expect(textOf(await call(client, 'delete_thing', { id: 'a' }))).toBe('Done.');
    const info = JSON.parse(textOf(await call(client, 'get_server_info')));
    expect(info).toMatchObject({ server: 'volleyland', access: 'write', principal: expect.stringMatching(/^anonymous:/) });
  });

  it('turns bad input, rejections, bugs and timeouts into tool errors, not protocol errors', async () => {
    const client = await connect((await start()).url);

    const invalid = await call(client, 'rename_thing', { id: 'a', name: 'reserved', expectedVersion: 1 });
    expect(invalid.isError).toBe(true);
    expect(textOf(invalid)).toContain('name'); // the SDK checks the advertised schema first, refinements included

    const conflict = await call(client, 'rename_thing', { id: 'a', name: 'Beta', expectedVersion: 7 });
    expect(conflict).toMatchObject({ isError: true });
    expect(textOf(conflict)).toBe('Stale version: now v1');

    const missing = await call(client, 'get_thing', { id: 'zzz' });
    expect(textOf(missing)).toBe('No thing "zzz"');

    const crash = await call(client, 'crash');
    expect(crash.isError).toBe(true);
    expect(textOf(crash)).toMatch(/failed unexpectedly.*request [0-9a-f-]{36}/);
    expect(textOf(crash)).not.toContain('secret');

    const hang = await call(client, 'hang');
    expect(hang.isError).toBe(true);
    expect(textOf(hang)).toContain('did not finish within 200 ms');
  });

  it('hides and refuses write tools when MCP is read-only', async () => {
    const client = await connect((await start({ access: 'read' })).url);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['crash', 'get_server_info', 'get_thing', 'hang']);
    const refused = await call(client, 'rename_thing', { id: 'a', name: 'Beta', expectedVersion: 1 });
    expect(refused.isError).toBe(true);
  });

  it('audits each tool call as an operation call, without the arguments', async () => {
    const lines: string[] = [];
    const spy = (message: unknown) => void lines.push(String(message));
    vi.spyOn(Logger.prototype, 'log').mockImplementation(spy);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(spy);
    const client = await connect((await start()).url);
    await call(client, 'get_thing', { id: 'a' });
    await call(client, 'rename_thing', { id: 'a', name: 'Top Secret Name', expectedVersion: 9 });

    expect(lines.find((l) => l.startsWith('mcp.client_connected'))).toMatch(/client=vitest@1\.0\.0 protocol=\S+ access=write/);
    const calls = lines.filter((l) => l.startsWith('op.call'));
    expect(calls).toEqual([
      expect.stringMatching(/^op\.call op=get_thing via=mcp outcome=ok ms=[\d.]+ access=write principal=anonymous:\S+ request=[0-9a-f-]{36}/),
      expect.stringMatching(/^op\.call op=rename_thing via=mcp outcome=rejected /),
    ]);
    expect(lines.join('\n')).not.toContain('Top Secret Name');
  });

  it('refuses requests before the transport: disabled, foreign host, foreign origin, rate limit', async () => {
    const off = await start({ access: 'off' });
    expect((await post(off.url)).status).toBe(403);
    await app!.close();

    const { url, guard } = await start({ rateLimit: { burst: 2, perMinute: 60 } });
    expect((await post(url, { host: 'evil.example:3001' })).status).toBe(403); // DNS rebinding
    expect((await post(url, { origin: 'https://evil.example' })).status).toBe(403);

    let now = 1_000_000;
    guard.now = () => now;
    expect((await post(url, { origin: 'http://localhost:3000' })).status).toBe(200);
    expect((await post(url)).status).toBe(200);
    const limited = await post(url);
    expect(limited.status).toBe(429);
    expect(JSON.parse(limited.body)).toMatchObject({ retryAfterSeconds: 1 });
    now += 1_000;
    expect((await post(url)).status).toBe(200);
  });

  it('answers GET and DELETE with 405, since it is stateless', async () => {
    const { url } = await start();
    for (const method of ['GET', 'DELETE']) {
      const res = await fetch(url, { method, headers: { accept: 'text/event-stream' } });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    }
  });

  it('rejects malformed JSON-RPC with a protocol error', async () => {
    const { url } = await start();
    const res = await post(url, {}, { not: 'json-rpc' });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ jsonrpc: '2.0', error: { code: expect.any(Number) } });
  });
});
