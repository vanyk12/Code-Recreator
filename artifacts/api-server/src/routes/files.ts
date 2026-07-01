import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { createRequire } from "node:module";
// archiver is CJS-only — must load via require in ESM context
const _require = createRequire(import.meta.url);
const archiver = _require("archiver") as typeof import("archiver");

const router = Router();

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/home/runner/workspace";

function getMime(ext: string): string {
  const map: Record<string, string> = {
    html: "text/html", htm: "text/html",
    css: "text/css",
    js: "application/javascript", mjs: "application/javascript",
    json: "application/json",
    svg: "image/svg+xml",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", ico: "image/x-icon",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf",
    mp4: "video/mp4", webm: "video/webm",
    txt: "text/plain", md: "text/plain",
  };
  return map[ext] || "application/octet-stream";
}

function safePath(p: string): string {
  const resolved = path.isAbsolute(p) ? path.resolve(p) : path.resolve(WORKSPACE_ROOT, p);
  if (!resolved.startsWith(path.resolve(WORKSPACE_ROOT))) {
    throw new Error("Path traversal not allowed");
  }
  return resolved;
}

router.get("/preview-file", async (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) { res.status(400).send("Missing path"); return; }
    const fullPath = safePath(filePath);
    const content = await fs.readFile(fullPath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = getMime(ext);
    res.setHeader("Content-Type", `${mime}; charset=utf-8`);
    res.send(content);
  } catch (err: unknown) {
    res.status(404).send(`<pre>File not found: ${(err as Error).message}</pre>`);
  }
});

router.get("/workspace/:chatId/{*filePath}", async (req, res) => {
  try {
    const chatId = parseInt(req.params.chatId);
    if (isNaN(chatId)) { res.status(400).send("Invalid chat ID"); return; }
    const rawFilePath = req.params.filePath;
    const filePath = (Array.isArray(rawFilePath) ? rawFilePath.join("/") : rawFilePath) || "index.html";
    const chatRoot = path.join(WORKSPACE_ROOT, "chat-workspaces", `chat-${chatId}`);
    const fullPath = path.resolve(chatRoot, filePath);
    if (!fullPath.startsWith(path.resolve(chatRoot))) { res.status(403).send("Forbidden"); return; }
    const content = await fs.readFile(fullPath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = getMime(ext);
    res.setHeader("Cache-Control", "no-store");

    // For HTML files: detect server-side templates and fix relative asset paths
    if (ext === "html" || ext === "htm") {
      const html = content.toString("utf-8");

      // Detect server-side template syntax (Jinja2, Django, Handlebars, ERB, Twig, Blade)
      const TEMPLATE_RE = /\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}|\{#[\s\S]*?#\}|<%[\s\S]*?%>|@(if|foreach|for|extends|yield|section)\b/;
      const isTemplate = TEMPLATE_RE.test(html);

      if (isTemplate) {
        // Return a nicely styled source-code view with a server-side notice
        const escaped = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const templatePage = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Превью: ${filePath}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
  .banner { display: flex; align-items: center; gap: 10px; padding: 10px 16px;
    background: rgba(249,115,22,0.12); border-bottom: 1px solid rgba(249,115,22,0.25); }
  .banner-icon { font-size: 18px; }
  .banner-title { font-weight: 600; color: #fb923c; font-size: 13px; }
  .banner-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }
  .file-label { margin-left: auto; font-family: monospace; font-size: 10px;
    background: rgba(249,115,22,0.15); color: #fdba74; padding: 3px 8px; border-radius: 6px; }
  .source { padding: 16px; overflow-x: auto; }
  pre { font-family: "JetBrains Mono", "Fira Code", monospace; font-size: 12px;
    line-height: 1.7; color: #94a3b8; white-space: pre-wrap; word-break: break-all; }
  .kw  { color: #fb923c; } /* {% %} keywords */
  .var { color: #38bdf8; } /* {{ }} variables */
  .cmt { color: #475569; } /* {# #} comments */
  .tag { color: #a78bfa; } /* HTML tags */
  .attr { color: #34d399; } /* HTML attributes */
  .str { color: #fbbf24; } /* attribute values */
</style></head><body>
<div class="banner">
  <span class="banner-icon">⚙️</span>
  <div>
    <div class="banner-title">Серверный шаблон — статический просмотр недоступен</div>
    <div class="banner-sub">Этот файл использует Jinja2/Django/Handlebars синтаксис. Запустите сервер в Терминале для реального рендеринга.</div>
  </div>
  <span class="file-label">${filePath}</span>
</div>
<div class="source"><pre>${escaped}</pre></div>
</body></html>`;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(templatePage);
        return;
      }

      // Pure static HTML: inject <base href> so relative assets (CSS, images, JS) load correctly
      const dir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/") + 1) : "";
      const baseHref = `/api/workspace/${chatId}/${dir}`;
      let patched = html;
      if (/<head[^>]*>/i.test(patched)) {
        patched = patched.replace(/(<head[^>]*>)/i, `$1\n  <base href="${baseHref}">`);
      } else {
        patched = `<base href="${baseHref}">` + patched;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(patched);
      return;
    }

    res.setHeader("Content-Type", mime);
    res.send(content);
  } catch (err: unknown) {
    res.status(404).send(`<!DOCTYPE html><html><body style="font-family:monospace;background:#0f172a;color:#94a3b8;padding:24px"><pre>Файл не найден:\n${(err as Error).message}</pre></body></html>`);
  }
});

router.post("/files/list", async (req, res) => {
  try {
    const { path: dirPath } = req.body;
    const fullPath = dirPath ? safePath(dirPath) : WORKSPACE_ROOT;

    try { await fs.access(fullPath); } catch { res.json([]); return; }

    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    const result = await Promise.all(
      entries
        .filter(e => !e.name.startsWith(".") || e.name === ".env")
        .filter(e => !["node_modules", ".git", "dist", ".tsbuildinfo"].includes(e.name))
        .map(async (e) => {
          let size: number | null = null;
          if (e.isFile()) {
            try {
              const stat = await fs.stat(path.join(fullPath, e.name));
              size = stat.size;
            } catch { }
          }
          return {
            name: e.name,
            path: path.join(dirPath || "/", e.name),
            type: e.isDirectory() ? "directory" : "file",
            size,
          };
        })
    );

    res.json(result.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    }));
  } catch (err: unknown) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list files" });
  }
});

router.post("/files/read", async (req, res) => {
  try {
    const { path: filePath } = req.body;
    const fullPath = safePath(filePath);
    const content = await fs.readFile(fullPath, "utf-8");
    res.json({ path: filePath, content });
  } catch (err: unknown) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to read file" });
  }
});

router.post("/files/write", async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    const fullPath = safePath(filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
    res.json({ success: true, message: `File written: ${filePath}` });
  } catch (err: unknown) {
    req.log.error(err);
    res.status(500).json({ success: false, message: err instanceof Error ? err.message : "Failed to write file" });
  }
});

router.post("/files/delete", async (req, res) => {
  try {
    const { path: filePath } = req.body;
    const fullPath = safePath(filePath);
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      await fs.rm(fullPath, { recursive: true });
    } else {
      await fs.unlink(fullPath);
    }
    res.json({ success: true, message: `Deleted: ${filePath}` });
  } catch (err: unknown) {
    req.log.error(err);
    res.status(500).json({ success: false, message: err instanceof Error ? err.message : "Failed to delete" });
  }
});

/* ─── GET /workspace-zip/:chatId ────────────────────────────────────────────
   Streams a ZIP archive of the chat workspace.
   Auth: ?secret=BOT_API_SECRET (set this env var on Replit)
   Used by the Telegram bot: bot calls this URL → gets ZIP bytes → sendDocument
─────────────────────────────────────────────────────────────────────────── */
router.get("/workspace-zip/:chatId", async (req, res) => {
  try {
    // --- Auth ---
    const secret = process.env.BOT_API_SECRET;
    if (secret && req.query.secret !== secret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const chatId = parseInt(req.params.chatId as string);
    if (isNaN(chatId)) { res.status(400).json({ error: "Invalid chat ID" }); return; }

    const chatRoot = path.join(WORKSPACE_ROOT, "chat-workspaces", `chat-${chatId}`);

    // Check workspace exists and is not empty
    try { await fs.access(chatRoot); } catch {
      res.status(404).json({ error: `Workspace for chat ${chatId} not found` });
      return;
    }

    const SKIP = new Set(["node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build", ".next"]);

    // Stream ZIP directly to response
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="synapse-chat-${chatId}.zip"`);
    res.setHeader("Cache-Control", "no-store");

    const archive = archiver("zip", { zlib: { level: 6 } });

    archive.on("error", (err) => {
      req.log.error(err, "archiver error");
      if (!res.headersSent) res.status(500).json({ error: "ZIP creation failed" });
    });

    archive.pipe(res);

    // Walk workspace and add files, skipping heavy dirs
    async function addDir(dir: string, zipBase: string) {
      let entries: import("fs").Dirent[];
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (SKIP.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        const zipPath = zipBase ? `${zipBase}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await addDir(fullPath, zipPath);
        } else {
          archive.file(fullPath, { name: zipPath });
        }
      }
    }

    await addDir(chatRoot, "");
    await archive.finalize();

    req.log.info({ chatId, bytes: archive.pointer() }, "Workspace ZIP sent");
  } catch (err: unknown) {
    req.log.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Internal error" });
  }
});

export default router;
