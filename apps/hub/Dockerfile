FROM oven/bun:1.4.2 AS production-dependencies
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts --production --filter hub --linker hoisted

FROM oven/bun:1.4.2-slim
ARG REVISION=dev
WORKDIR /repo
COPY --from=production-dependencies /repo/node_modules ./node_modules
COPY packages/protocol/package.json packages/protocol/
COPY packages/protocol/src packages/protocol/src
COPY apps/hub/package.json apps/hub/
COPY apps/hub/src apps/hub/src
USER bun
WORKDIR /repo/apps/hub
ENV NODE_ENV=production PORT=3000 REVISION=$REVISION CONFIG_FILE=/config/sth-seat.yaml
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD bun -e 'const r = await fetch("http://127.0.0.1:3000/healthz"); process.exit(r.ok ? 0 : 1)'
CMD ["bun", "src/app/server.ts"]
