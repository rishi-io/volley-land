---
name: world-builder
description: Build, edit, review and put live Volleyland worlds (arenas) through the Volleyland admin MCP tools — create_world, edit_world, check_world, update_rooms_settings and friends. Use this whenever someone wants a new arena or map, wants to change an existing world (add cover, hills, paths, spawn points, resize it, re-theme it, make it fairer or less crowded), asks why a world plays badly, or wants rooms to play in a different world — even if they just say "make a beach level", "the park is too open", "add a hill in the middle" or "switch the dev room to the library". Prefer this over editing data/settings.json or game-core code by hand.
---

# World builder (over MCP)

Volleyland worlds are admin-managed data. The `volleyland` MCP server (`.mcp.json`, `http://localhost:3001/api/mcp`) exposes the same actions as the admin panel's world builder, running the same game-core code, so a world built here is exactly what the builder would make. Tools appear as `mcp__volleyland__<operation>`; this skill names them by operation.

## Before you start

- **The server must be running** (`yarn dev`, or a deployed server with `MCP_ACCESS=write`). If the tools are missing or fail to connect, say so and ask the user to start it or approve the MCP server. Don't fall back to editing `apps/server/data/settings.json`: the running server holds its own copy and would overwrite yours, and you'd skip validation.
- **Know what is live.** Saving a world that rooms play in, or changing `rooms.worldId`, starts a new match in every open room at once (players respawn and are told what changed). Building a new world doesn't touch rooms. Ask before changing what rooms play on a server people are using.

## Read the rules that shape a world

Call `get_world_catalogue` (themes, ground surfaces, prop kinds with shapes and sizes, limits) and `get_settings` once at the start. From the settings, work out:

- **Throw range** = `projectileSpeed × projectileLifetimeMs / 1000` (18 × 1.5 = 27 m by default). Two spawn points closer than this with nothing between them can throw at each other the moment they spawn.
- **Low or full cover.** Throws fly at `projectileHeight` (1.2 m) with radius `projectileRadius` (0.25 m). A prop lower than about `projectileHeight − projectileRadius` (≈ 0.95 m) is *low cover*: it blocks walking but throws fly over it. Use both kinds deliberately: full cover hides, low cover shapes paths.
- **Space per player.** Floor area ÷ `rooms.maxPlayers`: under about 40 m² each is crowded, over about 900 m² is so roomy players take ages to meet. For 4 players, 30–60 m a side is comfortable.
- **Climbable ground.** Players can't walk up slopes steeper than `maxSlopeDeg` (40°). A hill's steepest slope is roughly 1.5 × height ÷ the width of its sloping rim, so a 3 m hill needs a rim of 6 m or more.

Coordinates: the floor is centred on (0, 0), x runs across the width and z across the depth, in metres. Rotation is degrees counter-clockwise seen from above.

## Build a new world

1. **Pin down the brief**: theme, rough size (from the player count), how much cover, flat or hilly, and anything specific ("a pond in the middle", "two forts facing each other"). If the user gave a loose request, choose sensible values and say what you chose rather than asking a list of questions.
2. **Start from a generated layout** unless the user wants something hand-placed. Generated layouts are symmetric and already pass the checks, which is the hard part. Try a few seeds first with `create_world` and `dryRun: true`: `start: { from: "generate", theme, width, depth, density, symmetry, spawns, seed, relief }`. Each dry run reports validation issues, a summary and the play checks without saving. Pick the best seed and create it for real. Other starts: `blank` (an empty floor with four spawns), `copy` (another world's layout), or `layout` (a full layout you supply).
   - IDs are lowercase slugs (`harbour-docks`) and can't change later; the name and description can.
3. **Shape it with `edit_world`.** Send a batch of edits with the `expectedVersion` you last read; the batch saves once. Useful moves:
   - `add_prop` for features; `add_ring` for walls, hedges or columns round a centre; `add_region` to paint paths, rugs or water; `add_hill` (positive height) or a hollow (negative height); `set_terrain` for rolling ground; `set_floor` to resize or re-theme.
   - Build one side, then `mirror` those items (`mirror-x`, `mirror-z` or `quad`) so the world stays fair.
   - Items are `{ kind: "prop" | "region" | "spawn" | "hill", index }`, their position in the list **as the earlier edits in the same batch left it**. Adding appends to the end; removing shifts later indices down. Read the world (`get_world`) before index-based edits, and in one batch remove from the highest index down.
   - Use `dryRun: true` on a big batch to see the checks before saving.
4. **Check how it plays**: `check_world { id }`. Fix every `problem` (a spawn point walled off). Fix `warning`s unless the user wants that effect on purpose: spawn points in each other's line of fire (put full cover between them or move them apart), no full cover, too crowded or too roomy, too much ground too steep to climb. `info` lines are just facts.
5. **Report**: the world's ID and name, size, theme, how many props (full and low cover), terrain, and the final checks. Point the user to `http://localhost:3000/admin#worlds` to see it in the 3D preview.
6. **Put it in rooms only if asked**: `update_rooms_settings { expectedVersion: <rooms version from get_settings>, changes: { worldId } }`. Say that open rooms restart in it.

## Edit an existing world

`list_worlds` (summaries, with `inUse` for the one rooms play) → `get_world { id }` for the full layout and its version → `edit_world` batches → `check_world`. Use `update_world` only to rename, re-describe or replace the whole layout. If a write fails with a conflict, someone saved first: read the world again and redo your edits against the new version, not the old indices.

Removing a world: `delete_world` refuses the world rooms play in; switch rooms to another world first, and only when the user asked.

## When something is refused

Refusals come back as tool errors with a message and, for invalid input, issues by path (`props.12.height: …`). They are the same rules the panel enforces. Read them, fix the edit, and retry. Don't work around them. If a limit is in the way (`get_world_catalogue` lists them: up to 400 props, 64 regions, 16 spawn points, 64 hills, 200 m a side), tell the user.

## Example

"Make a snowy fort map for 6 players with a frozen pond in the middle."

1. `get_settings`: maxPlayers 4, so mention that rooms hold 4 unless they change Rooms. Range is 27 m. Size the world for 6 anyway: 6 × ~250 m² ≈ 40 × 40 m.
2. Try `create_world` dry runs with `{ from: "generate", theme: "snow", width: 40, depth: 40, density: 0.5, symmetry: "mirror-z", spawns: 6, seed: 1…4 }`, keep the seed whose checks are cleanest, then create `frost-keep`.
3. `edit_world`: `add_region` (ice ellipse at 0,0), then `add_ring` of walls round each team's spawn on one side, then `mirror` those walls with `mirror-z`.
4. `check_world`: if two spawns can see each other, add a wall between them or move one, then check again.
5. Report, and offer to switch rooms to `frost-keep`.
