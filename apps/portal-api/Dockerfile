FROM node:22-slim AS build
WORKDIR /repo
ENV CI=true
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@kms/portal-api...

FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /repo/apps/portal-api
COPY --from=build /repo/apps/portal-api/dist ./dist
COPY --from=build /repo/apps/portal-api/node_modules ./node_modules
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/libs /repo/libs
USER nonroot
EXPOSE 3100
CMD ["dist/main.js"]
