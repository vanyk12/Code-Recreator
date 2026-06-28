# ============================================================
# SYNAPSE AGENT — Railway Deployment Dockerfile
# ============================================================
# Build: frontend (Vite) + backend (esbuild) in one container
# Run:   single Node.js process serves static files + API
# ============================================================

FROM node:20-slim AS base

WORKDIR /app

# --- Install pnpm ---
RUN corepack enable && corepack prepare pnpm@9 --activate

# Override Replit-specific security setting that blocks fresh packages
RUN pnpm config set minimumReleaseAge 0

# --- Copy dependency manifests first (layer caching) ---
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY lib/db/package.json lib/db/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/api-spec/package.json lib/api-spec/
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/ai-agent/package.json artifacts/ai-agent/
COPY scripts/package.json scripts/

# Install all workspace dependencies
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# --- Copy full source ---
COPY . .

# --- Replace Vite config with Railway version (no Replit plugins) ---
COPY railway/vite.config.railway.ts artifacts/ai-agent/vite.config.ts

# ============================================================
# BUILD FRONTEND
# ============================================================
RUN echo "=== Building frontend ===" && \
    cd artifacts/ai-agent && \
    npx vite build

# ============================================================
# BUILD BACKEND (esbuild, entry = railway-entry.ts → no auto-listen)
# ============================================================
# Copy the Railway-specific API entry point and build script
COPY railway/api-entry.ts artifacts/api-server/src/railway-entry.ts
COPY railway/build-api-railway.mjs artifacts/api-server/build-railway.mjs

RUN echo "=== Building API server ===" && \
    cd artifacts/api-server && \
    node build-railway.mjs

# ============================================================
# Copy built frontend to /app/public for easy serving
# ============================================================
RUN cp -r artifacts/ai-agent/dist/public /app/public

# ============================================================
# PRODUCTION
# ============================================================
# Install runtime deps for start.mjs (use pnpm, not npm — npm breaks pnpm node_modules)
RUN pnpm add express http-proxy-middleware -w

# Copy production start script
COPY railway/start.mjs /app/start.mjs

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "start.mjs"]