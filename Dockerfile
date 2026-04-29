# syntax=docker/dockerfile:1.7

# =============================================================================
# Stage 1 — builder
# =============================================================================
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# OpenSSL is needed by Prisma at generate/runtime
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY prisma ./prisma

RUN npm ci

COPY tsconfig.json nest-cli.json ./
COPY src ./src
COPY views ./views
COPY public ./public
COPY scripts ./scripts

RUN npx prisma generate \
  && npm run build \
  && npx tsc scripts/seed-admin.ts \
       --outDir dist \
       --target ES2021 \
       --module commonjs \
       --moduleResolution node \
       --esModuleInterop \
       --resolveJsonModule \
       --skipLibCheck \
  && npm prune --omit=dev

# =============================================================================
# Stage 2 — runtime
# =============================================================================
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/views ./views
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/scripts ./scripts

USER node

EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://localhost:4001${BASE_PATH:-}/health" || exit 1

# Run migrations then start the API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
