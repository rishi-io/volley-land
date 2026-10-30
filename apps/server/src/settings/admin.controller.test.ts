import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type AdminSettingsResponse, AdminSettingsResponseSchema } from '@volleyland/contracts';
import { BUILTIN_WORLDS, DEFAULT_WORLD_ID, PROTOTYPE_WORLD } from '@volleyland/game-core';
import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_AUTH, type AdminAuth } from '../config/server-config.js';
import { ServerConfigModule } from '../config/server-config.module.js';
import { InMemorySettingsStore } from './in-memory-settings-store.js';
import { SETTINGS_STORE } from './settings-store.js';
import { SettingsModule } from './settings.module.js';
import { CONTENT_STORE } from '../content-workflow/content-store.js';
import { InMemoryContentStore } from '../content-workflow/in-memory-content-store.js';

const TOKEN = 'test-admin-token-123';
let app: INestApplication | null = null;

async function start(auth: AdminAuth): Promise<string> {
  const moduleRef = await Test.createTestingModule({ imports: [ServerConfigModule, SettingsModule] })
    .overrideProvider(SETTINGS_STORE)
    .useValue(new InMemorySettingsStore())
    .overrideProvider(CONTENT_STORE)
    .useValue(new InMemoryContentStore())
    .overrideProvider(ADMIN_AUTH)
    .useValue(auth)
    .compile();
  app = moduleRef.createNestApplication();
  await app.listen(0);
  return `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/admin`;
}

afterEach(async () => {
  await app?.close();
  app = null;
});

const call = (url: string, init: RequestInit = {}, token: string | null = TOKEN) =>
  fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });

describe('Admin API', () => {
  it('requires the admin token when one is configured, and is disabled without one in production', async () => {
    const api = await start({ token: TOKEN, openWithoutToken: false });
    expect((await call(`${api}/settings`, {}, null)).status).toBe(401);
    expect((await call(`${api}/settings`, {}, 'wrong-token-wrong-token')).status).toBe(401);
    expect((await call(`${api}/settings`)).status).toBe(200);
    await app!.close();

    const closed = await start({ token: null, openWithoutToken: false });
    expect((await call(`${closed}/settings`, {}, null)).status).toBe(403);
  });

  it('serves the settings in the contract shape and saves a section', async () => {
    const api = await start({ token: TOKEN, openWithoutToken: false });
    const view: AdminSettingsResponse = AdminSettingsResponseSchema.parse(await (await call(`${api}/settings`)).json());
    expect(view.worlds.map((w) => w.value.id).sort()).toEqual(BUILTIN_WORLDS.map((w) => w.id).sort());

    const body = { value: { ...view.sections.rooms.value, maxPlayers: 6 }, expectedVersion: 1 };
    const saved = await call(`${api}/settings/rooms`, { method: 'PUT', body: JSON.stringify(body) });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ version: 2, value: { maxPlayers: 6 } });

    const stale = await call(`${api}/settings/rooms`, { method: 'PUT', body: JSON.stringify(body) });
    expect(stale.status).toBe(409);
    const invalid = await call(`${api}/settings/rooms`, { method: 'PUT', body: JSON.stringify({ value: { maxPlayers: 99 }, expectedVersion: 2 }) });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: 'invalid' });
    expect((await call(`${api}/settings/nope`, { method: 'PUT', body: JSON.stringify(body) })).status).toBe(400);
  });

  it('creates, updates and deletes a world', async () => {
    const api = await start({ token: null, openWithoutToken: true });
    const world = { ...PROTOTYPE_WORLD, id: 'copy', name: 'Copy' };
    const created = await call(`${api}/worlds`, { method: 'POST', body: JSON.stringify({ world, expectedVersion: null }) });
    expect(created.status).toBe(201);

    const renamed = await call(`${api}/worlds/copy`, { method: 'PUT', body: JSON.stringify({ world: { ...world, name: 'Copy 2' }, expectedVersion: 1 }) });
    expect(await renamed.json()).toMatchObject({ version: 2, value: { name: 'Copy 2' } });
    const moved = await call(`${api}/worlds/copy`, { method: 'PUT', body: JSON.stringify({ world: { ...world, id: 'other' }, expectedVersion: 2 }) });
    expect(moved.status).toBe(400);

    expect((await call(`${api}/worlds/${DEFAULT_WORLD_ID}?expectedVersion=1`, { method: 'DELETE' })).status).toBe(400); // in use
    expect((await call(`${api}/worlds/copy?expectedVersion=2`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`${api}/worlds/copy?expectedVersion=2`, { method: 'DELETE' })).status).toBe(404);
  });
});
