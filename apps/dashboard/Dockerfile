# syntax=docker/dockerfile:1

ARG BASE_IMAGE=node:22-bookworm

FROM ${BASE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/dashboard/package.json ./apps/dashboard/package.json
COPY apps/dashboard/turbo.json ./apps/dashboard/turbo.json
COPY packages/agent-contracts/package.json ./packages/agent-contracts/package.json
COPY packages/api-client-ts/package.json ./packages/api-client-ts/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/pi-runtime/package.json ./packages/pi-runtime/package.json
COPY services/backend-ts/package.json ./services/backend-ts/package.json
COPY services/gateway/package.json ./services/gateway/package.json
COPY services/runtime-agent-ts/package.json ./services/runtime-agent-ts/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS builder
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=prod
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN mkdir -p apps/dashboard/public
RUN pnpm exec turbo run build --filter=@kuuna/dashboard...

FROM ${BASE_IMAGE} AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=builder /workspace/apps/dashboard/.next/standalone ./
COPY --from=builder /workspace/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder /workspace/apps/dashboard/public ./apps/dashboard/public
EXPOSE 3000
CMD ["node", "apps/dashboard/server.js"]
