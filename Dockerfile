# syntax=docker/dockerfile:1

# Betting Game MVP API - production image
#
# Build:  docker build -t betting-backend .
# Run:    docker run -d --name betting-backend -p 5000:5000 \
#           -e CORS_ORIGIN=http://localhost:5173 \
#           -v betting-data:/app/data \
#           betting-backend
#
# Config comes from environment variables (.env is NOT copied into the image):
#   PORT                   default 5000
#   CORS_ORIGIN            comma-separated allowed origins
#   DEMO_STARTING_BALANCE  default 100000 (1,000.00 VC)
#   DATA_FILE              default data/store.json ("memory" = no persistence)

ARG NODE_VERSION=22

# ---- Stage 1: production dependencies only ----
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: Prisma is listed but not used until Phase 3, so skip its engine download.
# Remove the flag (and add `npx prisma generate`) once PostgreSQL + Prisma are wired in.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---- Stage 2: runtime ----
FROM node:${NODE_VERSION}-alpine AS runtime

# tini forwards SIGTERM to Node, so `docker stop` is instant instead of a 10 s timeout.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=5000 \
    DATA_FILE=data/store.json

WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

# Data folder for the JSON store. Owned by the non-root `node` user so writes succeed.
RUN mkdir -p /app/data && chown node:node /app/data
USER node

VOLUME ["/app/data"]
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
