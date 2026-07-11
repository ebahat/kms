FROM node:22-slim AS build
WORKDIR /repo
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@kms/web...

FROM node:22-slim
WORKDIR /app
COPY --from=build /repo/apps/web/.next ./.next
COPY --from=build /repo/apps/web/node_modules ./node_modules
COPY --from=build /repo/apps/web/package.json ./package.json
COPY --from=build /repo/apps/web/next.config.mjs ./next.config.mjs
USER node
EXPOSE 3000
# Admin UI served on the admin.<domain> hostname, routed at the LB (ADR-0004/0007) —
# no separate frontend app (design review 2026-07-10, finding 8).
CMD ["node_modules/.bin/next", "start"]
