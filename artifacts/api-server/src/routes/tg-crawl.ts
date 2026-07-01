import { Router } from "express";
import { spawn } from "child_process";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import path from "path";

const router = Router();

// Храним активные процессы: jobId → { proc, res }
interface ActiveJob {
  proc: ReturnType<typeof spawn>;
  res: import("express").Response;
}
const activeJobs = new Map<string, ActiveJob>();

/**
 * POST /api/tg-crawl/start
 * Запускает парсинг TG-бота, возвращает SSE-стрим с прогрессом.
 *
 * Первое SSE-событие всегда: { event: "job", data: { jobId } }
 * Фронтенд использует jobId для отправки кода/пароля через /api/tg-crawl/send-input
 */
router.post("/tg-crawl/start", requireAuth, async (req, res) => {
  const { botUsername, phone, maxDepth = 3 } = req.body as {
    botUsername?: string;
    phone?: string;
    maxDepth?: number;
  };

  if (!botUsername?.trim()) {
    res.status(400).json({ error: "Укажи юзернейм бота" });
    return;
  }

  // Получаем api_id и api_hash из настроек
  let apiId = "";
  let apiHash = "";
  let userPhone = phone || "";

  try {
    const rows = await db.select().from(settingsTable);
    const settingsMap: Record<string, string> = {};
    for (const row of rows) {
      settingsMap[row.key] = row.value;
    }
    apiId = settingsMap.telegram_api_id || "";
    apiHash = settingsMap.telegram_api_hash || "";
    if (!userPhone) {
      userPhone = settingsMap.telegram_phone || "";
    }
  } catch {
    // настройки недоступны
  }

  if (!apiId || !apiHash) {
    res.status(422).json({
      error: "API ID и API Hash не настроены. Зайди в Настройки → Telegram API",
      needsSettings: true,
    });
    return;
  }

  if (!userPhone) {
    res.status(422).json({
      error: "Нужен номер телефона для авторизации в Telegram",
      needsPhone: true,
    });
    return;
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // отключаем буферизацию nginx
  res.flushHeaders?.();

  const jobId = `crawl_${Date.now()}`;
  const sessionDir = "/tmp/tg_sessions";

  // Отправляем jobId первым событием
  res.write(`event: job\ndata: ${JSON.stringify({ jobId })}\n\n`);

  // Путь к Python crawler
  const crawlerScript = path.resolve(process.cwd(), "scripts/tg_crawler.py");

  const args = [
    crawlerScript,
    `api_id=${apiId}`,
    `api_hash=${apiHash}`,
    `phone=${userPhone}`,
    `bot=${botUsername.trim().replace("@", "")}`,
    `session_dir=${sessionDir}`,
    `max_depth=${maxDepth}`,
  ];

  function sendSSE(event: string, data: unknown) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // клиент отключился
    }
  }

  const proc = spawn("python3", args, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  activeJobs.set(jobId, { proc, res });

  let resultData: unknown = null;
  let buffer = "";

  proc.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf-8");
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.type === "progress") {
          sendSSE("progress", msg);
          if (msg.needs_input === "code") {
            sendSSE("needs_code", { message: msg.message });
          } else if (msg.needs_input === "password") {
            sendSSE("needs_password", { message: msg.message });
          }
        } else if (msg.type === "result") {
          resultData = msg.data;
        } else if (msg.type === "error") {
          sendSSE("error", { message: msg.message });
        }
      } catch {
        // не JSON —可能是 Python warning
      }
    }
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8").trim();
    if (text) {
      sendSSE("stderr", { message: text });
    }
  });

  proc.on("close", (exitCode) => {
    activeJobs.delete(jobId);
    if (exitCode === 0 && resultData) {
      sendSSE("done", { data: resultData });
    } else if (!resultData) {
      sendSSE("error", { message: "Краулер завершился без результата (код: " + exitCode + ")" });
    }
    try { res.end(); } catch {}
  });

  proc.on("error", (err) => {
    activeJobs.delete(jobId);
    sendSSE("error", { message: `Ошибка запуска: ${err.message}` });
    try { res.end(); } catch {}
  });

  // Если клиент отключается — убиваем процесс
  req.on("close", () => {
    if (activeJobs.has(jobId)) {
      proc.kill("SIGTERM");
      activeJobs.delete(jobId);
    }
  });
});

/**
 * POST /api/tg-crawl/send-input
 * Отправить код/пароль в stdin активного процесса (тот же SSE-соединение остаётся открытым).
 */
router.post("/tg-crawl/send-input", requireAuth, async (req, res) => {
  const { jobId, input } = req.body as { jobId?: string; input?: string };

  if (!jobId || !input) {
    res.status(400).json({ error: "jobId и input обязательны" });
    return;
  }

  const job = activeJobs.get(jobId);
  if (!job || !job.proc.stdin) {
    res.status(404).json({ error: "Процесс не найден или завершён" });
    return;
  }

  job.proc.stdin.write(input.trim() + "\n");
  res.json({ success: true });
});

/**
 * POST /api/tg-crawl/stop
 * Остановить активный парсинг.
 */
router.post("/tg-crawl/stop", requireAuth, async (req, res) => {
  const { jobId } = req.body as { jobId?: string };

  if (!jobId) {
    res.status(400).json({ error: "jobId обязателен" });
    return;
  }

  const job = activeJobs.get(jobId);
  if (!job) {
    res.json({ success: true, message: "Процесс уже завершён" });
    return;
  }

  job.proc.kill("SIGTERM");
  activeJobs.delete(jobId);
  try { job.res.end(); } catch {}
  res.json({ success: true });
});

/**
 * GET /api/tg-crawl/check-settings
 * Проверяет настроены ли TG API credentials.
 */
router.get("/tg-crawl/check-settings", requireAuth, async (_req, res) => {
  try {
    const rows = await db.select().from(settingsTable);
    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.key] = row.value;
    }

    const hasApiId = !!map.telegram_api_id;
    const hasApiHash = !!map.telegram_api_hash;
    const hasPhone = !!map.telegram_phone;

    // Проверяем есть ли сессия
    const fs = await import("fs/promises");
    const phone = map.telegram_phone || "unknown";
    const sessionFile = `/tmp/tg_sessions/${phone}.session`;
    let hasSession = false;
    try {
      await fs.access(sessionFile);
      hasSession = true;
    } catch {
      // нет файла сессии
    }

    res.json({
      configured: hasApiId && hasApiHash,
      hasSession,
      hasPhone,
    });
  } catch {
    res.json({ configured: false, hasSession: false, hasPhone: false });
  }
});

export default router;