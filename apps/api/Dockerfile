FROM node:22-slim AS build
WORKDIR /repo
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@kms/api...

FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/node_modules ./node_modules
COPY --from=build /repo/node_modules ./root_node_modules
USER nonroot
EXPOSE 3000
CMD ["dist/main.js"]
