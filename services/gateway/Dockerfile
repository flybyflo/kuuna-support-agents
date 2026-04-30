# syntax=docker/dockerfile:1

ARG BASE_IMAGE=node:22-bookworm

FROM ${BASE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY services/gateway/package.json ./services/gateway/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm exec turbo run build --filter=@kuuna/gateway...
RUN pnpm --filter @kuuna/gateway deploy --prod --legacy /app \
  && cp -R services/gateway/dist /app/dist

FROM ${BASE_IMAGE} AS runner
ENV NODE_ENV=production
ENV GATEWAY_OPS_HOST=0.0.0.0
ENV GATEWAY_OPS_PORT=8090
WORKDIR /app
COPY --from=builder /app ./
EXPOSE 8090
CMD ["node", "dist/src/server.js"]
