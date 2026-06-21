import { Router } from "express";
import fs from "fs/promises";
import path from "path";

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

router.get("/workspace/:chatId/*filePath", async (req, res) => {
  try {
    const chatId = parseInt(req.params.chatId);
    if (isNaN(chatId)) { res.status(400).send("Invalid chat ID"); return; }
    const filePath = (req.params as Record<string, string>).filePath || "index.html";
    const chatRoot = path.join(WORKSPACE_ROOT, "chat-workspaces", `chat-${chatId}`);
    const fullPath = path.resolve(chatRoot, filePath);
    if (!fullPath.startsWith(path.resolve(chatRoot))) { res.status(403).send("Forbidden"); return; }
    const content = await fs.readFile(fullPath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    res.setHeader("Content-Type", getMime(ext));
    res.setHeader("Cache-Control", "no-store");
    res.send(content);
  } catch (err: unknown) {
    res.status(404).send(`<pre>${(err as Error).message}</pre>`);
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

export default router;
