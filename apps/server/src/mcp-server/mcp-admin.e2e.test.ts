import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AdminSettingsResponseSchema } from '@volleyland/contracts';
import { DEFAULT_WORLD_ID } from '@volleyland/game-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { InMemorySettingsStore } from '../settings/in-memory-settings-store.js';
import { SETTINGS_STORE } from '../settings/settings-store.js';
import { CONTENT_STORE } from '../content-workflow/content-store.js';
import { InMemoryContentStore } from '../content-workflow/in-memory-content-store.js';

/** The whole server, driven over MCP the way an admin's agent would, with REST seeing the result. */
let app: INestApplication;
let base: string;
let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = (result.content[0] as { text: string }).text;
  if (result.isError) throw new Error(`${name} failed: ${text}`);
  return text === 'Done.' ? undefined : JSON.parse(text);
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SETTINGS_STORE)
    .useValue(new InMemorySettingsStore())
    .overrideProvider(CONTENT_STORE)
    .useValue(new InMemoryContentStore())
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0);
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  client = new Client({ name: 'admin-agent', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`)));
});

afterAll(async () => {
  await client.close();
  await app.close();
});

describe('admin panel over MCP', () => {
  it('offers every admin action as a tool, with the setting descriptions in the input schemas', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['get_server_info', 'get_settings', 'update_combat_settings', 'edit_world', 'check_world', 'list_rooms']));
    const combat = tools.find((t) => t.name === 'update_combat_settings')!;
    const changes = (combat.inputSchema.properties as Record<string, { properties: Record<string, { title?: string; description?: string }> }>).changes!;
    expect(changes.properties.answerTimeMs).toMatchObject({ title: 'Answer time', description: expect.stringContaining('after being hit') });
    expect(tools.find((t) => t.name === 'delete_world')?.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
  });

  it('builds a world, puts it in rooms, and the admin REST API sees the same state', async () => {
    const catalogue = await call('get_world_catalogue');
    expect(catalogue.themes.map((t: { id: string }) => t.id)).toContain('library');

    const created = await call('create_world', { id: 'reading-room', name: 'Reading room', start: { from: 'generate', theme: 'library', width: 60, depth: 50, seed: 3 } });
    expect(created).toMatchObject({ id: 'reading-room', version: 1, theme: 'library' });

    const world = await call('get_world', { id: 'reading-room' });
    const edited = await call('edit_world', {
      id: 'reading-room',
      expectedVersion: 1,
      edits: [
        { op: 'clear', what: 'props' },
        { op: 'add_ring', kind: 'bookshelf', count: 8, radius: 12, startDeg: 22.5 },
        { op: 'add_prop', kind: 'desk', x: 0, z: 0 },
      ],
    });
    expect(edited).toMatchObject({ version: 2, props: 9, spawnPoints: world.value.layout.spawnPoints.length });

    const checks = await call('check_world', { id: 'reading-room' });
    expect(checks.checks.some((c: { level: string }) => c.level === 'problem')).toBe(false);

    const settings = await call('get_settings');
    const rooms = await call('update_rooms_settings', { expectedVersion: settings.sections.rooms.version, changes: { worldId: 'reading-room' } });
    expect(rooms.value).toEqual({ ...settings.sections.rooms.value, worldId: 'reading-room' });

    const worlds = await call('list_worlds');
    expect(worlds.find((w: { id: string }) => w.id === 'reading-room')).toMatchObject({ inUse: true, version: 2 });
    expect(worlds.find((w: { id: string }) => w.id === DEFAULT_WORLD_ID)).toMatchObject({ inUse: false });

    const rest = AdminSettingsResponseSchema.parse(await (await fetch(`${base}/api/admin/settings`)).json());
    expect(rest.sections.rooms.value.worldId).toBe('reading-room');
    expect(rest.worlds.find((w) => w.value.id === 'reading-room')).toMatchObject({ version: 2 });
  });

  it('reports refusals as tool errors a model can act on', async () => {
    const result = (await client.callTool({ name: 'delete_world', arguments: { id: 'reading-room', expectedVersion: 2 } })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/rooms use/);
    expect(await call('list_rooms')).toEqual([]);
  });

  it('curates the question bank over MCP, and the admin REST API sees the same bank and the same refusals', async () => {
    const overview = await call('get_question_bank_overview');
    expect(overview.levels.map((l: { levelId: string }) => l.levelId).sort()).toEqual(['gb-gcse-year-11', 'in-cbse-class-10']);

    await call('create_country', { id: 'us', name: 'United States' });
    await call('create_curriculum', { id: 'us-ccss', countryId: 'us', name: 'Common Core', description: '' });
    await call('create_level', { id: 'us-ccss-grade-10', curriculumId: 'us-ccss', name: 'Grade 10', order: 10, ages: [15, 16], description: '' });
    await call('create_topic', { id: 'us-10-math-functions', levelId: 'us-ccss-grade-10', subjectId: 'mathematics', name: 'Functions', description: '' });
    await call('create_source', { id: 'house-bank', title: 'House question bank', publisher: 'Volleyland', url: null, year: 2026, licence: 'Original', notes: '' });
    const created = await call('create_question', {
      topicId: 'us-10-math-functions',
      difficulty: 2,
      status: 'published',
      prompt: 'If f(x) = 2x + 1, what is f(3)?',
      options: [
        { id: 'a', text: '6' },
        { id: 'b', text: '7' },
      ],
      correctOptionId: 'b',
      explanation: '2 × 3 + 1 = 7.',
      source: { sourceId: 'house-bank', use: 'aligned', reference: 'Functions, 1' },
    });

    const rest = await (await fetch(`${base}/api/admin/content/questions?levelId=us-ccss-grade-10`)).json();
    expect(rest).toMatchObject({ total: 1, questions: [{ version: 1, value: { id: created.value.id, correctOptionId: 'b' } }] });

    // The same bad input is refused the same way on both surfaces.
    const bad = { id: 'xx', name: 'X', extra: 1 };
    const tool = (await client.callTool({ name: 'create_country', arguments: bad })) as CallToolResult;
    expect(tool.isError).toBe(true);
    const response = await fetch(`${base}/api/admin/content/countries`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ record: bad }) });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toBe('Invalid input');
    // MCP checks the input schema itself before the operation runs, in its own words.
    expect((tool.content[0] as { text: string }).text).toMatch(/extra|unrecognized/i);

    // A rule refusal comes from the operation, word for word on both surfaces.
    const inUse = await fetch(`${base}/api/admin/content/levels/us-ccss-grade-10?expectedVersion=1`, { method: 'DELETE' });
    expect(inUse.status).toBe(400);
    const { message } = (await inUse.json()) as { message: string };
    expect(message).toMatch(/us-10-math-functions/);
    const mcpInUse = (await client.callTool({ name: 'delete_level', arguments: { id: 'us-ccss-grade-10', expectedVersion: 1 } })) as CallToolResult;
    expect(mcpInUse.isError).toBe(true);
    expect((mcpInUse.content[0] as { text: string }).text).toContain(message);

    const settings = await call('get_settings');
    const pool = await call('update_questions_settings', { expectedVersion: settings.sections.questions.version, changes: { levelIds: ['us-ccss-grade-10'] } });
    expect(pool.value.levelIds).toEqual(['us-ccss-grade-10']);
    expect(await call('preview_question_pool', { levelIds: ['us-ccss-grade-10'] })).toEqual({ questions: 1, issues: [] });
  });
});
