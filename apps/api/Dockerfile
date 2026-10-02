# API (NestJS). Le contexte de build est la RACINE du dépôt (monorepo pnpm) :
#   docker build -f apps/api/Dockerfile -t vtc-api .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @vtc/api...
COPY apps/api apps/api
RUN pnpm --filter @vtc/api build \
 && pnpm --filter @vtc/api --prod deploy --legacy /out \
 && cp -r apps/api/dist apps/api/drizzle /out/

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
USER node
# Cloud Run fournit PORT ; l'API l'écoute déjà
CMD ["node", "--enable-source-maps", "dist/main.js"]
