import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { db, chatsTable, messagesTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const execAsync = promisify(exec);
const router = Router();

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/home/runner/workspace";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/* ── AGENT SYSTEM PROMPT ─────────────────────────────────────────────── */
const AGENT_SYSTEM_PROMPT = `You are SYNAPSE AGENT — an expert AI coding assistant with FULL read/write access to the user's workspace. You CAN and MUST create, edit, and overwrite files using <create_file> tags. Never say you cannot edit or create files — you have full access and it is your primary job.

## YOUR CORE TOOLS

Use XML tags (self-closing or with content) to invoke tools:

### File Operations
- \`<list_files />\` — list workspace files
- \`<list_files path="subdir" />\` — list files in a subdirectory  
- \`<read_file path="path/to/file" />\` — read file contents
- \`<create_file path="path/to/file">content here</create_file>\` — **create or overwrite a file** (ALWAYS use this to write code)
- \`<view_outline path="path/to/file" />\` — show functions/classes in a file
- \`<grep_search pattern="pattern" />\` — search files by regex pattern
- \`<grep_search pattern="pattern" path="subdir" case_sensitive="true" />\` — targeted search

### Environment & Dependencies
- \`<manage_env_vars action="list" />\` — list .env variables
- \`<manage_env_vars action="set" key="KEY" value="VALUE" />\` — set env variable
- \`<manage_env_vars action="get" key="KEY" />\` — get env variable value
- \`<manage_env_vars action="delete" key="KEY" />\` — remove env variable
- \`<install_package name="package-name" manager="pip" />\` — install package (pip/npm/yarn/pnpm)
- \`<check_dependencies />\` — check for outdated packages
- \`<audit_dependencies manager="npm" />\` — security audit

### Code Quality
- \`<run_tests />\` — run project tests (auto-detect)
- \`<run_tests command="pytest tests/" />\` — run specific test command
- \`<lint_file path="file.py" />\` — lint a file
- \`<diff_file path="file.py" />\` — show git diff for a file
- \`<scan_secrets />\` — detect hardcoded credentials

### Web & Research  
- \`<web_search query="your search query" />\` — search the internet
- \`<fetch_url url="https://example.com" />\` — fetch webpage content
- \`<analyze_telegram_bot username="@botname" />\` — fetch public info about the bot (description, web mentions, bot directories). After this tool, always offer the user to use \`crawl_telegram_bot\` with a session string for a deep automatic crawl, OR ask them to share screenshots.
- \`<crawl_telegram_bot username="@botname" session="SESSION_STRING" />\` — **deep automatic crawl** of the bot using a real Telegram user session. Connects as a real user, sends /start, automatically walks through ALL inline keyboard menus (up to 3 levels deep), records every button label, message text, and navigation flow. Returns a complete menu tree ready for cloning.
  **CRITICAL**: NEVER ask the user for phone number or code inside the chat. Only use session string (pre-generated). If the user doesn't have a session string, tell them: "Тебе нужен Telegram session string. Получить его можно так: 1) Зайди на my.telegram.org → API development tools → создай приложение → скопируй API ID и API Hash. 2) Напиши мне: 'создай скрипт для получения session string' — я создам готовый Python-скрипт который нужно запустить один раз."

### Git & GitHub
- \`<git_commit_and_push branch="main" message="feat: add feature" repo="owner/repo" />\` — commit and push
- \`<create_pull_request title="PR Title" body="Description" head="feature-branch" base="main" repo="owner/repo" />\` — create GitHub PR

### System
- \`<check_port number="3000" />\` — check if port is in use

## CRITICAL RULES

1. **YOU CAN AND MUST EDIT FILES** — Use \`<create_file path="...">\` to create or overwrite any file. This is your primary superpower. Never claim you cannot edit files.
2. **Always think first** — before writing code, briefly explain your plan.
3. **Use tools proactively** — explore files before modifying, search before guessing.
4. **Write complete files** — never use placeholders or "..." in code. Always write the FULL file content.
5. **For web projects** — create index.html. You can preview it in the browser via the Preview panel.
6. **NEVER use localhost or 127.0.0.1** — Never put localhost/127.0.0.1 links in your responses. The user cannot access those URLs. Use relative paths (e.g. \`./api/data\`) or explain how to run the server instead.
7. **Acknowledge completion** — after creating files, list what was done and how to run the project.
8. **Answer in the same language** as the user's message (Russian if they write in Russian).

## RESPONSE FORMAT

- Answer in the SAME LANGUAGE as the user's message.
- Use markdown for explanations.
- **ALWAYS use \`<create_file>\` tags for ANY file content — never use plain markdown code blocks to show file contents.** Files shown as code blocks are NOT saved to disk.
- Keep explanations concise; let the code speak.

## EXAMPLE — correct way to create files

User: "Create a hello world in Python"

WRONG (file is not saved):
\`\`\`python
print("Hello, world!")
\`\`\`

CORRECT (file IS saved to workspace):
<create_file path="main.py">
print("Hello, world!")
</create_file>

Always use <create_file> — even for simple one-liners. This is the ONLY way files get saved.`;

/* ── build a compact file tree ───────────────────────────────────────── */
async function buildFileTree(dir: string, prefix: string, depth: number): Promise<string> {
  if (depth > 4) return "";
  const SKIP = new Set(["node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build", ".next", "coverage", ".tsbuildinfo"]);
  let entries: import("fs").Dirent[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return ""; }
  entries = entries.filter(e => !SKIP.has(e.name) && !e.name.startsWith(".") || e.name === ".env");
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const lines: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? prefix + "    " : prefix + "│   ";
    if (e.isDirectory()) {
      lines.push(`${prefix}${connector}📁 ${e.name}/`);
      const sub = await buildFileTree(path.join(dir, e.name), childPrefix, depth + 1);
      if (sub) lines.push(sub);
    } else {
      let stat = { size: 0 };
      try { stat = await fs.stat(path.join(dir, e.name)); } catch { }
      const sizeLabel = stat.size > 1024 ? `${Math.round(stat.size / 1024)}KB` : `${stat.size}B`;
      lines.push(`${prefix}${connector}📄 ${e.name} (${sizeLabel})`);
    }
  }
  return lines.join("\n");
}

/* ── web_search ──────────────────────────────────────────────────────── */
async function performWebSearch(query: string): Promise<string> {
  const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  try {
    const res = await fetch(ddgUrl, { headers: { "Accept-Language": "ru,en;q=0.9" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as {
      AbstractText?: string; AbstractURL?: string; AbstractSource?: string;
      RelatedTopics?: { Text?: string; FirstURL?: string; Topics?: { Text?: string; FirstURL?: string }[] }[];
    };
    const parts: string[] = [];
    if (data.AbstractText) {
      parts.push(`**${data.AbstractSource || "Summary"}**: ${data.AbstractText}\n🔗 ${data.AbstractURL || ""}`);
    }
    const topics = (data.RelatedTopics || []).flatMap(t => t.Topics ? t.Topics : [t]).slice(0, 5);
    for (const t of topics) {
      if (t.Text) parts.push(`- ${t.Text}${t.FirstURL ? `\n  🔗 ${t.FirstURL}` : ""}`);
    }
    if (parts.length === 0) return `Результаты по запросу "${query}" не найдены через DuckDuckGo API. Попробуй уточнить запрос.`;
    return parts.join("\n\n");
  } catch (e) {
    return `⚠️ Поиск временно недоступен: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/* ── fetch_url ───────────────────────────────────────────────────────── */
async function fetchUrlContent(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SYNAPSE-AGENT/1.0)" },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text.slice(0, 8000) + (text.length > 8000 ? "\n...[обрезано]" : "");
}

/* ── analyze_telegram_bot ────────────────────────────────────────────── */
async function analyzeTelegramBot(username: string): Promise<string> {
  const clean = username.replace(/^@/, "").trim();
  const parts: string[] = [];

  // 1. Telegram Bot API — getChat
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (botToken) {
    try {
      const apiRes = await fetch(
        `https://api.telegram.org/bot${botToken}/getChat?chat_id=@${clean}`,
        { signal: AbortSignal.timeout(8000) }
      );
      const apiData = await apiRes.json() as {
        ok: boolean;
        result?: {
          id?: number; first_name?: string; last_name?: string;
          username?: string; description?: string; bio?: string;
          type?: string;
        };
        description?: string;
      };
      if (apiData.ok && apiData.result) {
        const r = apiData.result;
        parts.push(
          `## 📋 Telegram API (@${clean})\n` +
          `- ID: ${r.id}\n` +
          `- Имя: ${r.first_name || ""}${r.last_name ? " " + r.last_name : ""}\n` +
          `- Тип: ${r.type || "bot"}` +
          (r.description ? `\n- Описание: ${r.description}` : "") +
          (r.bio ? `\n- Bio: ${r.bio}` : "")
        );
      } else {
        parts.push(`## 📋 Telegram API (@${clean})\n${apiData.description || "бот не найден или закрыт"}`);
      }
    } catch (e) {
      parts.push(`## 📋 Telegram API\n⚠️ ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    parts.push(`## 📋 Telegram API\nTELEGRAM_BOT_TOKEN не задан`);
  }

  // 2. Public t.me page — scrape description and preview text
  try {
    const raw = await fetchUrlContent(`https://t.me/${clean}`);
    // Extract only meaningful text (skip HTML boilerplate)
    const stripped = raw
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, "\n")
      .trim()
      .slice(0, 2000);
    parts.push(`## 🌐 Страница t.me/@${clean}\n${stripped}`);
  } catch (e) {
    parts.push(`## 🌐 t.me page\n⚠️ ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Parallel targeted web searches
  const searches = [
    `"@${clean}" telegram бот меню кнопки команды функционал`,
    `"@${clean}" telegram bot обзор как работает`,
    `site:tlgrm.ru OR site:telega.in OR site:tgstat.ru "@${clean}"`,
  ];
  const searchResults = await Promise.allSettled(searches.map(q => performWebSearch(q)));
  searchResults.forEach((res, i) => {
    if (res.status === "fulfilled") {
      parts.push(`## 🔍 Поиск ${i + 1}: ${searches[i]}\n${res.value.slice(0, 1500)}`);
    }
  });

  // 4. Try bot directories
  const directoryUrls = [
    `https://tlgrm.ru/bots/${clean}`,
    `https://tgstat.ru/bot/@${clean}`,
  ];
  const dirResults = await Promise.allSettled(directoryUrls.map(u => fetchUrlContent(u)));
  dirResults.forEach((res, i) => {
    if (res.status === "fulfilled") {
      const stripped = res.value
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{2,}/g, "\n")
        .trim()
        .slice(0, 1500);
      if (stripped.length > 100) {
        parts.push(`## 📚 Каталог: ${directoryUrls[i]}\n${stripped}`);
      }
    }
  });

  parts.push(
    `## ⚠️ ВАЖНО ДЛЯ КЛОНИРОВАНИЯ\n` +
    `Публичные источники дают только общее описание бота. Без скриншотов реального интерфейса клон будет приблизительным.\n` +
    `**Необходимые данные для точного клона:**\n` +
    `- Скриншоты КАЖДОГО экрана/меню бота\n` +
    `- Точные тексты всех кнопок (inline keyboard)\n` +
    `- Команды (/start, /help, и т.д.)\n` +
    `- Описание логики (что происходит при нажатии каждой кнопки)\n` +
    `- Какие данные бот хранит (товары, пользователи, заказы и т.д.)`
  );

  return parts.join("\n\n---\n\n");
}

/* ── crawl_telegram_bot ──────────────────────────────────────────────── */
async function crawlTelegramBot(username: string, sessionString: string): Promise<string> {
  const apiId = parseInt(process.env.TELEGRAM_API_ID || "0");
  const apiHash = process.env.TELEGRAM_API_HASH || "";

  if (!apiId || !apiHash) {
    return (
      "⚠️ Переменные окружения не заданы.\n\n" +
      "Необходимо установить:\n" +
      "- `TELEGRAM_API_ID` — числовой ID приложения\n" +
      "- `TELEGRAM_API_HASH` — хэш приложения\n\n" +
      "Получить их можно на https://my.telegram.org → API development tools"
    );
  }
  if (!sessionString || sessionString.trim().length < 10) {
    return "⚠️ Session string не передан или слишком короткий.";
  }

  // Dynamic import to avoid esbuild bundling issues
  const tgMod = await import("telegram") as any;
  const { TelegramClient, Api } = tgMod;
  const sessMod = await import("telegram/sessions/index.js") as any;
  const { StringSession } = sessMod;

  const session = new StringSession(sessionString.trim());
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 2,
    requestRetries: 2,
    autoReconnect: false,
  });

  try {
    await client.connect();
    const clean = username.replace(/^@/, "");
    const entity = await client.getEntity(clean);

    const results: string[] = [];
    const visited = new Set<string>();

    // Wait for bot response after action
    async function waitForBotMsg(lastId: number): Promise<any> {
      await new Promise(r => setTimeout(r, 2000));
      const msgs = await client.getMessages(entity, { limit: 5 });
      const botMsgs = (msgs as any[]).filter(
        (m: any) => !m.out && (m.id > lastId || lastId === 0)
      );
      return botMsgs[0] || null;
    }

    function describeMsg(msg: any, label: string): string {
      const text = (msg?.message || "(нет текста)").slice(0, 300);
      const rows = msg?.replyMarkup?.rows || [];
      const btnLines = (rows as any[]).map((row: any) =>
        (row.buttons as any[]).map((b: any) => `[${b.text || "?"}]`).join(" ")
      );
      return `### ${label}\n**Текст:** ${text}\n**Кнопки:** ${btnLines.join(" / ") || "(нет)"}`;
    }

    // Send /start and record response
    const preStartMsgs = await client.getMessages(entity, { limit: 1 }) as any[];
    const lastId = preStartMsgs[0]?.id || 0;
    await client.sendMessage(entity, { message: "/start" });
    const startMsg = await waitForBotMsg(lastId);
    if (!startMsg) {
      return "⚠️ Бот не ответил на /start в течение 2 секунд";
    }
    results.push(describeMsg(startMsg, "/start (главное меню)"));

    // Recursively click inline buttons
    async function crawlMsg(msg: any, depth: number, pathLabel: string) {
      if (depth > 2 || !msg?.replyMarkup?.rows) return;
      const rows: any[] = msg.replyMarkup.rows || [];

      for (const row of rows) {
        for (const btn of (row.buttons || []) as any[]) {
          const btnText: string = btn.text || "?";
          const key = `${pathLabel}::${btnText}`;
          if (visited.has(key)) continue;
          visited.add(key);

          try {
            const beforeMsgs = await client.getMessages(entity, { limit: 1 }) as any[];
            const beforeId = beforeMsgs[0]?.id || 0;

            if (btn.className === "KeyboardButtonCallback" && btn.data) {
              await client.invoke(new Api.messages.GetBotCallbackAnswer({
                peer: entity,
                msgId: msg.id,
                data: btn.data,
              }));
            } else {
              await client.sendMessage(entity, { message: btnText });
            }

            const resp = await waitForBotMsg(beforeId);
            if (resp && resp.id !== msg.id) {
              results.push(describeMsg(resp, `${pathLabel} → [${btnText}]`));
              await crawlMsg(resp, depth + 1, `${pathLabel} → [${btnText}]`);
            }
          } catch (e) {
            results.push(`⚠️ Кнопка [${btnText}]: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
    }

    await crawlMsg(startMsg, 0, "/start");

    return (
      `# 🕷️ Полная карта меню @${clean}\n\n` +
      `> Автоматически обойдено ${visited.size} кнопок, 3 уровня глубины\n\n` +
      results.join("\n\n---\n\n")
    );
  } finally {
    try { await client.disconnect(); } catch {}
  }
}

/* ── view_outline: extract symbols from a file ──────────────────────── */
async function viewOutline(filePath: string, chatRoot: string): Promise<string> {
  const absPath = safePath(filePath, chatRoot);
  const content = await fs.readFile(absPath, "utf-8");
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const lines = content.split("\n");
  const symbols: string[] = [];

  const pyFunc   = /^(\s*)(async\s+def|def)\s+(\w+)\s*\(/;
  const pyClass  = /^(\s*)class\s+(\w+)/;
  const jsFunc   = /^(\s*)(export\s+)?(async\s+)?function\s+(\w+)/;
  const jsClass  = /^(\s*)(export\s+)?class\s+(\w+)/;
  const jsArrow  = /^(\s*)(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s*)?\(/;
  const tsInterface = /^(\s*)(export\s+)?interface\s+(\w+)/;
  const tsType   = /^(\s*)(export\s+)?type\s+(\w+)\s*=/;
  const methodDef = /^(\s+)(async\s+)?(\w+)\s*\([^)]*\)\s*(\{|=>)/;

  lines.forEach((line, i) => {
    const ln = i + 1;
    if (["py"].includes(ext)) {
      let m;
      if ((m = pyClass.exec(line)))  symbols.push(`  ${ln.toString().padStart(4)}: 🏛️  class ${m[2]}`);
      else if ((m = pyFunc.exec(line))) {
        const indent = m[1].length > 0 ? "    " : "";
        const isAsync = m[2].startsWith("async") ? "async " : "";
        symbols.push(`${indent}${ln.toString().padStart(4)}: 🔧 ${isAsync}def ${m[3]}()`);
      }
    } else if (["js","ts","jsx","tsx","mjs","cjs"].includes(ext)) {
      let m;
      if ((m = jsClass.exec(line)))       symbols.push(`  ${ln.toString().padStart(4)}: 🏛️  class ${m[4] ?? m[3]}`);
      else if ((m = tsInterface.exec(line))) symbols.push(`  ${ln.toString().padStart(4)}: 📐 interface ${m[3]}`);
      else if ((m = tsType.exec(line)))   symbols.push(`  ${ln.toString().padStart(4)}: 🔷 type ${m[3]}`);
      else if ((m = jsFunc.exec(line)))   symbols.push(`  ${ln.toString().padStart(4)}: 🔧 function ${m[4]?? m[3]}()`);
      else if ((m = jsArrow.exec(line)))  symbols.push(`  ${ln.toString().padStart(4)}: 🔧 const ${m[4]}()`);
    } else {
      const genFunc = /^(\s*)(function|def|func|fn|sub|procedure)\s+(\w+)/i;
      const genClass = /^(\s*)(class|struct|interface)\s+(\w+)/i;
      let m;
      if ((m = genClass.exec(line)))  symbols.push(`  ${ln.toString().padStart(4)}: 🏛️  class ${m[3]}`);
      else if ((m = genFunc.exec(line))) symbols.push(`  ${ln.toString().padStart(4)}: 🔧 func ${m[3]}()`);
    }
    void methodDef;
  });

  if (symbols.length === 0) return `(В файле \`${filePath}\` не найдено функций/классов)`;
  return `Файл: ${filePath} (${lines.length} строк)\n\n${symbols.join("\n")}`;
}

/* ── grep_search: search files recursively ──────────────────────────── */
async function grepSearch(
  pattern: string, searchRoot: string, caseInsensitive: boolean
): Promise<string> {
  const flags = caseInsensitive ? "gi" : "g";
  let re: RegExp;
  try { re = new RegExp(pattern, flags); } catch { return `⚠️ Неверное регулярное выражение: ${pattern}`; }

  const SKIP = new Set(["node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build", ".next", "coverage"]);
  const MAX_RESULTS = 60;
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (results.length >= MAX_RESULTS) return;
    let entries: import("fs").Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) return;
      if (SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      const ext = entry.name.split(".").pop()?.toLowerCase() || "";
      if (["png","jpg","jpeg","gif","svg","pdf","zip","tar","gz","woff","woff2","ttf","eot","ico","webp","mp4","mp3","db","sqlite"].includes(ext)) continue;
      try {
        const text = await fs.readFile(full, "utf-8");
        const lines = text.split("\n");
        const relPath = path.relative(searchRoot, full);
        lines.forEach((line, i) => {
          if (results.length >= MAX_RESULTS) return;
          if (re.test(line)) {
            re.lastIndex = 0;
            results.push(`${relPath}:${i + 1}: ${line.trim().slice(0, 120)}`);
          }
          re.lastIndex = 0;
        });
      } catch { /* binary or unreadable */ }
    }
  }

  await walk(searchRoot);
  if (results.length === 0) return `Совпадений не найдено`;
  const header = results.length >= MAX_RESULTS ? `(показано первых ${MAX_RESULTS} из более)` : `(найдено совпадений: ${results.length})`;
  return `${header}\n\n\`\`\`\n${results.join("\n")}\n\`\`\``;
}

/* ── manage_env_vars: read/write .env file ──────────────────────────── */
async function manageEnvVars(
  action: string, key: string | undefined, value: string | undefined, chatRoot: string
): Promise<string> {
  const envPath = path.join(chatRoot, ".env");
  await fs.mkdir(chatRoot, { recursive: true });

  if (action === "list" || action === "get") {
    let envText = "";
    try { envText = await fs.readFile(envPath, "utf-8"); } catch { return action === "list" ? "Файл .env не найден" : `Переменная ${key} не найдена`; }
    if (action === "list") {
      const vars = envText.split("\n").filter(l => l.trim() && !l.startsWith("#")).map(l => {
        const [k] = l.split("=");
        return `  ${k?.trim() || l}`;
      });
      return vars.length ? `Переменные в .env:\n${vars.join("\n")}` : "Файл .env пуст";
    }
    const line = envText.split("\n").find(l => l.startsWith(`${key}=`));
    return line ? `${key}=[значение установлено]` : `Переменная ${key} не найдена`;
  }

  if (action === "set" && key) {
    let envText = "";
    try { envText = await fs.readFile(envPath, "utf-8"); } catch { envText = ""; }
    const lines = envText.split("\n");
    const idx = lines.findIndex(l => l.startsWith(`${key}=`));
    const newLine = `${key}=${value ?? ""}`;
    if (idx >= 0) lines[idx] = newLine; else lines.push(newLine);
    await fs.writeFile(envPath, lines.filter(l => l !== undefined).join("\n").trim() + "\n", "utf-8");
    return `✅ Переменная ${key} установлена в .env`;
  }

  if (action === "delete" && key) {
    let envText = "";
    try { envText = await fs.readFile(envPath, "utf-8"); } catch { return `Файл .env не найден`; }
    const newText = envText.split("\n").filter(l => !l.startsWith(`${key}=`)).join("\n");
    await fs.writeFile(envPath, newText, "utf-8");
    return `✅ Переменная ${key} удалена из .env`;
  }

  return `⚠️ Неизвестное действие: ${action}. Используйте list, get, set, delete`;
}

/* ── scan_secrets: detect hardcoded credentials ─────────────────────── */
async function scanSecrets(chatRoot: string): Promise<string> {
  const PATTERNS: { name: string; re: RegExp }[] = [
    { name: "API Key (общий)",      re: /(?:api[_-]?key|apikey)\s*=\s*["']?[A-Za-z0-9\-_.]{20,}["']?/i },
    { name: "Private Key / Secret", re: /(?:secret|private[_-]?key|signing[_-]?key)\s*=\s*["']?.{16,}["']?/i },
    { name: "Password hardcoded",   re: /(?:password|passwd|pwd)\s*=\s*["'][^'"]{6,}["']/i },
    { name: "Bearer Token",         re: /Bearer\s+[A-Za-z0-9\-_.~+/]{20,}/i },
    { name: "Basic Auth base64",    re: /Authorization:\s*Basic\s+[A-Za-z0-9+/=]{20,}/i },
    { name: "OpenAI / OpenRouter",  re: /sk-[A-Za-z0-9\-_]{20,}/ },
    { name: "GitHub Token",         re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
    { name: "Telegram Bot Token",   re: /\d{8,10}:[A-Za-z0-9\-_]{35,}/ },
    { name: "AWS Access Key",       re: /AKIA[0-9A-Z]{16}/ },
    { name: "Google API Key",       re: /AIza[0-9A-Za-z\-_]{35}/ },
    { name: "Private key PEM",      re: /-----BEGIN\s+(?:RSA\s+)?PRIVATE KEY-----/ },
  ];

  const SKIP = new Set(["node_modules", ".git", "__pycache__", ".venv", "venv", "dist", ".next"]);
  const findings: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: import("fs").Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (entry.name === ".env" || entry.name.endsWith(".key") || entry.name.endsWith(".pem")) {
        findings.push(`⚠️ **Файл с учётными данными**: \`${path.relative(chatRoot, full)}\``);
        continue;
      }
      const ext = (entry.name.split(".").pop() || "").toLowerCase();
      if (["png","jpg","gif","svg","pdf","zip","tar","gz","woff","woff2","ttf","eot","ico","webp","mp4","mp3","db","sqlite"].includes(ext)) continue;
      try {
        const text = await fs.readFile(full, "utf-8");
        const lines = text.split("\n");
        lines.forEach((line, i) => {
          for (const { name, re } of PATTERNS) {
            if (re.test(line)) {
              const rel = path.relative(chatRoot, full);
              findings.push(`🚨 **${name}** в \`${rel}\` (строка ${i + 1}): \`${line.trim().slice(0, 80)}\``);
              break;
            }
          }
        });
      } catch { /* binary */ }
    }
  }

  await walk(chatRoot);
  if (findings.length === 0) return "✅ Секреты не обнаружены — всё чисто!";
  return `Найдено потенциальных утечек: **${findings.length}**\n\n${findings.join("\n")}`;
}

/* ── git_commit_and_push ─────────────────────────────────────────────── */
async function gitCommitAndPush(
  chatRoot: string, branch: string, message: string, repo: string, githubToken: string
): Promise<string> {
  await fs.mkdir(chatRoot, { recursive: true });
  const run = (cmd: string) => execAsync(cmd, { cwd: chatRoot, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });

  try { await fs.access(path.join(chatRoot, ".git")); }
  catch { await run("git init"); await run(`git config user.email "synapse@agent.app"`); await run(`git config user.name "SYNAPSE AGENT"`); }

  const remoteUrl = `https://oauth2:${githubToken}@github.com/${repo}.git`;
  try { await run("git remote get-url origin"); await run(`git remote set-url origin "${remoteUrl}"`); }
  catch { await run(`git remote add origin "${remoteUrl}"`); }

  try { await run(`git checkout -b "${branch}"`); }
  catch { await run(`git checkout "${branch}"`); }

  await run("git add -A");

  const { stdout: status } = await run("git status --porcelain").catch(() => ({ stdout: "" }));
  if (!status.trim()) return "ℹ️ Нет изменений для коммита";

  await run(`git commit -m "${message.replace(/"/g, '\\"')}"`);

  try {
    await run(`git push -u origin "${branch}"`);
    return `✅ Запушено в ветку **${branch}** репозитория \`${repo}\`\n\nПросмотр: https://github.com/${repo}/tree/${branch}`;
  } catch (e) {
    return `✅ Коммит создан локально.\n⚠️ Push не удался: ${e instanceof Error ? e.message : String(e)}\n\nПроверьте токен GitHub в Настройках.`;
  }
}

/* ── create_pull_request ─────────────────────────────────────────────── */
async function createPullRequest(
  repo: string, title: string, body: string, head: string, base: string, token: string
): Promise<string> {
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) return `⚠️ Неверный формат репозитория. Используй: owner/repo`;
  const resp = await fetch(`https://api.github.com/repos/${owner}/${repoName}/pulls`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, body, head, base }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({})) as { message?: string };
    return `⚠️ Ошибка создания PR: ${resp.status} ${err.message || ""}`;
  }
  const pr = await resp.json() as { html_url: string; number: number };
  return `✅ Pull Request #${pr.number} создан!\n🔗 ${pr.html_url}`;
}

/* ── run_tests ──────────────────────────────────────────────────────── */
async function runTests(command: string, chatRoot: string): Promise<string> {
  await fs.mkdir(chatRoot, { recursive: true });
  try {
    const { stdout, stderr } = await execAsync(command, { cwd: chatRoot, timeout: 120000 });
    const output = (stdout + stderr).slice(0, 4000);
    return `✅ Тесты прошли\n\`\`\`\n${output || "(нет вывода)"}\n\`\`\``;
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output = ((err.stdout || "") + (err.stderr || "") || err.message || String(e)).slice(0, 4000);
    return `❌ Тесты упали\n\`\`\`\n${output}\n\`\`\``;
  }
}

/* ── diff_file ───────────────────────────────────────────────────────── */
async function diffFile(filePath: string, chatRoot: string): Promise<string> {
  try {
    const absPath = filePath === "." ? chatRoot : safePath(filePath, chatRoot);
    const relPath = path.relative(chatRoot, absPath);
    await fs.access(path.join(chatRoot, ".git"));
    const { stdout } = await execAsync(`git diff HEAD -- "${relPath}"`, { cwd: chatRoot, timeout: 10000 });
    if (!stdout.trim()) return `(Нет изменений в \`${filePath}\` относительно HEAD)`;
    return `\`\`\`diff\n${stdout.slice(0, 8000)}\n\`\`\``;
  } catch {
    try {
      const { stdout } = await execAsync("git status --short", { cwd: chatRoot, timeout: 5000 });
      return stdout.trim() ? `\`\`\`\n${stdout}\n\`\`\`` : `(Репозиторий чистый — нет изменений)`;
    } catch {
      return `⚠️ git не инициализирован в рабочей директории. Используй <git_commit_and_push> для инициализации.`;
    }
  }
}

/* ── lint_file ───────────────────────────────────────────────────────── */
async function lintFile(filePath: string, chatRoot: string): Promise<string> {
  const absPath = safePath(filePath, chatRoot);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  let cmd: string;
  if (ext === "py") {
    cmd = `python -m ruff check "${absPath}" --output-format text 2>&1 || python -m flake8 "${absPath}" 2>&1`;
  } else if (["js","ts","jsx","tsx","mjs","cjs"].includes(ext)) {
    cmd = `npx eslint "${absPath}" --format compact 2>&1`;
  } else {
    return `⚠️ Линтер не поддерживает файлы .${ext || "(без расширения)"}`;
  }
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd: chatRoot, timeout: 30000, shell: true });
    const output = (stdout + stderr).trim();
    if (!output) return `✅ Ошибок не найдено в \`${filePath}\``;
    return `\`\`\`\n${output.slice(0, 4000)}\n\`\`\``;
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    const out = ((err.stdout || "") + (err.stderr || "")).trim();
    return out ? `\`\`\`\n${out.slice(0, 4000)}\n\`\`\`` : `⚠️ Линтер не найден. Установи: \`pip install ruff\` (Python) или \`npm install -g eslint\` (JS/TS)`;
  }
}

/* ── install_package ─────────────────────────────────────────────────── */
async function installPackage(name: string, manager: string, chatRoot: string): Promise<string> {
  await fs.mkdir(chatRoot, { recursive: true });
  const cmds: Record<string, string> = {
    pip: `pip install ${name}`, pip3: `pip3 install ${name}`,
    npm: `npm install ${name}`, yarn: `yarn add ${name}`, pnpm: `pnpm add ${name}`,
  };
  const cmd = cmds[manager.toLowerCase()];
  if (!cmd) return `⚠️ Неизвестный менеджер пакетов: ${manager}. Используй: pip, npm, yarn, pnpm`;
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd: chatRoot, timeout: 90000 });
    const output = (stdout + stderr).slice(0, 2000);
    return `✅ \`${name}\` установлен\n\`\`\`\n${output}\n\`\`\``;
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return `⚠️ Ошибка установки:\n\`\`\`\n${((err.stdout || "") + (err.stderr || "") || err.message || "").slice(0, 1500)}\n\`\`\``;
  }
}

/* ── check_dependencies ──────────────────────────────────────────────── */
async function checkDependencies(file: string, chatRoot: string): Promise<string> {
  let cmd: string;
  if (file.endsWith("package.json") || file === "npm") {
    cmd = "npm outdated 2>&1 || echo '(npm outdated завершился с ненулевым кодом)'";
  } else if (file.endsWith("requirements.txt") || file === "pip") {
    cmd = "pip list --outdated --format=columns 2>&1";
  } else {
    const hasPkg = await fs.access(path.join(chatRoot, "package.json")).then(() => true).catch(() => false);
    cmd = hasPkg ? "npm outdated 2>&1" : "pip list --outdated --format=columns 2>&1";
  }
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd: chatRoot, timeout: 60000, shell: true });
    const out = (stdout + stderr).trim();
    return out ? `\`\`\`\n${out.slice(0, 3000)}\n\`\`\`` : `✅ Все зависимости актуальны`;
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    const out = ((err.stdout || "") + (err.stderr || "")).trim();
    return out ? `\`\`\`\n${out.slice(0, 3000)}\n\`\`\`` : `⚠️ ${e instanceof Error ? e.message : String(e)}`;
  }
}

/* ── audit_dependencies ──────────────────────────────────────────────── */
async function auditDependencies(manager: string, chatRoot: string): Promise<string> {
  const cmd = manager === "pip"
    ? "pip-audit 2>&1 || safety check 2>&1 || echo 'Установи pip-audit: pip install pip-audit'"
    : "npm audit 2>&1";
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd: chatRoot, timeout: 60000, shell: true });
    const out = (stdout + stderr).trim();
    return out ? `\`\`\`\n${out.slice(0, 4000)}\n\`\`\`` : `✅ Уязвимостей не найдено`;
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    const out = ((err.stdout || "") + (err.stderr || "")).trim();
    return out ? `\`\`\`\n${out.slice(0, 4000)}\n\`\`\`` : `⚠️ Пакетный менеджер недоступен`;
  }
}

/* ── check_port ──────────────────────────────────────────────────────── */
async function checkPort(portNumber: number): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `lsof -ti :${portNumber} 2>/dev/null | head -5 || ss -tlnp 2>/dev/null | grep ':${portNumber}'`,
      { shell: true, timeout: 5000 }
    );
    if (!stdout.trim()) return `✅ Порт ${portNumber} свободен`;
    return `🔴 Порт **${portNumber}** занят\n\`\`\`\nPID: ${stdout.trim()}\n\`\`\``;
  } catch {
    return `✅ Порт ${portNumber} свободен`;
  }
}

/* ── Execute all tool calls found in model output ───────────────────── */
async function executeTools(
  fullContent: string, chatRoot: string
): Promise<{ hasTools: boolean; toolResults: string; statusMessages: string[] }> {
  const statusMessages: string[] = [];
  const resultParts: string[] = [];

  // list_files (optional path param)
  const listMatches = [...fullContent.matchAll(/<list_files(?:\s+path="([^"]*)")?\s*\/>/g)];
  if (listMatches.length) {
    statusMessages.push("Просматриваю файлы...");
    for (const m of listMatches) {
      const subDir = m[1] || "";
      const targetDir = subDir ? path.join(chatRoot, subDir) : chatRoot;
      try {
        const tree = await buildFileTree(targetDir, "", 0);
        const header = subDir ? `📁 list_files("${subDir}")` : "📁 list_files(workspace)";
        resultParts.push(`### ${header}\n\`\`\`\n${tree.trim() || "(пустая папка)"}\n\`\`\``);
      } catch {
        resultParts.push(`### 📁 list_files: рабочая папка пуста или не существует`);
      }
    }
  }

  // read_file
  const readMatches = [...fullContent.matchAll(/<read_file\s+path="([^"]+)"\s*\/>/g)];
  if (readMatches.length) {
    statusMessages.push("Читаю файлы...");
    for (const m of readMatches) {
      const relPath = m[1];
      try {
        const absPath = safePath(relPath, chatRoot);
        const stat = await fs.stat(absPath);
        const MAX_SIZE = 200 * 1024;
        const MAX_CHARS = 15000;
        if (stat.size > MAX_SIZE) {
          resultParts.push(`### 📄 read_file("${relPath}")\n⚠️ Файл слишком большой: ${Math.round(stat.size / 1024)}KB (лимит 200KB)`);
          continue;
        }
        const ext = path.extname(relPath).slice(1) || "txt";
        let fileContent = await fs.readFile(absPath, "utf-8");
        let truncated = false;
        if (fileContent.length > MAX_CHARS) { fileContent = fileContent.slice(0, MAX_CHARS); truncated = true; }
        const note = truncated ? `\n\n... [обрезано до ${MAX_CHARS} символов из ${stat.size} байт]` : "";
        resultParts.push(`### 📄 read_file("${relPath}")\n\`\`\`${ext}\n${fileContent}${note}\n\`\`\``);
      } catch {
        resultParts.push(`### 📄 read_file("${relPath}")\n⚠️ Файл не найден`);
      }
    }
  }

  // web_search
  const searchMatches = [...fullContent.matchAll(/<web_search\s+query="([^"]+)"\s*\/>/g)];
  if (searchMatches.length) {
    statusMessages.push("Ищу в интернете...");
    for (const m of searchMatches) {
      const query = m[1];
      try {
        const results = await performWebSearch(query);
        resultParts.push(`### 🔍 web_search("${query}")\n${results}`);
      } catch (e) {
        resultParts.push(`### 🔍 web_search("${query}")\n⚠️ Ошибка поиска: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // fetch_url
  const fetchMatches = [...fullContent.matchAll(/<fetch_url\s+url="([^"]+)"\s*\/>/g)];
  if (fetchMatches.length) {
    statusMessages.push("Загружаю страницу...");
    for (const m of fetchMatches) {
      const url = m[1];
      try {
        const pageContent = await fetchUrlContent(url);
        resultParts.push(`### 🌐 fetch_url("${url}")\n\`\`\`\n${pageContent}\n\`\`\``);
      } catch (e) {
        resultParts.push(`### 🌐 fetch_url("${url}")\n⚠️ Ошибка загрузки: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // analyze_telegram_bot
  const tgBotMatches = [...fullContent.matchAll(/<analyze_telegram_bot\s+username="([^"]+)"\s*\/>/g)];
  if (tgBotMatches.length) {
    statusMessages.push("Анализирую Telegram-бота...");
    for (const m of tgBotMatches) {
      const username = m[1];
      try {
        const botInfo = await analyzeTelegramBot(username);
        resultParts.push(`### 🤖 analyze_telegram_bot("${username}")\n${botInfo}`);
      } catch (e) {
        resultParts.push(`### 🤖 analyze_telegram_bot("${username}")\n⚠️ Ошибка: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // crawl_telegram_bot
  const crawlBotMatches = [...fullContent.matchAll(/<crawl_telegram_bot\s+username="([^"]+)"\s+session="([^"]+)"\s*\/>/g)];
  if (crawlBotMatches.length) {
    statusMessages.push("Подключаюсь к Telegram и обхожу меню бота...");
    for (const m of crawlBotMatches) {
      const username = m[1];
      const session = m[2];
      try {
        const crawlResult = await crawlTelegramBot(username, session);
        resultParts.push(`### 🕷️ crawl_telegram_bot("${username}")\n${crawlResult}`);
      } catch (e) {
        resultParts.push(`### 🕷️ crawl_telegram_bot("${username}")\n⚠️ Ошибка: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // view_outline
  const outlineMatches = [...fullContent.matchAll(/<view_outline\s+path="([^"]+)"\s*\/>/g)];
  if (outlineMatches.length) {
    statusMessages.push("Анализирую структуру кода...");
    for (const m of outlineMatches) {
      const relPath = m[1];
      try {
        const outline = await viewOutline(relPath, chatRoot);
        resultParts.push(`### 🗂️ view_outline("${relPath}")\n\`\`\`\n${outline}\n\`\`\``);
      } catch (e) {
        resultParts.push(`### 🗂️ view_outline("${relPath}")\n⚠️ ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // grep_search
  const grepMatches = [...fullContent.matchAll(/<grep_search\s+pattern="([^"]+)"(?:\s+path="([^"]*)")?(?:\s+case_sensitive="(true|false)")?\s*\/>/g)];
  if (grepMatches.length) {
    statusMessages.push("Ищу по кодовой базе...");
    for (const m of grepMatches) {
      const pattern = m[1];
      const subPath = m[2] || ".";
      const caseInsensitive = m[3] !== "true";
      try {
        const targetDir = subPath === "." ? chatRoot : safePath(subPath, chatRoot);
        const found = await grepSearch(pattern, targetDir, caseInsensitive);
        resultParts.push(`### 🔎 grep_search("${pattern}"${subPath !== "." ? `, "${subPath}"` : ""})\n${found}`);
      } catch (e) {
        resultParts.push(`### 🔎 grep_search("${pattern}")\n⚠️ ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // manage_env_vars
  const envMatches = [...fullContent.matchAll(/<manage_env_vars\s+action="([^"]+)"(?:\s+key="([^"]*)")?(?:\s+value="([^"]*)"\s*)?\s*\/>/g)];
  if (envMatches.length) {
    statusMessages.push("Обновляю .env...");
    for (const m of envMatches) {
      const action = m[1];
      const key = m[2];
      const value = m[3];
      try {
        const result = await manageEnvVars(action, key, value, chatRoot);
        resultParts.push(`### 🔐 manage_env_vars(action="${action}"${key ? `, key="${key}"` : ""})\n${result}`);
      } catch (e) {
        resultParts.push(`### 🔐 manage_env_vars\n⚠️ ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // scan_secrets
  if (/<scan_secrets\s*\/>/.test(fullContent)) {
    statusMessages.push("Сканирую на секреты...");
    try {
      const scanResult = await scanSecrets(chatRoot);
      resultParts.push(`### 🛡️ scan_secrets\n${scanResult}`);
    } catch (e) {
      resultParts.push(`### 🛡️ scan_secrets\n⚠️ ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // git_commit_and_push
  const gitPushMatches = [...fullContent.matchAll(/<git_commit_and_push\s+branch="([^"]+)"\s+message="([^"]+)"(?:\s+repo="([^"]+)")?\s*\/>/g)];
  if (gitPushMatches.length) {
    statusMessages.push("Отправляю в Git...");
    const githubToken = await db.select().from(settingsTable).where(eq(settingsTable.key, "github_token"))
      .then(r => r[0]?.value || "").catch(() => "");
    for (const m of gitPushMatches) {
      const branch = m[1]; const message = m[2]; const repo = m[3] || "";
      if (!githubToken) { resultParts.push(`### 🔀 git_commit_and_push\n⚠️ Токен GitHub не настроен. Добавь его в Настройках.`); continue; }
      if (!repo) { resultParts.push(`### 🔀 git_commit_and_push\n⚠️ Не указан репозиторий. Формат: repo="owner/name"`); continue; }
      try {
        const result = await gitCommitAndPush(chatRoot, branch, message, repo, githubToken);
        resultParts.push(`### 🔀 git_commit_and_push(branch="${branch}")\n${result}`);
      } catch (e) {
        resultParts.push(`### 🔀 git_commit_and_push\n⚠️ ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // create_pull_request
  const prMatches = [...fullContent.matchAll(/<create_pull_request\s+title="([^"]+)"\s+body="([^"]+)"\s+head="([^"]+)"(?:\s+base="([^"]+)")?(?:\s+repo="([^"]+)")?\s*\/>/g)];
  if (prMatches.length) {
    statusMessages.push("Создаю Pull Request...");
    const githubToken = await db.select().from(settingsTable).where(eq(settingsTable.key, "github_token"))
      .then(r => r[0]?.value || "").catch(() => "");
    for (const m of prMatches) {
      const title = m[1]; const body = m[2]; const head = m[3]; const base = m[4] || "main"; const repo = m[5] || "";
      if (!githubToken) { resultParts.push(`### 🔀 create_pull_request\n⚠️ Токен GitHub не настроен.`); continue; }
      if (!repo) { resultParts.push(`### 🔀 create_pull_request\n⚠️ Не указан репозиторий. Формат: repo="owner/name"`); continue; }
      try {
        const result = await createPullRequest(repo, title, body, head, base, githubToken);
        resultParts.push(`### 🔀 create_pull_request(head="${head}" → base="${base}")\n${result}`);
      } catch (e) {
        resultParts.push(`### 🔀 create_pull_request\n⚠️ ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // run_tests
  const testMatches = [...fullContent.matchAll(/<run_tests(?:\s+command="([^"]+)")?(?:\s+framework="([^"]+)")?\s*\/>/g)];
  if (testMatches.length) {
    statusMessages.push("Запускаю тесты...");
    for (const m of testMatches) {
      const customCmd = m[1];
      const framework = m[2] || "auto";
      let cmd = customCmd;
      if (!cmd) {
        if (framework === "pytest" || framework === "python") cmd = "python -m pytest -v 2>&1";
        else if (framework === "npm") cmd = "npm test 2>&1";
        else if (framework === "go") cmd = "go test ./... 2>&1";
        else if (framework === "cargo") cmd = "cargo test 2>&1";
        else cmd = "python -m pytest -v 2>&1 || npm test 2>&1";
      }
      try {
        const result = await runTests(cmd, chatRoot);
        resultParts.push(`### 🧪 run_tests(${framework !== "auto" ? framework : cmd.split(" ")[0]})\n${result}`);
      } catch (e) {
        resultParts.push(`### 🧪 run_tests\n⚠️ ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // diff_file
  const diffMatches = [...fullContent.matchAll(/<diff_file\s+path="([^"]+)"\s*\/>/g)];
  if (diffMatches.length) {
    statusMessages.push("Получаю git diff...");
    for (const m of diffMatches) {
      const relPath = m[1];
      try {
        const result = await diffFile(relPath, chatRoot);
        resultParts.push(`### 📝 diff_file("${relPath}")\n${result}`);
      } catch (e) {
        resultParts.push(`### 📝 diff_file("${relPath}")\n⚠️ ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // lint_file
  const lintMatches = [...fullContent.matchAll(/<lint_file\s+path="([^"]+)"\s*\/>/g)];
  if (lintMatches.length) {
    statusMessages.push("Запускаю линтер...");
    for (const m of lintMatches) {
      const relPath = m[1];
      try {
        const result = await lintFile(relPath, chatRoot);
        resultParts.push(`### 🔍 lint_file("${relPath}")\n${result}`);
      } catch (e) {
        resultParts.push(`### 🔍 lint_file("${relPath}")\n⚠️ ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // install_package
  const installMatches = [...fullContent.matchAll(/<install_package\s+name="([^"]+)"(?:\s+manager="([^"]+)")?\s*\/>/g)];
  if (installMatches.length) {
    statusMessages.push("Устанавливаю пакеты...");
    for (const m of installMatches) {
      const name = m[1]; const manager = m[2] || "pip";
      try {
        const result = await installPackage(name, manager, chatRoot);
        resultParts.push(`### 📦 install_package("${name}", manager="${manager}")\n${result}`);
      } catch (e) {
        resultParts.push(`### 📦 install_package("${name}")\n⚠️ ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // check_dependencies
  const checkDepMatches = [...fullContent.matchAll(/<check_dependencies(?:\s+file="([^"]+)")?\s*\/>/g)];
  if (checkDepMatches.length) {
    statusMessages.push("Проверяю зависимости...");
    for (const m of checkDepMatches) {
      const file = m[1] || "auto";
      try {
        const result = await checkDependencies(file, chatRoot);
        resultParts.push(`### 📦 check_dependencies${file !== "auto" ? `("${file}")` : ""}\n${result}`);
      } catch (e) {
        resultParts.push(`### 📦 check_dependencies\n⚠️ ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // audit_dependencies
  const auditMatches = [...fullContent.matchAll(/<audit_dependencies(?:\s+manager="([^"]+)")?\s*\/>/g)];
  if (auditMatches.length) {
    statusMessages.push("Аудит безопасности...");
    for (const m of auditMatches) {
      const manager = m[1] || "npm";
      try {
        const result = await auditDependencies(manager, chatRoot);
        resultParts.push(`### 🛡️ audit_dependencies(manager="${manager}")\n${result}`);
      } catch (e) {
        resultParts.push(`### 🛡️ audit_dependencies\n⚠️ ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // check_port
  const portMatches = [...fullContent.matchAll(/<check_port\s+number="(\d+)"\s*\/>/g)];
  if (portMatches.length) {
    statusMessages.push("Проверяю порты...");
    for (const m of portMatches) {
      const port = parseInt(m[1]);
      try {
        const result = await checkPort(port);
        resultParts.push(`### 🔌 check_port(${port})\n${result}`);
      } catch (e) {
        resultParts.push(`### 🔌 check_port(${port})\n⚠️ ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const hasTools = resultParts.length > 0;
  const toolResults = hasTools ? `## Результаты инструментов\n\n${resultParts.join("\n\n---\n\n")}` : "";
  return { hasTools, toolResults, statusMessages };
}

async function getApiKey(): Promise<string | null> {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  try {
    const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, "openrouter_key"));
    return rows[0]?.value || null;
  } catch {
    return null;
  }
}

function safePath(p: string, chatRoot: string): string {
  const resolved = path.isAbsolute(p) ? path.resolve(p) : path.resolve(chatRoot, p);
  if (!resolved.startsWith(path.resolve(WORKSPACE_ROOT))) {
    throw new Error("Path traversal not allowed");
  }
  return resolved;
}

/** Generate a short title from user's first message */
async function generateTitle(userMessage: string, apiKey: string): Promise<string | null> {
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://synapse-agent.replit.app",
        "X-Title": "SYNAPSE AGENT",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        messages: [
          {
            role: "user",
            content: `Create a short 3-5 word title in Russian for a chat that starts with this message. Reply with ONLY the title, no quotes, no punctuation at the end:\n\n"${userMessage.slice(0, 300)}"`,
          },
        ],
        max_tokens: 20,
        stream: false,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    return raw.replace(/^["'«»]|["'«»]$/g, "").trim().slice(0, 60) || null;
  } catch {
    return null;
  }
}

const MODE_SUFFIXES: Record<string, string> = {
  chat: "\n\n## CURRENT MODE: CHAT\nThe user wants to have a conversation or ask a question. Discuss, explain, and advise — don't write code unless explicitly asked.",
  plan: "\n\n## CURRENT MODE: PLAN\nThe user wants you to PLAN before acting. Think step-by-step, explain your architecture and approach clearly, list what files you will create and why — but do NOT write the actual code yet. Wait for the user to confirm the plan.",
  build: "\n\n## CURRENT MODE: BUILD\nThe user wants you to BUILD immediately. Jump straight into implementation — create all necessary files using <create_file> tags without asking for permission. Write complete, working code.",
};

const THINKING_SUFFIXES: Record<string, string> = {
  auto: "",
  t1: "\n\n## THINKING LEVEL: FAST (T1)\nGive a quick, concise answer. Don't over-explain. Prioritize speed and brevity.",
  t2: "\n\n## THINKING LEVEL: DEEP (T2)\nThink carefully and thoroughly. Consider edge cases, potential issues, and alternative approaches before responding.",
  t3: "\n\n## THINKING LEVEL: ARCHITECT (T3)\nThink like a senior software architect. Consider scalability, maintainability, design patterns, security, and long-term implications. Explain trade-offs.",
  t4: "\n\n## THINKING LEVEL: COUNCIL (T4)\nAnalyze the problem from multiple expert perspectives: security engineer, performance engineer, UX designer, and product manager. Synthesize insights from all angles.",
};

router.post("/chats/:id/stream", requireAuth, async (req, res) => {
  const rawId = req.params.id;
  const chatId = parseInt(Array.isArray(rawId) ? rawId[0] : rawId);
  const { content, images, mode, thinkingLevel } = req.body as {
    content: string;
    images?: string[];
    mode?: string;
    thinkingLevel?: string;
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const [chat] = await db.select().from(chatsTable).where(eq(chatsTable.id, chatId));
    if (!chat) {
      send({ type: "error", content: "Чат не найден" });
      res.end();
      return;
    }

    const chatRoot = path.join(WORKSPACE_ROOT, "chat-workspaces", `chat-${chatId}`);
    const apiKey = await getApiKey();

    if (!content?.trim()) {
      send({ type: "error", content: "Сообщение не может быть пустым" });
      res.end();
      return;
    }

    const [userMsg] = await db.insert(messagesTable).values({
      chatId,
      role: "user",
      content,
      tokensUsed: estimateTokens(content),
    }).returning();

    send({ type: "user_message", message: { ...userMsg, createdAt: userMsg.createdAt.toISOString() } });

    const isDefaultTitle = chat.title === "Новый чат" || chat.title === "New Chat";
    if (isDefaultTitle && apiKey) {
      generateTitle(content, apiKey).then(title => {
        if (!title) return;
        return db.update(chatsTable)
          .set({ title })
          .where(eq(chatsTable.id, chatId))
          .then(() => {
            try { send({ type: "title", title }); } catch { /* stream may be closed */ }
          });
      }).catch(() => {});
    }

    if (!apiKey) {
      const errContent = "Токен OpenRouter API не настроен. Пожалуйста, добавь ключ в Настройках (кнопка внизу боковой панели).";
      const [assistantMsg] = await db.insert(messagesTable).values({
        chatId, role: "assistant", content: errContent, tokensUsed: 0, status: "error",
      }).returning();
      send({ type: "chunk", content: errContent });
      send({ type: "done", tokens: 0, message: { ...assistantMsg, createdAt: assistantMsg.createdAt.toISOString() } });
      res.end();
      return;
    }

    send({ type: "status", status: "Думаю..." });

    const history = await db.select().from(messagesTable)
      .where(eq(messagesTable.chatId, chatId))
      .orderBy(messagesTable.createdAt);

    const modelRow = await db.select().from(settingsTable).where(eq(settingsTable.key, "default_model"));
    const activeModel = modelRow[0]?.value || "anthropic/claude-3.5-sonnet";

    if (chat.model !== activeModel) {
      await db.update(chatsTable).set({ model: activeModel }).where(eq(chatsTable.id, chatId));
    }
    send({ type: "model", model: activeModel });

    type TextPart = { type: "text"; text: string };
    type ImagePart = { type: "image_url"; image_url: { url: string } };
    type MsgContent = string | (TextPart | ImagePart)[];

    const currentUserContent: MsgContent = (images && images.length > 0)
      ? [
          ...images.map((url): ImagePart => ({ type: "image_url", image_url: { url } })),
          { type: "text", text: content },
        ]
      : content;

    const modeSuffix = MODE_SUFFIXES[mode || "build"] ?? MODE_SUFFIXES.build;
    const thinkingSuffix = THINKING_SUFFIXES[thinkingLevel || "auto"] ?? "";
    const effectiveSystemPrompt = AGENT_SYSTEM_PROMPT + modeSuffix + thinkingSuffix;

    const priorHistory = history.slice(0, -1);
    const messages: { role: string; content: MsgContent }[] = [
      { role: "system", content: effectiveSystemPrompt },
      ...priorHistory.map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: currentUserContent },
    ];

    send({ type: "status", status: "Подключаюсь к AI..." });

    const abort1 = new AbortController();
    const timeout1 = setTimeout(() => abort1.abort(), 120_000);

    let response: Response;
    try {
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: abort1.signal,
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://synapse-agent.replit.app",
          "X-Title": "SYNAPSE AGENT",
        },
        body: JSON.stringify({
          model: activeModel,
          messages,
          stream: true,
          max_tokens: 16384,
        }),
      });
    } catch (fetchErr) {
      clearTimeout(timeout1);
      const isTimeout = fetchErr instanceof Error && fetchErr.name === "AbortError";
      send({ type: "error", content: isTimeout
        ? "⏱️ Таймаут: модель не ответила за 2 минуты. Попробуй другую модель или повтори запрос."
        : `Ошибка подключения: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`
      });
      res.end();
      return;
    }
    clearTimeout(timeout1);

    if (!response.ok || !response.body) {
      const errText = await response.text();
      send({ type: "error", content: `Ошибка OpenRouter: ${response.status} ${errText.slice(0, 500)}` });
      res.end();
      return;
    }

    let fullContent = "";
    let tokenCount = 0;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let writingFile = false;
    let lastWrittenFile = "";
    let filesWritten = 0;

    send({ type: "status", status: "Генерирую ответ..." });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as {
            choices?: { delta?: { content?: string }; finish_reason?: string }[];
            usage?: { total_tokens?: number };
          };

          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            tokenCount += estimateTokens(delta);

            const openTagMatch = fullContent.match(/<create_file\s+path="([^"]+)">/g);
            const closeCount = (fullContent.match(/<\/create_file>/g) || []).length;
            const openCount = openTagMatch ? openTagMatch.length : 0;
            const inFileNow = openCount > closeCount;

            if (inFileNow && !writingFile) {
              writingFile = true;
              const allOpens = [...fullContent.matchAll(/<create_file\s+path="([^"]+)">/g)];
              const currentFile = allOpens[allOpens.length - 1]?.[1] || "";
              lastWrittenFile = currentFile;
              filesWritten = openCount;
              const label = currentFile ? `Записываю ${currentFile}...` : "Пишу код файла...";
              send({ type: "status", status: label });
            } else if (!inFileNow && writingFile) {
              writingFile = false;
              const doneLabel = lastWrittenFile ? `${lastWrittenFile} готов ✓` : "Файл готов ✓";
              send({ type: "status", status: doneLabel });
            } else if (inFileNow && writingFile && openCount > filesWritten) {
              filesWritten = openCount;
              const allOpens = [...fullContent.matchAll(/<create_file\s+path="([^"]+)">/g)];
              const currentFile = allOpens[allOpens.length - 1]?.[1] || "";
              lastWrittenFile = currentFile;
              const label = currentFile ? `Записываю ${currentFile}...` : "Пишу код файла...";
              send({ type: "status", status: label });
            }

            send({ type: "chunk", content: delta });
          }

          if (parsed.usage?.total_tokens) {
            tokenCount = parsed.usage.total_tokens;
          }
        } catch { /* ignore malformed chunks */ }
      }
    }

    // Execute all tool calls found in model output
    const { hasTools, toolResults, statusMessages } = await executeTools(fullContent, chatRoot);

    if (hasTools) {
      for (const s of statusMessages) send({ type: "status", status: s });

      await db.insert(messagesTable).values({
        chatId, role: "assistant", content: fullContent, tokensUsed: tokenCount, status: "done",
      });

      send({ type: "status", status: "Обрабатываю результаты..." });

      const messagesWithTools: { role: string; content: MsgContent }[] = [
        { role: "system", content: effectiveSystemPrompt },
        ...history.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
        { role: "user", content: currentUserContent },
        { role: "assistant", content: fullContent },
        { role: "user", content: toolResults },
      ];

      const abort2 = new AbortController();
      const timeout2 = setTimeout(() => abort2.abort(), 120_000);
      let toolResponse: Response | null = null;
      try {
        toolResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          signal: abort2.signal,
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://synapse-agent.replit.app",
            "X-Title": "SYNAPSE AGENT",
          },
          body: JSON.stringify({ model: activeModel, messages: messagesWithTools, stream: true, max_tokens: 16384 }),
        });
      } catch {
        send({ type: "status", status: "⏱️ Таймаут финального ответа" });
      }
      clearTimeout(timeout2);

      if (toolResponse && toolResponse.ok && toolResponse.body) {
        send({ type: "status", status: "Генерирую финальный ответ..." });
        fullContent = "";
        tokenCount = 0;
        const toolReader = toolResponse.body.getReader();
        const toolDecoder = new TextDecoder();
        let toolBuf = "";
        writingFile = false;

        while (true) {
          const { done, value } = await toolReader.read();
          if (done) break;
          toolBuf += toolDecoder.decode(value, { stream: true });
          const lines = toolBuf.split("\n");
          toolBuf = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: { total_tokens?: number } };
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                tokenCount += estimateTokens(delta);
                const inFileNow = fullContent.includes("<create_file") && !fullContent.includes("</create_file>");
                if (inFileNow && !writingFile) { writingFile = true; send({ type: "status", status: "Пишу код файла..." }); }
                else if (!inFileNow && writingFile && fullContent.includes("</create_file>")) { writingFile = false; send({ type: "status", status: "Файл готов ✓" }); }
                send({ type: "chunk", content: delta });
              }
              if (parsed.usage?.total_tokens) tokenCount = parsed.usage.total_tokens;
            } catch { /* ignore */ }
          }
        }
      }
    }

    // Auto-create files on the server side after streaming
    const fileRe = /<create_file\s+path="([^"]+)">([\s\S]*?)<\/create_file>/g;
    let fm;
    const createdFiles: string[] = [];
    const createdPaths = new Set<string>();
    while ((fm = fileRe.exec(fullContent)) !== null) {
      const [, filePath, fileContent] = fm;
      try {
        const fullFilePath = safePath(filePath, chatRoot);
        await fs.mkdir(path.dirname(fullFilePath), { recursive: true });
        await fs.writeFile(fullFilePath, fileContent, "utf-8");
        createdFiles.push(filePath);
        createdPaths.add(filePath);
        req.log.info({ filePath, bytes: fileContent.length }, "Auto-created file");
      } catch (err) {
        req.log.error({ err, filePath }, "Failed to auto-create file");
      }
    }

    // Handle unclosed <create_file> at the very end (truncated by max_tokens)
    const unclosedMatch = fullContent.match(/<create_file\s+path="([^"]+)">([\s\S]*)$/);
    if (unclosedMatch) {
      const [, filePath, partialContent] = unclosedMatch;
      if (!createdPaths.has(filePath) && partialContent.trim().length > 10) {
        try {
          const fullFilePath = safePath(filePath, chatRoot);
          await fs.mkdir(path.dirname(fullFilePath), { recursive: true });
          await fs.writeFile(fullFilePath, partialContent, "utf-8");
          createdFiles.push(filePath);
          req.log.warn({ filePath, bytes: partialContent.length }, "Saved unclosed (truncated) file");
        } catch (err) {
          req.log.error({ err, filePath }, "Failed to save unclosed file");
        }
      }
    }

    // Fallback: if AI ignored <create_file> tags and used markdown code blocks with filenames instead
    // Patterns: "1. filename.ext\n```lang\n...\n```" or "### filename.ext\n```lang\n...\n```" or "**filename.ext**\n```lang\n...\n```"
    if (createdFiles.length === 0) {
      const mdFileRe = /(?:^|\n)(?:\d+\.\s+|#{1,4}\s+|\*\*)?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]{1,10})\**\s*\n```[a-z0-9]*\n([\s\S]*?)```/gm;
      let mf;
      while ((mf = mdFileRe.exec(fullContent)) !== null) {
        const [, filePath, fileContent] = mf;
        // Skip paths that look like URLs or obviously non-file things
        if (filePath.startsWith("http") || filePath.includes("//")) continue;
        // Must look like a real relative path
        if (!/^[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]{1,10}$/.test(filePath)) continue;
        if (createdPaths.has(filePath)) continue;
        try {
          const fullFilePath = safePath(filePath, chatRoot);
          await fs.mkdir(path.dirname(fullFilePath), { recursive: true });
          await fs.writeFile(fullFilePath, fileContent, "utf-8");
          createdFiles.push(filePath);
          createdPaths.add(filePath);
          req.log.info({ filePath, bytes: fileContent.length }, "Auto-created file (markdown fallback)");
        } catch (err) {
          req.log.error({ err, filePath }, "Failed to auto-create file (markdown fallback)");
        }
      }
    }

    if (createdFiles.length > 0) {
      send({ type: "status", status: `Создано файлов: ${createdFiles.length}` });
      send({ type: "files_created", files: createdFiles });
    }

    const [assistantMsg] = await db.insert(messagesTable).values({
      chatId, role: "assistant", content: fullContent, tokensUsed: tokenCount, status: "done",
    }).returning();

    await db.update(chatsTable).set({ updatedAt: new Date() }).where(eq(chatsTable.id, chatId));

    send({ type: "done", tokens: tokenCount, message: { ...assistantMsg, createdAt: assistantMsg.createdAt.toISOString() } });
    res.end();
  } catch (err: unknown) {
    req.log.error(err);
    send({ type: "error", content: err instanceof Error ? err.message : "Ошибка стриминга" });
    res.end();
  }
});

export default router;
