FROM node:22-slim AS build
WORKDIR /repo
ENV CI=true
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@kms/web...

FROM node:22-slim
WORKDIR /app
# output: 'standalone' (next.config.mjs) traces only the deps actually used into a
# self-contained node_modules — no pnpm workspace symlinks to break, no libs/ to copy.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3010
# Admin UI served on the admin.<domain> hostname, routed at the LB (ADR-0004/0007) —
# no separate frontend app (design review 2026-07-10, finding 8).
CMD ["node", "apps/web/server.js"]
