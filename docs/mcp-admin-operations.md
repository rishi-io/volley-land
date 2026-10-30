# The admin panel over MCP, through shared operations

Status: **implemented.** Everything the admin panel does is also an MCP tool on the game server.
The REST endpoints the panel calls and the MCP tools run the same code. This document records the
design and the decisions behind it. `CLAUDE.md` ("Operations and MCP") has the working rules.

## Goal

An MCP client (Claude Code, Claude Desktop, a claude.ai connector) can do anything the admin panel
can: read and change every settings section, and build, edit, check and delete worlds. It can also
see live rooms. Neither transport holds admin logic, validation or error decisions of its own.

## Shape

```
AdminController (REST /api/admin) ─┐                         ┌─ SettingsService ─ SettingsStore
                                   ├─ OperationRunner ─ op ──┤
McpServerController (/api/mcp) ────┘   access · parse ·      ├─ game-core: world editing, checks, generation
  McpAccessGuard → McpToolCatalog      timeout · audit       └─ RoomRegistry (read-only view)
```

| Piece | Where | Job |
|---|---|---|
| `Operation`, `defineOperation`, `OperationError`, `Actor`, `@Operations()` | `apps/server/src/operations/operation.ts` | The shared unit. An operation has a snake_case name, a description written for a model, a zod input schema, read/write access, an optional `destructive` flag, and `run(input, actor)`. |
| `OperationRunner` | `operations/operation-runner.service.ts` | The only way into an operation. Refuses writes to read-only actors, validates the input with the full schema, applies a 15 s timeout, audits (`op.call op=… via=rest\|mcp outcome=…`), and normalises errors. |
| `OperationCatalog` | `operations/operation-catalog.service.ts` | Discovers `@Operations()` providers in any module. Fails startup on bad or duplicate names. |
| `OperationErrorFilter` | `operations/operation-error.filter.ts` | REST: `OperationError` → `AdminError` body with 400/403/404/409/503. |
| Settings and world operations | `settings/settings.operations.ts`, `settings/world-edits.ts` | Every admin panel action. |
| Room operations | `match-simulation/rooms.operations.ts` | `list_rooms`. |
| MCP transport | `mcp-server/` | Stateless Streamable HTTP. Admission guard (`MCP_ACCESS`, Host/Origin checks, rate limit). Each operation becomes a tool, plus `get_server_info`. |

## The operations

| Operation | Access | Admin panel | REST route |
|---|---|---|---|
| `get_settings` | read | settings screens | `GET /settings` (with `list_worlds` detail `full`) |
| `update_<section>_settings` × 7 | write | Save on a section | `PUT /settings/:section` |
| `reset_settings_section` | write | "Use defaults" | (panel does it as a draft) |
| `list_worlds` | read | world tabs | inside `GET /settings` |
| `get_world` | read | open a world, export JSON | — |
| `get_world_catalogue` | read | palette (themes, surfaces, prop kinds, limits) | — |
| `check_world` | read | play checks panel | — |
| `create_world` | write | New world, Generate, Duplicate, Import JSON | `POST /worlds` (`start.from = layout`) |
| `update_world` | write | Save (name, description, layout) | `PUT /worlds/:id` |
| `edit_world` | write | the plan's tools: place, move, rotate, duplicate, mirror, delete, inspector edits, patch order, floor settings, Generate | — (the panel edits locally, then saves with `PUT`) |
| `delete_world` | write, destructive | Delete | `DELETE /worlds/:id` |
| `list_rooms` | read | — (new) | — |

"Use for room" in the builder is `update_rooms_settings` with `worldId`. Undo and redo stay in the
panel. Over MCP, `dryRun` gives a preview and `expectedVersion` protects against lost updates.

## Decisions

- **One update operation per settings section,** generated from `SECTION_SCHEMAS`, rather than one
  generic tool whose value would be an untyped blob to a model. Input is
  `{ expectedVersion, changes }`. `changes` holds only the settings to change and is merged over the
  current values, then the whole section is validated. REST sends the full section as `changes`,
  which merges to the same thing, so `PUT` keeps its meaning.
- **The words live in contracts.** Each field schema carries `.meta({ title, description, unit })`,
  each section has `SECTION_TEXT`, and JSON Schema (so the MCP tool schema) includes them. The web
  catalog keeps only form layout (input kind, step, group) and reads its labels and help from
  contracts.
- **World builder logic moved to game-core.** Editing (`world-editing.ts`), play checks
  (`world-checks.ts`, `playRulesOf`) and `blankLayout` sit next to the generator and are used by
  both the web builder and the server. `edit_world` takes the builder's actions as data
  (`WorldEditSchema`): `add_prop`, `add_ring`, `add_region`, `add_spawn`, `update`, `move`,
  `rotate`, `remove`, `duplicate`, `mirror`, `reorder_region`, `set_floor`, `clear` and `generate`.
  Edits apply in order. Item indices refer to the lists as the earlier edits left them. A bad
  reference rejects the whole batch, naming the edit.
- **Results sized for models.** `summarize` on an operation is what MCP shows: world writes return a
  summary (id, version, counts) rather than every prop, while REST gets the full record.
  `check_world` returns the checks and the unreachable area, not the cell list.
- **Every failure is a tool result.** Refusals and timeouts come back as `isError` text a model can
  act on, and bugs as a generic message with the request ID. The SDK validates arguments against
  the advertised schema first; the runner validates again (defence in depth, and for REST).
- **Auth is out of scope.** The actor's principal is the `ADMIN_TOKEN` holder or an anonymous
  address on REST, and an anonymous address on MCP. `MCP_ACCESS` defaults to `write` in
  development and `off` in production (Compose too). The holistic auth layer will set a real
  principal and access on the actor for both transports; operations will not change.

## Security

- No operation returns `BankQuestion` answer fields or encounter state. `list_rooms` reports
  codes, match and world IDs, tick and seat counts only.
- The audit log never holds operation inputs or outputs.
- Host and Origin checks guard the unauthenticated MCP endpoint against DNS rebinding in
  development.

## Testing

- `operations/operation-runner.test.ts`: access, validation (refinements included), refusals,
  `ZodError` inside `run`, timeout, bug logging.
- `settings/settings.operations.test.ts`: every operation through the runner with
  `InMemorySettingsStore`, read actors refused every write, the operation-name snapshot, and
  `list_rooms` on a live `RoomRegistry`.
- `settings/world-edits.test.ts`: each edit, ordering and batch rejection.
- `settings/admin.controller.test.ts`: unchanged, which proves the REST routes and shapes held.
- `mcp-server/mcp-server.test.ts`: transport, guard, annotations and error mapping with probe
  operations.
- `mcp-server/mcp-admin.e2e.test.ts`: the whole `AppModule` driven over MCP. It builds a world,
  puts it in rooms, and checks the REST API sees the same state.

## Open questions

- A `patch`-style world update for models that want to change one field of a prop without an
  edit list (today: `edit_world` with `update`).
- Structured output (`outputSchema` + `structuredContent`) once operations declare output schemas.
- Body size: Nest's default 100 kB JSON limit caps `update_world` and `create_world` with a given
  layout (a 400-prop world is roughly 50 kB today).
