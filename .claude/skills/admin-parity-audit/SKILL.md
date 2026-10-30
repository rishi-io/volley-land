---
name: admin-parity-audit
description: Audit Volleyland's admin surfaces for drift between the admin panel, the admin REST API and the MCP tools. It inventories settings sections, operations, REST routes, panel API calls and world-builder tools against edit_world, runs the parity tests, reviews what scripts cannot see, and reports gaps with fixes. Use when asked to "check admin parity", "audit the admin panel against MCP", "is everything in the admin panel available over MCP", before releasing admin or CMS changes, or after a large admin, world-builder or CMS change landed.
---

# Admin parity audit

Checks that anything the admin panel can do, an MCP client can do too, through the same operation
and with the same rules (see the `admin-parity` skill for the rules themselves). Read-only: it
reports gaps and proposes fixes, and changes nothing unless the user asks.

## 1. Inventory and tests

From the repo root:

```bash
node .claude/skills/admin-parity-audit/scripts/inventory.mjs
yarn workspace @volleyland/server vitest run src/settings/admin-parity.test.ts src/settings/settings.operations.test.ts src/mcp-server
```

The script prints:
- each section's words and panel layout;
- every operation (MCP tool) with its access;
- each REST route and the operation it runs;
- each panel API call and whether a route serves it;
- the builder's placing tools against `edit_world`'s ops and item kinds;
- builder functions that take a layout but live in the web app.

It ends with **suspected gaps** and exits 1 if there are any. The tests enforce the parts that can
be enforced (see `admin-parity`, "Verify").

## 2. Review what scripts cannot see

Read these, guided by the inventory. Each question names where to look.

1. **Panel features without an operation.** List what an admin can do in `apps/web/src/admin`:
   the buttons and handlers in `AdminApp.tsx`, `SectionEditor.tsx`, `world/WorldBuilder.tsx`,
   `world/Inspector.tsx` and `world/Palette.tsx`. Classify each one:
   - it saves → it must reach an operation via REST;
   - it edits a world draft → it needs an `edit_world` op (or `create_world` / `update_world`);
   - it is presentation (undo, view, zoom, selection, preview) → no operation needed, but say so.
2. **Logic living in the web app.** For each function from the "Builder functions that take a
   layout but live in the web app" list, and anything in `apps/web/src/admin/**` that computes
   world geometry, play rules, defaults or validation: does an MCP client need the same result?
   If yes, it belongs in game-core and `edit_world` or `check_world` should use it.
3. **Defaults and words.** New-item defaults on the server (`world-edits.ts` `.default(...)`)
   should come from game-core (`newProp`, `newHill`, `prop`), not from literals. Setting words
   should come only from contracts `.meta()`. Search `catalog.ts` and `admin/world/*.tsx` for
   label or help strings that describe settings or world fields an MCP client also sees.
4. **Descriptions.** Read each operation's description and each `WorldEditSchema` op's
   `.describe()`. Could a model use it correctly without seeing the panel? It should say the
   effect on live play (restart or redraw), concurrency (`expectedVersion`) and limits.
5. **Answer keys.** No operation's output contains `correctOptionId`, `explanation` or encounter
   state (`grep -n "correctOptionId\|explanation\|answerKeyFor" apps/server/src/**/*.operations.ts`
   should find nothing outside CMS authoring operations).
6. **Exposure.** `MCP_ACCESS` is `off` in `deploy/compose.yaml`, and README and `deploy/README.md`
   list every `MCP_*` variable the server reads (`mcp-server/mcp-config.ts`).

## 3. Report

Give the user a short table of the gaps found, most serious first:

| Gap | Surface missing | Where | Fix |
|---|---|---|---|

Then say what is in parity, in one line per area (settings, worlds, rooms, CMS). If there are no
gaps, say so plainly and name what was checked. Offer to fix the gaps, following the
`admin-parity` checklists.
