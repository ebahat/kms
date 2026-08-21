FROM node:22-slim AS build
WORKDIR /repo
ENV CI=true
# NEXT_PUBLIC_* vars are read by client-bundle code (lib/api.ts) and Next.js inlines them at
# `next build` time via webpack DefinePlugin — NOT read at container runtime. Setting them only in
# docker-compose.yml's `environment:` block (as originally done) has zero effect on the already-built
# client JS; it silently falls back to the http://localhost:3000 default baked in at build time.
# CONFIRMED 2026-08-21: this shipped a build where every browser login attempt silently went to the
# user's own machine instead of the real API, surfacing as a generic "invalid email or password."
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_PORTAL_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_PORTAL_API_URL=$NEXT_PUBLIC_PORTAL_API_URL
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
