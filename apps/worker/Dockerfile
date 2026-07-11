FROM node:22-slim AS build
WORKDIR /repo
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@kms/worker...

FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app
COPY --from=build /repo/apps/worker/dist ./dist
COPY --from=build /repo/apps/worker/node_modules ./node_modules
COPY --from=build /repo/node_modules ./root_node_modules
USER nonroot
# WORKER_POOL=parse|ai|index set per Cloud Run service (ADR-0007)
CMD ["dist/main.js"]
