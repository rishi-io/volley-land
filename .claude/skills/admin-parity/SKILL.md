---
name: admin-parity
description: Keep the admin panel, the admin REST API and the MCP tools in parity whenever admin- or CMS-managed logic changes. Use for ANY change that touches admin-managed data or actions in Volleyland — a settings section or setting (GameConfig, BotConfig, appearance, camera, rooms), the world builder or world layout (props, regions, spawn points, terrain, hills, generation, play checks), the admin panel UI (apps/web/src/admin), AdminController or /api/admin, operations (apps/server/src/operations, *.operations.ts), the MCP server or its tools, SettingsService or the settings store, and future CMS content (question bank authoring, curriculum, review and publishing). Also use when someone asks to "add a setting", "add an admin action", "expose X in the admin panel", "add an MCP tool" or "change the world format".
---

# Admin parity

Every admin action exists **once**, as an operation, and three surfaces reach it:

```
admin panel (apps/web/src/admin) ──> REST /api/admin (AdminController) ──┐
                                                                         ├─> OperationRunner ─> operation ─> SettingsService / game-core / RoomRegistry
MCP client ──────────────────────────> MCP /api/mcp (McpToolCatalog) ─────┘
```

Parity means anything the panel can do, an MCP client can do too, with the same rules, the same
words and the same results. Nobody should be able to tell which surface a change came from,
except from the `via=` in the audit log.

## The rules

1. **One operation per admin action.** Write it in a domain `@Operations()` provider
   (`settings/settings.operations.ts`, `match-simulation/rooms.operations.ts`, later
   `content-workflow/content.operations.ts`). REST routes and MCP tools only run operations through
   `OperationRunner`. Never put validation, rules or error decisions in `AdminController`, the
   MCP server or the web panel.
2. **One copy of every rule.** Validation lives in the contracts schemas and `SettingsService`.
   Builder behaviour (editing, generation, play checks, new-item defaults) lives in
   `packages/game-core` and is called by both the web builder and the server. If the panel does
   something with a local function, that function belongs in game-core. The server's
   `edit_world` must call the same one.
3. **One copy of every word.** Setting titles, help and units are `.meta(field(...))` on the
   contracts field schemas. Section titles and summaries are `SECTION_TEXT`. The panel's
   `catalog.ts` holds only layout (input kind, step, group, choices). MCP tool schemas get the
   same words from JSON Schema.
4. **Same concurrency and outcomes.** Writes take `expectedVersion` and fail with `conflict`
   when stale. Refusals are `OperationError` (`invalid`, `conflict`, `not_found`, `forbidden`,
   `unavailable`). REST maps them to `AdminError` and MCP returns them as `isError` text. Saved
   changes reach open rooms the same way whoever saved them.
5. **Names are API.** Operation names are snake_case and pinned by a snapshot test. MCP clients
   and saved prompts call them, so rename or remove one only on purpose.
6. **Answer keys never leave the server**, on any surface. No operation returns
   `BankQuestion.correctOptionId`, `explanation` or live encounter state. CMS authoring
   operations that must see answers are write-access operations, never read tools.

## What to do

Find the change below and follow its checklist in the reference file. Every checklist ends with
the same verification step.

| You are… | Read |
|---|---|
| Adding or changing a setting, or adding a settings section | [references/settings.md](references/settings.md) |
| Changing the world layout, the world builder, generation or play checks | [references/worlds.md](references/worlds.md) |
| Adding an admin action, a new admin-managed entity, or CMS content | [references/actions-and-cms.md](references/actions-and-cms.md) |

When a change only touches the panel UI (layout, styling, interaction) and no data or rule, check
it adds no logic: if it computes or validates something an MCP client would also need, move that
code to game-core or an operation first.

## Verify (every time)

```bash
yarn workspace @volleyland/server vitest run src/settings/admin-parity.test.ts src/settings/settings.operations.test.ts src/mcp-server
yarn typecheck && yarn lint && yarn test
```

`admin-parity.test.ts` fails when:
- a world layout field has no `edit_world` operation (`LAYOUT_EDITS`; a compile error for a new field);
- the generator options MCP clients may pass differ from game-core's `GenerateOptions`;
- a game-core editing function the builder uses is not used by `edit_world`;
- `AdminController` calls the settings service directly;
- the panel calls a REST route that does not exist.

The operation-name snapshot (`settings.operations.test.ts`) fails when an operation appears or
disappears. Update it deliberately and say so in the change. For a wider review, or a periodic
check that nothing has drifted, run the `admin-parity-audit` skill.

Finish by telling the user which surfaces the change reaches (panel, REST, MCP) and any it
deliberately does not, with the reason.
