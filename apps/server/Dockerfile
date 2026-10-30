# syntax=docker/dockerfile:1.7
# Build from the repo root:  docker build -f apps/server/Dockerfile -t volleyland-server:<version> .

FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json yarn.lock .yarnrc.yml turbo.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/game-core/package.json packages/game-core/
RUN yarn install --immutable
COPY packages/contracts packages/contracts
COPY packages/game-core packages/game-core
COPY apps/server apps/server
RUN yarn turbo run build --filter=@volleyland/server \
 && yarn workspaces focus @volleyland/server --production

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /repo/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /repo/packages/game-core/package.json ./packages/game-core/package.json
COPY --from=build --chown=node:node /repo/packages/game-core/dist ./packages/game-core/dist
COPY --from=build --chown=node:node /repo/apps/server/package.json ./apps/server/package.json
COPY --from=build --chown=node:node /repo/apps/server/dist ./apps/server/dist
# Admin-managed settings and worlds (JsonFileSettingsStore); mount a volume here to keep them.
RUN mkdir -p /app/data && chown node:node /app/data
ENV SETTINGS_FILE=/app/data/settings.json
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/main.js"]
