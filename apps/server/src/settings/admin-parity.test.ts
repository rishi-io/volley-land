import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { WorldLayoutDto } from '@volleyland/contracts';
import type { GenerateOptions } from '@volleyland/game-core';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { type GenerateOptionsSchema, type WorldEdit, WorldEditSchema } from './world-edits.js';

/*
 * Parity between the admin panel, the admin REST API and the MCP tools (see the admin-parity
 * skill in .claude/skills). The rest of the parity rules are enforced where they live: the
 * operation-name snapshot (settings.operations.test.ts), setting words (contracts.test.ts,
 * catalog.test.ts) and the contracts/game-core catalogue mirror (world-catalogue.test.ts).
 */

const repo = path.resolve(import.meta.dirname, '../../../..');
const source = (file: string) => readFileSync(path.join(repo, file), 'utf8');

/**
 * How an MCP client changes each part of a world layout with edit_world. A new layout field does
 * not compile until it is listed here, and it must name edit operations that exist.
 */
const LAYOUT_EDITS = {
  halfWidth: ['set_floor', 'generate'],
  halfDepth: ['set_floor', 'generate'],
  theme: ['set_floor', 'generate'],
  floor: ['set_floor', 'generate'],
  scatter: ['set_floor'],
  regions: ['add_region', 'update', 'move', 'rotate', 'remove', 'duplicate', 'mirror', 'reorder_region', 'clear'],
  props: ['add_prop', 'add_ring', 'update', 'move', 'rotate', 'remove', 'duplicate', 'mirror', 'clear'],
  spawnPoints: ['add_spawn', 'update', 'move', 'remove', 'duplicate', 'mirror'],
  terrain: ['set_terrain', 'generate'],
  hills: ['add_hill', 'update', 'move', 'rotate', 'remove', 'duplicate', 'mirror', 'clear'],
} as const satisfies Record<keyof WorldLayoutDto, readonly WorldEdit['op'][]>;

/** Compile-time: the generator options MCP clients may pass are exactly the ones game-core takes. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const generateOptionsMatch: Same<keyof z.input<typeof GenerateOptionsSchema>, keyof GenerateOptions> = true;

/** game-core world-editing exports that only serve the builder's selection, not editing. */
const SELECTION_HELPERS = new Set(['positionOf', 'itemsIn', 'snapTo']);

/** Every controller under /api/admin: settings and worlds, and the question bank CMS. */
const ADMIN_CONTROLLERS = ['apps/server/src/settings/admin.controller.ts', 'apps/server/src/content-workflow/content-admin.controller.ts'];

const normalizeRoute = (route: string) => route.replace(/\$\{[^}]+\}|:\w+/g, ':param').replace(/\/+$/, '');

describe('admin parity', () => {
  it('lets edit_world change every part of a world layout', () => {
    const ops = new Set(WorldEditSchema.options.map((o) => o.shape.op.value));
    for (const [field, edits] of Object.entries(LAYOUT_EDITS)) {
      for (const op of edits) expect(ops.has(op), `${field}: ${op}`).toBe(true);
    }
    expect(generateOptionsMatch).toBe(true);
  });

  it("runs the builder's own game-core editing functions on the server", () => {
    const editing = source('packages/game-core/src/world-editing.ts');
    const server = source('apps/server/src/settings/world-edits.ts');
    const exported = [...editing.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]!);
    expect(exported.length).toBeGreaterThan(5);
    const unused = exported.filter((name) => !SELECTION_HELPERS.has(name) && !new RegExp(`\\b${name}\\b`).test(server));
    expect(unused, 'world-editing functions the builder has but edit_world does not use').toEqual([]);
  });

  it('keeps admin REST routes thin: every route runs an operation, none calls a domain service', () => {
    for (const file of ADMIN_CONTROLLERS) {
      const controller = source(file);
      expect(controller, file).not.toMatch(/settings\.service|content\.service/);
      const routes = controller.match(/@(Get|Put|Post|Delete)\(/g) ?? [];
      const runs = controller.match(/this\.runner\.run\(/g) ?? [];
      expect(runs.length, file).toBeGreaterThanOrEqual(routes.length);
    }
  });

  it('serves every admin API call the panel makes', () => {
    const controller = ADMIN_CONTROLLERS.map(source).join('\n');
    const served = new Set(
      [...controller.matchAll(/@(Get|Put|Post|Delete)\('([^']*)'\)/g)].map(([, method, route]) => `${method!.toUpperCase()} /${normalizeRoute(route!)}`),
    );
    const panel = source('apps/web/src/admin/api.ts');
    const calls = [...panel.matchAll(/request\(\s*[`'"]([^`'"?]+)[^]*?method:\s*'(\w+)'/g)].map(([, route, method]) => `${method} ${normalizeRoute(route!)}`);
    expect(calls.length).toBeGreaterThan(3);
    for (const call of calls) expect(served.has(call), `${call} has no AdminController route`).toBe(true);
  });
});
