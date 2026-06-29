FROM oven/bun:1.3.13-alpine

WORKDIR /app
COPY package.json bun.lock ./
COPY packages/ait-rn/package.json ./packages/ait-rn/package.json
COPY packages/trailbase-client/package.json ./packages/trailbase-client/package.json
COPY packages/trailbase-runtime/package.json ./packages/trailbase-runtime/package.json
COPY packages/toss-mtls-core/package.json ./packages/toss-mtls-core/package.json
COPY packages/toss-mtls-client/package.json ./packages/toss-mtls-client/package.json
COPY services/toss-mtls-client-proxy/package.json ./services/toss-mtls-client-proxy/package.json
RUN bun install --frozen-lockfile --production --filter @trailbase-apps-in-toss-kit/toss-mtls-client-proxy

COPY packages/toss-mtls-core ./packages/toss-mtls-core
COPY packages/toss-mtls-client ./packages/toss-mtls-client
COPY services/toss-mtls-client-proxy ./services/toss-mtls-client-proxy

WORKDIR /app/services/toss-mtls-client-proxy
USER bun
EXPOSE 8787
CMD ["bun", "src/server.mjs"]
