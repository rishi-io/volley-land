# Volleyland

**Answer to survive.** Volleyland is a multiplayer learning arena: players run around themed 3D worlds and shoot at each other with a ball, a blaster, a scatter gun or a rail gun. A hit from any of them freezes the target until they answer a multiple-choice question from a real course (CBSE Class 10 and GCSE Year 11 to start). A wrong answer or a timeout costs health; a correct one grants a short shield.

The game server is authoritative. It decides movement, hits, which question appears, whether the answer is right, and the damage. Clients only predict and draw.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Technical prototype: two-player, server-decided question-hit loop | ✅ Built (VPS deploy and school-laptop FPS measurement pending) |
| 1 | Single-player vertical slice: Supabase Auth, PostgreSQL question bank, Practice Arena vs bots, mistake review | Planned |
| 2 | Private multiplayer MVP: room codes, 2–4 players, reconnection, XP ledger, moderation | Planned |
| 3 | CMS and curriculum: taxonomy, author → review → publish, imports, quality flags | 🟡 First slice built: taxonomy, sources, question editing and imports (review workflow and quality flags pending) |
| 4 | Classroom operations: classes, assignments, accommodations, reports | Planned |

## Stack

- **Monorepo:** Yarn 4 workspaces + Turborepo, TypeScript throughout
- **Web** (`apps/web`): Next.js 16, React 19, React Three Fiber + drei, Koota (ECS), Zustand
- **Server** (`apps/server`): NestJS 12, Socket.IO
- **Shared** (`packages/`): `game-core` (collision, movement, rules), `contracts` (Zod wire schemas)
- **Tests:** Vitest; **CI:** GitHub Actions; **Deploy:** Docker Compose + Caddy on one VPS

## Getting started

Requires Node 24+ and Corepack (bundled with supported Node releases). No local environment
file is needed to run the game or admin panel in development.

```bash
corepack enable          # once, provides Yarn 4
yarn install --immutable
yarn dev                 # server on :3001, web on :3000
```

Open <http://localhost:3000/play>. You join the dev room `DEV`, and a bot fills the empty seat.
Open a second window to play another human; that player takes the bot's seat. The landing page is
at <http://localhost:3000>.

Open <http://localhost:3000/admin> to:

- change the game rules, weapons, rooms, bots, character look and camera;
- build worlds: eight themed built-in worlds to start from (Maple Park, Schoolyard, Shipwreck Cove, Frost Fort, Grand Library, Orbital Station, Rolling Hills and Kidwells Park), a prop palette, terrain and hills, a layout generator, play checks and a 3D preview;
- manage the question bank: countries, curricula, levels, subjects, topics, sources and questions, plus which questions a room or a world asks.

In development the admin panel needs no token. Saved changes apply at once: a change to the rules, world, rooms or bots starts a new match with the same players, and players see what changed. Settings and worlds are kept in `apps/server/data/settings.json` and the question bank in `apps/server/data/questions.json`; delete either file to go back to its defaults.

A player is not asked the same question twice while they stay in a room. Each world can ask from its own pool (Frost Fort asks GCSE chemistry and physics, Maple Park asks CBSE), and worlds without one use the room-wide pool.

| Control | Action |
| --- | --- |
| WASD / arrow keys | Move |
| Mouse | Aim (third person), or look around (first person, after a click locks the pointer) |
| Click / Space | Fire the weapon in hand (hold for the blaster) |
| 1–4 | Pick a weapon: ball, blaster, scatter, rail. While a question is open, answer it |
| Q | Next weapon |
| V | Switch between third and first person (if the admin allows it) |
| Mouse wheel / + − | Zoom the camera out or in (third person) |
| M | Show or hide the minimap |
| F3 | Performance metrics (FPS, input round trip, interpolation error, snapshot size) |

## Scripts

| Command | What it does |
| --- | --- |
| `yarn dev` | Run server and web in watch mode |
| `yarn dev:server` | Run only the game server in watch mode |
| `yarn dev:web` | Run only the web app in watch mode |
| `yarn lint` | ESLint across the repo |
| `yarn typecheck` | `tsc --noEmit` in every workspace |
| `yarn test` | Vitest in every workspace |
| `yarn build` | Build packages, server and web (Next.js standalone) |
| `yarn audio:generate` | Generate the game's sounds, music and bot voices with ElevenLabs into `apps/web/public/audio` (needs `ELEVENLABS_API_KEY` in a root `.env.local`, see `.env.example`) |
| `yarn audio:samples` | Download Voice Library previews to audition voices (`scripts/audio/previews/library`) |

Run one workspace's tests with `yarn turbo run test --filter=@volleyland/server`, or one file with `yarn workspace @volleyland/server vitest run <path>`.

Run `yarn build` before creating a deployable build. It does not start a production server; the
Docker Compose setup in [`deploy/`](deploy/README.md) is the supported production path.

## Repository layout

```
apps/
  server/     NestJS game server: game-gateway, match-simulation, question-selection, content-workflow
              (the question bank), settings (admin API), operations (shared admin actions) and
              mcp-server (the admin panel over MCP)
  web/        Next.js app: the game client (src/game-client, /play), the admin panel (src/admin, /admin)
              and the blog (/blog, posts in content/blog)
packages/
  game-core/  Shared deterministic movement, collision, RNG and game rules
  contracts/  Zod schemas for every socket message (no answer keys, ever)
scripts/      Offline sound generation (audio recipes and the ElevenLabs scripts)
deploy/       Compose, Caddyfile and the deploy/measurement guide
```

## Configuration

For local development, provide server variables in the shell that starts `yarn dev` (for example,
in PowerShell: `$env:PORT = '3002'; yarn dev`). Put web variables in `apps/web/.env.local`, which
Next.js loads automatically. The root `.env.local` is reserved for the audio scripts described in
`.env.example`; it is not loaded by the server or web app. Production variables belong in
`deploy/.env`; start from [`deploy/.env.example`](deploy/.env.example).

| Variable | Where | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | server | `3001` | HTTP + WebSocket port |
| `WEB_ORIGIN` | server | `http://localhost:3000` | Allowed CORS origins (comma-separated) |
| `DEV_ROOM_CODE` | server | `DEV` | Room code for the Phase 0 dev room |
| `ADMIN_TOKEN` | server | none | Bearer token for the admin panel (16+ characters). Without it the admin API is open in development and disabled in production |
| `SETTINGS_FILE` | server | `data/settings.json` | Where admin-managed settings and worlds are saved (relative to the server's working directory) |
| `QUESTIONS_FILE` | server | `data/questions.json` | Where the question bank is saved (relative to the server's working directory) |
| `MCP_ACCESS` | server | `write` in development, `off` in production | What MCP clients at `/api/mcp` may do: `off`, `read` or `write`. MCP has no authentication yet, so keep it `off` on a public server |
| `MCP_ALLOWED_HOSTS` | server | none | Extra hostnames MCP requests may name in their Host header (loopback and the `WEB_ORIGIN` hosts are always allowed) |
| `MCP_RATE_LIMIT_PER_MINUTE` | server | `120` | MCP requests per minute per client address |
| `NEXT_PUBLIC_GAME_SERVER_URL` | web | same origin, or `:3001` in dev | Where the client and admin panel connect |

Game rules, rooms, bots, worlds and questions are not env settings: they are managed in the admin panel, or by an MCP client.

## Admin over MCP

Everything the admin panel does is also an MCP tool on the game server (`/api/mcp`): settings sections, worlds and the world builder (generate, edit, check), the open rooms, and the question bank (curricula and topics, sources, questions, bulk imports with a dry run, and previewing which questions a pool would ask). With `yarn dev` running, Claude Code in this repo picks the server up from `.mcp.json`; other clients connect to `http://localhost:3001/api/mcp` (Streamable HTTP). The REST admin API and the MCP tools run the same operations (`apps/server/src/operations/`), so they always agree. See [docs/mcp-admin-operations.md](docs/mcp-admin-operations.md).

## Deployment

See [deploy/README.md](deploy/README.md) for the VPS setup, rollback, and how to record the Phase 0 performance measurements on a school-grade laptop.

## Architecture

The target architecture and the phase work items live on the ProvenMap board **volleyland**. Server modules and client folders are named after the board's elements. Contributors using Claude Code should also read [CLAUDE.md](CLAUDE.md).
