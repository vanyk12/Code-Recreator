// ====================================================================
// SYNAPSE AGENT — Railway Production Start Script
// ====================================================================
// 1. Runs DB migrations (drizzle-kit push)
// 2. Starts the API server on an internal port
// 3. Creates a public Express server that:
//    - Serves the built React frontend as static files
//    - Proxies /api/* requests to the API server
//    - Falls back to index.html for SPA client-side routing
// ====================================================================

import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const API_BUNDLE = path.join(__dirname, "artifacts", "api-server", "dist", "railway-entry.mjs");

const PORT = Number(process.env.PORT || 3000);
const API_PORT = PORT + 1; // API listens on internal port

// ----------------------------------------------------------------
// 1. Run database migrations
// ----------------------------------------------------------------
console.log("[start] Running database migrations...");
try {
  execSync("npx drizzle-kit push --force", {
    cwd: path.join(__dirname, "lib", "db"),
    stdio: "pipe",
    env: { ...process.env },
  });
  console.log("[start] DB migrations complete.");
} catch (err) {
  console.warn("[start] DB migration warning (tables may already exist):");
  console.warn(err.stderr?.toString() || err.message);
}

// ----------------------------------------------------------------
// 2. Start the API server on internal port
// ----------------------------------------------------------------
console.log(`[start] Starting API server on port ${API_PORT}...`);
process.env.PORT = String(API_PORT);

// Dynamic import triggers the API server's index.mjs which calls app.listen()
// But we built with railway-entry.ts which only exports the app, so we
// need to start it manually.
const { default: apiApp } = await import(API_BUNDLE);

apiApp.listen(API_PORT, () => {
  console.log(`[start] API server listening on http://localhost:${API_PORT}`);
});

// ----------------------------------------------------------------
// 3. Create public-facing server: static files + API proxy
// ----------------------------------------------------------------
const app = express();

// Serve built React frontend
app.use(express.static(PUBLIC_DIR));

// Proxy all /api requests to the internal API server
app.use(
  "/api",
  createProxyMiddleware({
    target: `http://127.0.0.1:${API_PORT}`,
    changeOrigin: true,
    // Forward the original host header for CORS
    onProxyReq: (proxyReq, req) => {
      proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
      proxyReq.setHeader("X-Forwarded-Proto", "https");
    },
  })
);

// SPA fallback: serve index.html for all non-API GET requests
app.get("*", (req, res, next) => {
  // Skip API and asset requests
  if (req.path.startsWith("/api") || req.path.includes(".")) {
    return next();
  }
  res.sendFile(path.join(PUBLIC_DIR, "index.html"), (err) => {
    if (err) next(err);
  });
});

app.listen(PORT, () => {
  console.log(`[start] SYNAPSE AGENT running on http://0.0.0.0:${PORT}`);
  console.log(`[start]   Frontend: http://0.0.0.0:${PORT}`);
  console.log(`[start]   API:      http://0.0.0.0:${PORT}/api`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[start] SIGTERM received, shutting down...");
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("[start] SIGINT received, shutting down...");
  process.exit(0);
});