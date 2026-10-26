# syntax=docker/dockerfile:1
#
# Build context MUST be the repo root so the shared workspace package is visible:
#   docker build -f apps/worker/Dockerfile -t queue-lab-worker .
#
# Multi-stage: the builder installs everything and compiles; the runtime image
# contains only production dependencies and the compiled output, as a non-root
# user.

# ---------- builder ----------
FROM node:20-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# Copy only manifests first for better layer caching. All workspace package.json
# files are needed so pnpm can resolve the lockfile graph, even though we only
# install/build the worker + its deps.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/

# Install deps for the worker and everything it depends on (shared), dev included
# (we need TypeScript/nest-cli to build).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@queue-lab/worker..."

# Copy sources (only what the worker image needs) and build.
COPY packages/shared packages/shared
COPY apps/worker apps/worker
RUN pnpm --filter @queue-lab/shared build \
 && pnpm --filter @queue-lab/worker build

# Produce a pruned, production-only, self-contained deployment at /app. This
# installs just prod deps and bundles the built shared package — the pnpm
# equivalent of `npm ci --omit=dev`. --legacy is required on pnpm v10 to deploy
# a workspace package that is not configured for injected dependencies.
RUN pnpm --filter @queue-lab/worker --legacy deploy --prod /app

# ---------- runtime ----------
FROM node:20-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app

COPY --chown=node:node --from=builder /app ./

USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
