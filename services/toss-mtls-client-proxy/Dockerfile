FROM oven/bun:1.2.21-alpine

WORKDIR /app
COPY services/toss-mtls-client-proxy/package.json ./package.json
COPY services/toss-mtls-client-proxy/src ./src

USER bun
EXPOSE 8787
CMD ["bun", "src/server.mjs"]
