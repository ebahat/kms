FROM node:22-slim AS build
WORKDIR /repo
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@kms/worker...

FROM gcr.io/distroless/nodejs22-debian12
# Preserve the exact /repo/apps/worker depth (matches apps/api/Dockerfile) — pnpm's workspace
# symlinks under apps/worker/node_modules encode relative paths back to /repo/node_modules/.pnpm/*;
# an earlier version of this file used WORKDIR /app with the root node_modules copied to a
# differently-named ./root_node_modules, which those symlinks could never resolve to. libs/ is
# required too — @kms/* workspace packages resolve the same way as api's, which already gets this
# right. This image was never actually built+run before 2026-08-31 (worker was never deployed).
WORKDIR /repo/apps/worker
COPY --from=build /repo/apps/worker/dist ./dist
COPY --from=build /repo/apps/worker/node_modules ./node_modules
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/libs /repo/libs
USER nonroot
# WORKER_POOL=parse|ai|index — one image, three docker-compose services (deploy/docker-compose.yml)
CMD ["dist/main.js"]
