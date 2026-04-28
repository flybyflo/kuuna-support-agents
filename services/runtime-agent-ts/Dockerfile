ARG BASE_IMAGE=node:22-bookworm
FROM ${BASE_IMAGE}

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/dashboard/package.json ./apps/dashboard/package.json
COPY packages ./packages
COPY services/runtime-agent-ts ./services/runtime-agent-ts

WORKDIR /workspace
RUN npm ci --workspace @kuuna/runtime-agent-ts --workspace @kuuna/agent-contracts

ENV NODE_ENV=production
EXPOSE 8100

WORKDIR /workspace/services/runtime-agent-ts
CMD ["npm", "run", "serve"]
