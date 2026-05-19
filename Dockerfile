ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS deps

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile

FROM deps AS builder

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_WORKSPACE_ROOT=/app

COPY scripts ./scripts
RUN pnpm --filter @selectdb/web build

FROM ${NODE_IMAGE} AS web

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DORIS_HOST=host.docker.internal
ENV DORIS_PORT=9030

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]

FROM deps AS worker-builder

RUN pnpm deploy --legacy --filter @selectdb/jobs --prod /prod/jobs

FROM ${NODE_IMAGE} AS worker

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DORIS_HOST=host.docker.internal
ENV DORIS_PORT=9030

COPY --from=worker-builder /prod/jobs ./

CMD ["./node_modules/.bin/tsx", "src/worker.ts"]
