#!/usr/bin/env node
// Inventory of the admin surfaces, for the admin-parity-audit skill. Reads source only (no build,
// no server): settings sections, operations, REST routes, panel API calls and world-builder edits,
// with what each maps to. Prints Markdown, and lists suspected gaps at the end.
// Run from the repo root: node .claude/skills/admin-parity-audit/scripts/inventory.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const walk = (dir) =>
  readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    return statSync(path.join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
const gaps = [];
const list = (items) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- (none)');

// Settings sections, their words and their panel layout.
const settings = read('packages/contracts/src/settings.ts');
const sections = JSON.parse(settings.match(/SettingsSection = z\.enum\((\[[^\]]+\])\)/)[1].replace(/'/g, '"'));
const textBlock = settings.slice(settings.indexOf('SECTION_TEXT'));
const catalog = read('apps/web/src/admin/catalog.ts');
console.log('## Settings sections\n');
for (const s of sections) {
  const words = new RegExp(`\\b${s}: \\{`).test(textBlock);
  const layout = new RegExp(`id: '${s}'`).test(catalog);
  console.log(`- ${s}: SECTION_TEXT ${words ? 'yes' : 'NO'}, panel layout ${layout ? 'yes' : 'NO'}, MCP update_${s}_settings`);
  if (!words) gaps.push(`Section ${s} has no SECTION_TEXT`);
  if (!layout) gaps.push(`Section ${s} has no layout in apps/web/src/admin/catalog.ts (not editable in the panel)`);
}

// Operations (each is an MCP tool) by provider.
console.log('\n## Operations (MCP tools)\n');
const opFiles = walk('apps/server/src').filter((f) => f.endsWith('.operations.ts'));
const opNames = new Set(sections.map((s) => `update_${s}_settings`));
for (const file of opFiles) {
  const src = read(file);
  const ops = [...src.matchAll(/name: '([a-z_]+)',[\s\S]*?access: '(read|write)'(,\s*destructive: true)?/g)].map(([, name, access, destructive]) => {
    opNames.add(name);
    return `${name} (${access}${destructive ? ', destructive' : ''})`;
  });
  console.log(`${file}\n${list(ops)}\n`);
}
console.log(`Generated per section: ${sections.map((s) => `update_${s}_settings`).join(', ')}\n`);

// REST routes and the operation each runs.
console.log('## Admin REST routes (AdminController)\n');
const controller = read('apps/server/src/settings/admin.controller.ts');
const routeBlocks = controller.split(/(?=\n  @(?:Get|Put|Post|Delete)\()/).slice(1);
const routes = new Set();
for (const block of routeBlocks) {
  const [, method, route] = block.match(/@(Get|Put|Post|Delete)\('([^']*)'\)/);
  const runs = [...block.matchAll(/this\.ops\.(\w+)/g)].map((m) => m[1]);
  const key = `${method.toUpperCase()} /${route.replace(/:\w+/g, ':param')}`;
  routes.add(key);
  console.log(`- ${key} → ${runs.length ? runs.join(' + ') : 'NO OPERATION'}`);
  if (!runs.length) gaps.push(`${key} runs no operation`);
}

// Panel API calls and whether a route serves them.
console.log('\n## Admin panel API calls (apps/web/src/admin/api.ts)\n');
const api = read('apps/web/src/admin/api.ts');
for (const [, name, route, method] of api.matchAll(/(\w+): [^=]*=>\s*\n?\s*request\(\s*[`'"]([^`'"?]+)[^]*?method:\s*'(\w+)'/g)) {
  const key = `${method} ${route.replace(/\$\{[^}]+\}/g, ':param')}`;
  const ok = routes.has(key);
  console.log(`- ${name}: ${key} ${ok ? '' : '← NO ROUTE'}`);
  if (!ok) gaps.push(`Panel call ${name} (${key}) has no AdminController route`);
}

// World builder: panel tools vs edit_world operations.
console.log('\n## World builder\n');
const plan = read('apps/web/src/admin/world/PlanView.tsx');
const tools = [...(plan.match(/export type Tool =(.+)$/m)?.[1] ?? '').matchAll(/kind: '(\w+)'/g)].map((m) => m[1]);
const edits = read('apps/server/src/settings/world-edits.ts');
const editOps = [...edits.matchAll(/op: z\.literal\('(\w+)'\)/g)].map((m) => m[1]);
const itemKinds = JSON.parse((edits.match(/kind: z\.enum\((\[[^\]]+\])\)/)?.[1] ?? '[]').replace(/'/g, '"'));
console.log(`Panel placing tools: ${tools.join(', ')}`);
console.log(`edit_world ops: ${editOps.join(', ')}`);
console.log(`edit_world item kinds (update/move/remove/…): ${itemKinds.join(', ')}`);
for (const tool of tools) {
  if (!editOps.includes(`add_${tool}`)) gaps.push(`Builder tool "${tool}" has no edit_world add_${tool} op`);
  if (!itemKinds.includes(tool)) gaps.push(`Builder tool "${tool}" places items edit_world cannot address (ItemRefSchema kind)`);
}
const editing = read('packages/game-core/src/world-editing.ts');
const shared = [...editing.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]);
console.log(`game-core world-editing exports: ${shared.join(', ')}`);
const builderFiles = walk('apps/web/src/admin/world').filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts'));
const localFns = builderFiles.flatMap((f) => [...read(f).matchAll(/^(?:export )?function (\w+)\(\s*(?:layout|from|l)\b/gm)].map((m) => `${path.basename(f)}: ${m[1]}`));
console.log(`\nBuilder functions that take a layout but live in the web app (should they be in game-core?):\n${list(localFns)}`);

console.log('\n## Suspected gaps\n');
console.log(list(gaps));
console.log('\nAlso run: yarn workspace @volleyland/server vitest run src/settings/admin-parity.test.ts src/settings/settings.operations.test.ts src/mcp-server');
process.exitCode = gaps.length ? 1 : 0;
