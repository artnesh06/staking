# syntax=docker/dockerfile:1
# Odds Garden (soft staking) - Next.js 15 + Prisma on Node 22 (Alpine)
FROM node:22-alpine AS base
RUN apk upgrade --no-cache && apk add --no-cache openssl libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
ENV HUSKY=0
COPY package.json package-lock.json .npmrc ./
COPY stubs ./stubs
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

FROM base AS builder
# NEXT_PUBLIC_* values are inlined at build time (mark them as build variables in Coolify)
ARG NEXT_PUBLIC_NETWORK
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_COLLECTION_ADDRESS
ARG NEXT_PUBLIC_IPFS_GATEWAY
ENV NEXT_PUBLIC_NETWORK=$NEXT_PUBLIC_NETWORK \
    NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    NEXT_PUBLIC_COLLECTION_ADDRESS=$NEXT_PUBLIC_COLLECTION_ADDRESS \
    NEXT_PUBLIC_IPFS_GATEWAY=$NEXT_PUBLIC_IPFS_GATEWAY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && NODE_OPTIONS=--max-old-space-size=6144 npx next build --no-lint

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/project/list" > /dev/null || exit 1
CMD ["sh", "./start.sh"]
