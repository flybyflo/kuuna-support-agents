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
COPY packages/agent-contracts/package.json ./packages/agent-contracts/package.json
COPY packages/api-client-ts/package.json ./packages/api-client-ts/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/pi-runtime/package.json ./packages/pi-runtime/package.json
COPY services/backend-ts/package.json ./services/backend-ts/package.json
COPY services/gateway/package.json ./services/gateway/package.json
COPY services/runtime-agent-ts/package.json ./services/runtime-agent-ts/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm exec turbo run build --filter=@kuuna/backend-ts...
RUN pnpm --filter @kuuna/backend-ts deploy --prod --legacy /app \
  && cp -R services/backend-ts/dist /app/dist

FROM ${BASE_IMAGE} AS runner-base
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8000
WORKDIR /app
COPY --from=builder /app ./
EXPOSE 8000
CMD ["node", "dist/src/server.js"]

FROM runner-base AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /workspace/package.json /workspace/pnpm-lock.yaml /workspace/pnpm-workspace.yaml /workspace/turbo.json /workspace/
COPY --from=builder /workspace/apps/dashboard/package.json /workspace/apps/dashboard/package.json
COPY --from=builder /workspace/packages /workspace/packages
COPY --from=builder /workspace/services/runtime-agent-ts /workspace/services/runtime-agent-ts
