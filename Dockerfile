# INDPIPS backend — runs anywhere with normal internet (Prisma engines download
# at build time). SQLite on a mounted volume so it persists across restarts.
FROM node:20-slim

WORKDIR /app

# Prisma needs openssl + CA certs
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install deps (tsx + prisma are needed at runtime in this MVP setup)
COPY package.json ./
RUN npm install --no-audit --no-fund

# App source
COPY . .

# Generate the Prisma client (downloads engines — fine on a normal host)
RUN npx prisma generate

ENV NODE_ENV=production
ENV PORT=4000
# Persisted SQLite. Mount a volume at /data on your host/provider.
ENV DATABASE_URL=file:/data/indpips.db

EXPOSE 4000
VOLUME ["/data"]

# Create schema, seed once (idempotent), then start API + sync worker.
CMD ["sh", "-c", "npx prisma db push --skip-generate && (npx tsx prisma/seed.ts || true) && npx tsx src/server.ts"]
