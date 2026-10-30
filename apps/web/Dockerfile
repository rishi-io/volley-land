# syntax=docker/dockerfile:1.7
# Build from the repo root:  docker build -f apps/web/Dockerfile -t volleyland-web:<version> .

FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json yarn.lock .yarnrc.yml turbo.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/game-core/package.json packages/game-core/
RUN yarn install --immutable
COPY packages/contracts packages/contracts
COPY packages/game-core packages/game-core
COPY apps/web apps/web
# Empty: the browser reaches the game server on the same origin (/ws) through the proxy.
ARG NEXT_PUBLIC_GAME_SERVER_URL=
ENV NEXT_PUBLIC_GAME_SERVER_URL=$NEXT_PUBLIC_GAME_SERVER_URL
RUN yarn turbo run build --filter=@volleyland/web

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# Next.js standalone output mirrors the monorepo layout from the tracing root.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
