# Worlds: layout, builder, generation and play checks

A world is a versioned record (`World` with a `WorldLayout`). The admin panel's world builder
edits it locally, then saves with REST. MCP clients edit it with `edit_world`, a list of the
builder's actions applied server-side (`apps/server/src/settings/world-edits.ts`).

## Where builder logic lives

| Concern | Shared code (game-core) | Web builder | Server (MCP) |
|---|---|---|---|
| Editing: move, rotate, duplicate, mirror, delete, update, reorder | `world-editing.ts` | `admin/world/editing.ts` re-exports | `world-edits.ts` calls it |
| New items and their defaults | `newProp`, `newHill`, `prop`, `ring` | tools in `WorldBuilder.tsx` | `add_*` edits (defaults read from the same functions) |
| Generation | `generate.ts` (`generateLayout`, `blankLayout`) | Generate panel | `create_world` `from: generate`, `edit_world` `generate` |
| Play checks | `world-checks.ts` (`checkWorld`, `playRulesOf`) | Checks panel | `check_world`, dry runs |
| Validation | contracts `WorldSchema` | before save | on save (`SettingsService.saveWorld`) |

If the builder gains behaviour, it goes into game-core first, and both sides call it.

## Add a field to the world layout (like `terrain` or `hills`)

1. **game-core.** Add it to `WorldLayout` (`world.ts`) and make collision, movement and navigation
   use it if it affects play (`arenaFromLayout`, `stepMovement`, `navigation.ts`).
2. **contracts.** Add it to `WorldLayoutSchema`, with its limits in `WORLD_LIMITS` (mirror the
   value in game-core `WORLD_LIMITS`; `world-catalogue.test.ts` keeps them equal). Make it
   optional if old worlds lack it, or migrate them.
3. **Stored data.** Bump the settings-file `format` and migrate in `parseSettingsFile` if existing
   worlds need a value. Update the built-in worlds if they should use it.
4. **Socket.** The layout goes to clients in `room.join` and `match.setup`: bump
   `PROTOCOL_VERSION` for a breaking change.
5. **Builder.** Tools, inspector fields and plan drawing in `apps/web/src/admin/world/`. Any new
   editing function goes in game-core `world-editing.ts`.
6. **MCP.** Give `edit_world` a way to change it: a new `WorldEditSchema` op (`add_x`, `set_x`)
   handled in `applyWorldEdits`, or a new `kind` in `ItemRefSchema` so `update`, `move`,
   `remove` and the rest reach it. Then add the field to `LAYOUT_EDITS` in
   `admin-parity.test.ts`. TypeScript refuses to compile the test until you do. If the generator
   should produce it, add the option to `GenerateOptions` and to `GenerateOptionsSchema`; the
   parity test checks the two key sets match.
7. **Words.** Describe each new edit op and field with `.describe()`. Say what it does to play
   ("hills hide players and stop throws"), because a model only has the description to go on.
   Update `get_world_catalogue` if there is a new catalogue (kinds, surfaces, limits).
8. **Summary.** If the field is large, keep `summarizeWorld` small (counts, not contents).

## Add a prop kind, theme or surface

Follow `CLAUDE.md` ("Adding a prop kind"): game-core catalogue, the contracts mirror, a model
recipe. MCP needs nothing more: `get_world_catalogue` and the enums in the edit schemas read the
same catalogues. Check the catalogue output describes the new kind sensibly.

## Add a builder action that is not a layout field

Examples: align, distribute, snap to grid. Put the function in game-core `world-editing.ts`, use
it in the builder, and add an `edit_world` op that calls it. If it only changes the selection or
view (box select, zoom), it is a UI helper: add its name to `SELECTION_HELPERS` in the parity test
with a comment saying why.

## Verify

Run the verification commands in `SKILL.md`. For a new edit op, add a case to
`world-edits.test.ts` that checks the result equals what the builder's function gives for the same
input.
