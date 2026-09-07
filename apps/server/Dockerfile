# Build context MUST be the repo root (needs packages/shared):
#   docker build -f apps/server/Dockerfile .
FROM node:22-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN npm ci --workspace @sinc/shared --workspace @sinc/server

COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build -w @sinc/shared \
 && npm run build -w @sinc/server \
 && npm run prisma:generate -w @sinc/server

FROM node:22-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates curl \
 && curl -fsSL -o /usr/local/bin/yt-dlp \
      https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
 && chmod +x /usr/local/bin/yt-dlp \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    DOWNLOAD_DIR=/data/downloads

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/prisma ./apps/server/prisma
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/package.json ./package.json

WORKDIR /app/apps/server
EXPOSE 3000
# Migrations run on boot; safe to re-run (idempotent).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
