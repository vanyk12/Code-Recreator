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
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const INDEX_HTML = path.join(PUBLIC_DIR, "index.html");
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

let apiApp;
try {
  const mod = await import(API_BUNDLE);
  apiApp = mod.default;
} catch (err) {
  console.error("[start] FATAL: Failed to load API bundle:", err.message);
  console.error(err.stack);
  process.exit(1);
}

try {
  apiApp.listen(API_PORT, () => {
    console.log(`[start] API server listening on http://localhost:${API_PORT}`);
  });
} catch (err) {
  console.error("[start] FATAL: Failed to start API server:", err.message);
  console.error(err.stack);
  process.exit(1);
}

// ----------------------------------------------------------------
// 3. Create public-facing server: static files + API proxy
// ----------------------------------------------------------------
const app = express();

// Serve built React frontend
app.use(express.static(PUBLIC_DIR));

// Proxy all /api requests to the internal API server
// The API server mounts its router at /api, so we must forward the FULL path
app.use(
  createProxyMiddleware({
    // Match all requests starting with /api
    filter: (pathname) => pathname.startsWith("/api"),
    target: `http://127.0.0.1:${API_PORT}`,
    changeOrigin: true,
    // CRITICAL: Do NOT rewrite the path — forward /api/chats as-is
    // so the API server's app.use("/api", router) matches correctly
    on: {
      proxyReq: (proxyReq, req) => {
        console.log(`[proxy] ${req.method} ${req.url} → 127.0.0.1:${API_PORT}${req.url}`);
        proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
        proxyReq.setHeader("X-Forwarded-Proto", "https");
      },
      proxyRes: (proxyRes, req) => {
        const status = proxyRes.statusCode;
        console.log(`[proxy] ${req.method} ${req.url} ← ${status}`);
        if (status >= 400) {
          console.error(`[proxy] ERROR ${status} for ${req.method} ${req.url}`);
        }
      },
      error: (err, req, res) => {
        console.error(`[proxy] Proxy error: ${req.method} ${req.url}`, err.message);
        console.error(err.stack);
        if (!res.headersSent) {
          res.status(502).json({ error: "API proxy error" });
        }
      },
    },
  })
);

// SPA fallback: serve index.html for all non-API, non-asset GET requests
// Using plain middleware instead of app.get("*path") to avoid any path-to-regexp issues
app.use((req, res, next) => {
  // Skip API requests (already handled by proxy above, but just in case)
  if (req.path.startsWith("/api")) {
    return next();
  }
  // Skip requests for static assets (files with extensions)
  if (req.path.includes(".") && req.path.lastIndexOf(".") > req.path.lastIndexOf("/")) {
    return next();
  }
  // Serve index.html for SPA routing
  res.sendFile(INDEX_HTML, (err) => {
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