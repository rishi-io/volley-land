# Deploying the Phase 0 prototype

One VPS runs three containers with Docker Compose: **Caddy** (TLS, routing), **web** (Next.js) and
**server** (NestJS game server). Routing is single-origin:

| Path | Goes to | Notes |
| --- | --- | --- |
| `/ws`, `/ws/*` | `server:3001` | Socket.IO game gateway; WebSocket upgrade, no idle timeout |
| `/api/*` | `server:3001` | Admin API (`/api/admin`); later the `/v1` HTTP API (Phase 2+) |
| everything else | `web:3000` | Pages, including `/play` and `/admin` |

## First deploy

On the VPS, with Docker and the Compose plugin installed, DNS for the domain pointing at the VPS,
and ports 80/443 open:

```bash
git clone <repo> volleyland && cd volleyland/deploy
cp .env.example .env            # set VOLLEYLAND_DOMAIN, ADMIN_TOKEN; VOLLEYLAND_VERSION = the commit SHA
docker compose up -d --build
docker compose ps               # all three healthy
curl -fsS https://$VOLLEYLAND_DOMAIN/ > /dev/null && echo web ok
```

The server's readiness probe (`/health/ready`) is internal to the Compose network and used by the
container healthcheck; Caddy only starts once web and server report healthy.

## Updating and rolling back

Images are tagged with `VOLLEYLAND_VERSION` (the git SHA), never `latest`, so every version on
the box can be returned to:

```bash
# update
git pull && sed -i "s/^VOLLEYLAND_VERSION=.*/VOLLEYLAND_VERSION=$(git rev-parse --short HEAD)/" .env
docker compose up -d --build

# roll back to the previous SHA (its images are still local)
sed -i "s/^VOLLEYLAND_VERSION=.*/VOLLEYLAND_VERSION=<previous-sha>/" .env
docker compose up -d
```

A server restart ends any live match (Phase 0 keeps match state in memory). Caddy reloads keep
existing sockets open for up to 5 minutes (`stream_close_delay`).

## Admin settings

Game rules, rooms, bots and worlds are edited at `https://$VOLLEYLAND_DOMAIN/admin` with the
`ADMIN_TOKEN` from `.env`. They are saved to `/app/data/settings.json` on the `server_data` volume,
so they survive redeploys and rollbacks. Back it up with
`docker compose cp server:/app/data/settings.json ./settings-backup.json`. Deleting the file (or
the volume) resets everything to the built-in defaults on the next start.

The question bank (countries, curricula, classes and years, subjects, topics, sources and
questions, with their answer keys) is edited under Question bank in the same panel and saved to
`/app/data/questions.json` on the same volume. Back it up the same way. Deleting it reseeds the
built-in bank (India CBSE Class 10 and UK GCSE Year 11) on the next start.

The same actions are MCP tools at `/api/mcp`, but MCP has no authentication yet, so Compose sets
`MCP_ACCESS=off` by default. Only set `MCP_ACCESS=read` (or `write`) in `.env` on a server that
is not reachable by the public, and keep it off once students can reach the domain.

## Phase 0 measurement on the target device

The exit bar is a stable two-player question-hit loop at **60 FPS on a school-grade laptop
(integrated graphics, 8 GB RAM)**, over the real network path through this proxy.

1. On the school laptop, open `https://<domain>/play` in the browser students will use; on a
   second device, open the same URL (both join the `DEV` room).
2. Press **F3** on the laptop to show the metrics panel.
3. Play for at least 5 minutes: move, throw, get hit, answer right and wrong, get knocked out
   and respawn.
4. Click **Copy metrics (JSON)** and save the result. It holds one row per second plus a summary
   (`fpsMedian`, `fpsP5`, `secondsBelow60`, `rttMedianMs`, `rttP95Ms`,
   `interpolationErrorMeanM`) and the device's CPU core count, memory and GPU name.

What each number means:

- **FPS**: rendered frames per second. If it sags, the render scale drops automatically
  (shown as *Render scale*).
- **Input RTT**: time from sending an input to the snapshot that acknowledges it. It includes up
  to one server tick (50 ms) of waiting.
- **Prediction error / Corrections**: how far the local player's predicted position was off when
  the server's snapshot arrived, and how often that exceeded 1 cm.
- **Interpolation error**: mean distance between where the opponent is drawn and the server's
  latest position for them. This is the visual lag that the 100 ms interpolation delay buys
  smoothness with.
- **Snapshot size / rate / Starved frames**: bandwidth per snapshot, snapshots per second
  (target 20), and the share of frames that ran past the newest snapshot (target ≈ 0 %).

The server logs tick-duration percentiles and event-loop lag every 30 s
(`docker compose logs server | grep tick_p99`).
