import { useState, useEffect, useRef, useCallback } from "react";
import {
  FolderOpen, FileText, Terminal as TerminalIcon,
  ChevronRight, X, FolderPlus, Download, Github,
  Copy, Check, ArrowLeft, RefreshCw, GitBranch,
  AlertCircle, CheckCircle2, Loader2, Eye, EyeOff, ExternalLink
} from "lucide-react";
import { useExecuteCommand, useListFiles, useReadFile, useWriteFile, type FileEntry } from "@workspace/api-client-react";
import JSZip from "jszip";

const CHAT_WORKSPACE = (chatId: number | null) =>
  chatId ? `/home/runner/workspace/chat-workspaces/chat-${chatId}` : "/home/runner/workspace/chat-workspaces";

interface Props {
  chatId: number | null;
  fileRefreshKey?: number;
}

export function RightPanel({ chatId, fileRefreshKey }: Props) {
  const [tab, setTab] = useState<"files" | "terminal" | "git">("files");
  const [isOpen, setIsOpen] = useState(true);

  if (!isOpen) {
    return (
      <div className="w-10 h-full flex flex-col items-center py-4 gap-3" style={{ borderLeft: "1px solid rgba(255,255,255,0.05)" }}>
        <button onClick={() => { setIsOpen(true); setTab("files"); }}
          className="p-2 text-muted-foreground/40 hover:text-primary transition-colors rounded-xl hover:bg-white/5" title="Файлы">
          <FolderOpen size={16} />
        </button>
        <button onClick={() => { setIsOpen(true); setTab("terminal"); }}
          className="p-2 text-muted-foreground/40 hover:text-primary transition-colors rounded-xl hover:bg-white/5" title="Терминал">
          <TerminalIcon size={16} />
        </button>
        <button onClick={() => { setIsOpen(true); setTab("git"); }}
          className="p-2 text-muted-foreground/40 hover:text-primary transition-colors rounded-xl hover:bg-white/5" title="Git">
          <GitBranch size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="w-80 h-full flex flex-col shrink-0" style={{ background: "rgba(0,0,0,0.22)", backdropFilter: "blur(8px)", borderLeft: "1px solid rgba(255,255,255,0.05)" }}>
      {/* Tab bar */}
      <div className="flex h-11 shrink-0 items-center px-2 gap-1 mt-1">
        {(["files", "terminal", "git"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex flex-1 h-8 items-center justify-center gap-1.5 text-xs font-medium rounded-xl transition-all ${
              tab === t ? "bg-primary/15 text-primary" : "text-muted-foreground/50 hover:bg-white/5 hover:text-muted-foreground"
            }`}>
            {t === "files" && <><FolderOpen size={12} /> Файлы</>}
            {t === "terminal" && <><TerminalIcon size={12} /> Терм.</>}
            {t === "git" && <><GitBranch size={12} /> Git</>}
          </button>
        ))}
        <button onClick={() => setIsOpen(false)}
          className="p-1.5 text-muted-foreground/30 hover:text-muted-foreground hover:bg-white/5 rounded-xl transition-all ml-1">
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === "files" && <FileExplorer chatId={chatId} refreshKey={fileRefreshKey} />}
        {tab === "terminal" && <TerminalView chatId={chatId} />}
        {tab === "git" && <GitPanel chatId={chatId} />}
      </div>
    </div>
  );
}

/* ─────────────── Lang detection ─────────────── */
function getLang(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rs: "rust", go: "go", java: "java", cpp: "cpp", c: "c",
    html: "html", css: "css", json: "json", md: "markdown",
    sh: "bash", yaml: "yaml", yml: "yaml", toml: "toml", env: "env",
  };
  return map[ext] || ext || "text";
}

/* ─────────────── File Explorer ─────────────── */
function FileExplorer({ chatId, refreshKey }: { chatId: number | null; refreshKey?: number }) {
  const chatRoot = CHAT_WORKSPACE(chatId);
  const [currentPath, setCurrentPath] = useState(chatRoot);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<{ entry: FileEntry; content: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [zipping, setZipping] = useState(false);
  const listFiles = useListFiles();
  const readFile = useReadFile();
  const writeFile = useWriteFile();

  useEffect(() => {
    setCurrentPath(chatRoot);
    setSelectedFile(null);
  }, [chatRoot]);

  useEffect(() => { loadFiles(currentPath); }, [currentPath, refreshKey]);

  const loadFiles = useCallback((p: string) => {
    listFiles.mutate({ data: { path: p } }, {
      onSuccess: d => setFiles(d),
      onError: () => setFiles([]),
    });
  }, []);

  const ensureWorkspace = () => {
    writeFile.mutate({ data: { path: `${chatRoot}/.keep`, content: "" } }, {
      onSuccess: () => loadFiles(chatRoot),
    });
  };

  const handleClick = (f: FileEntry) => {
    if (f.type === "directory") {
      setCurrentPath(f.path);
      setSelectedFile(null);
    } else {
      readFile.mutate({ data: { path: f.path } }, {
        onSuccess: d => setSelectedFile({ entry: f, content: d.content }),
      });
    }
  };

  const goUp = () => {
    const parts = currentPath.split("/");
    if (parts.length > 4) {
      parts.pop();
      setCurrentPath(parts.join("/"));
      setSelectedFile(null);
    }
  };

  const copyCode = () => {
    if (selectedFile) {
      navigator.clipboard.writeText(selectedFile.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const downloadZip = async () => {
    setZipping(true);
    try {
      const zip = new JSZip();
      const addDir = async (dirPath: string, zipFolder: JSZip) => {
        const res = await fetch("/api/files/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: dirPath }),
        });
        const entries: FileEntry[] = await res.json();
        await Promise.all(entries.map(async (e) => {
          if (e.name === ".keep") return;
          if (e.type === "directory") {
            const sub = zipFolder.folder(e.name)!;
            await addDir(e.path, sub);
          } else {
            const r = await fetch("/api/files/read", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path: e.path }),
            });
            const d: { content: string } = await r.json();
            zipFolder.file(e.name, d.content);
          }
        }));
      };
      await addDir(chatRoot, zip);
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chat-${chatId}-workspace.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setZipping(false);
    }
  };

  const noWorkspace = !listFiles.isPending && files.length === 0 && !selectedFile;

  /* ── File viewer ── */
  if (selectedFile) {
    const lang = getLang(selectedFile.entry.name);
    return (
      <div className="flex flex-col h-full font-mono text-[12px]">
        <div className="flex items-center gap-1.5 px-2 py-2 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <button onClick={() => setSelectedFile(null)}
            className="p-1.5 hover:bg-white/8 rounded-lg transition-colors text-muted-foreground/50 hover:text-foreground">
            <ArrowLeft size={12} />
          </button>
          <FileText size={11} className="text-accent/60 shrink-0" />
          <span className="text-foreground/70 truncate text-[11px] flex-1">{selectedFile.entry.name}</span>
          <span className="text-[10px] text-muted-foreground/30 bg-black/20 px-1.5 py-0.5 rounded-md shrink-0">{lang}</span>
          <button onClick={copyCode}
            className="p-1.5 hover:bg-white/8 rounded-lg transition-colors text-muted-foreground/40 hover:text-foreground shrink-0">
            {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-black/30">
          <pre className="p-3 text-[11px] text-foreground/75 leading-relaxed whitespace-pre-wrap break-words">
            <code>{selectedFile.content}</code>
          </pre>
        </div>
      </div>
    );
  }

  /* ── File list ── */
  return (
    <div className="flex flex-col h-full font-mono text-[12px]">
      <div className="flex items-center gap-1 px-2 py-2 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <button onClick={goUp} disabled={currentPath === chatRoot}
          className="p-1.5 hover:bg-white/8 rounded-lg disabled:opacity-20 transition-colors" title="Вверх">
          <ChevronRight size={12} className="rotate-180 text-muted-foreground/50" />
        </button>
        <span className="text-muted-foreground/35 truncate flex-1 text-[11px]">
          {currentPath.replace("/home/runner/workspace/chat-workspaces", "~")}
        </span>
        <button onClick={() => loadFiles(currentPath)}
          className="p-1.5 hover:bg-white/8 rounded-lg transition-colors text-muted-foreground/40 hover:text-foreground" title="Обновить">
          <RefreshCw size={11} className={listFiles.isPending ? "animate-spin" : ""} />
        </button>
        <button onClick={downloadZip} disabled={zipping || files.length === 0}
          className="p-1.5 hover:bg-white/8 rounded-lg transition-colors text-muted-foreground/40 hover:text-accent disabled:opacity-20" title="Скачать ZIP">
          {zipping ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-1">
        {listFiles.isPending && (
          <div className="text-muted-foreground/25 text-center mt-8 text-[11px] flex items-center justify-center gap-2">
            <Loader2 size={12} className="animate-spin" /> Загрузка...
          </div>
        )}
        {noWorkspace && (
          <div className="flex flex-col items-center gap-3 mt-12 text-center px-4">
            <FolderOpen size={28} className="text-muted-foreground/20" />
            <p className="text-[11px] text-muted-foreground/30 leading-relaxed">
              Рабочая папка пуста.<br />Попроси агента создать файлы.
            </p>
            <button onClick={ensureWorkspace}
              className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-xl bg-primary/15 text-primary hover:bg-primary/25 transition-colors">
              <FolderPlus size={11} /> Инициализировать
            </button>
          </div>
        )}
        {files.map(f => (
          <div key={f.path} onClick={() => handleClick(f)}
            className="flex items-center gap-2 px-2 py-1.5 hover:bg-white/5 rounded-xl cursor-pointer group transition-all"
            data-testid={`file-entry-${f.name}`}>
            {f.type === "directory"
              ? <FolderOpen size={12} className="text-accent/60 shrink-0" />
              : <FileText size={12} className="text-muted-foreground/40 shrink-0" />
            }
            <span className="truncate text-foreground/60 group-hover:text-foreground/90 transition-colors flex-1">{f.name}</span>
            {f.size !== null && f.size !== undefined && f.type !== "directory" && (
              <span className="text-[10px] text-muted-foreground/25 shrink-0">
                {f.size > 1024 ? `${(f.size / 1024).toFixed(1)}кб` : `${f.size}б`}
              </span>
            )}
          </div>
        ))}
      </div>

      {files.length > 0 && (
        <div className="px-3 pb-3">
          <button onClick={downloadZip} disabled={zipping}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-[12px] font-medium transition-all"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {zipping
              ? <><Loader2 size={12} className="animate-spin text-primary" /> Создаю ZIP...</>
              : <><Download size={12} className="text-accent" /> Скачать всё как ZIP</>}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────── Terminal ─────────────── */
function TerminalView({ chatId }: { chatId: number | null }) {
  const chatRoot = CHAT_WORKSPACE(chatId);
  const [history, setHistory] = useState<{ cmd: string; out: string; code?: number }[]>([]);
  const [cmd, setCmd] = useState("");
  const [cwd, setCwd] = useState(chatRoot);
  const executeCommand = useExecuteCommand();
  const writeFile = useWriteFile();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCwd(CHAT_WORKSPACE(chatId));
    setHistory([]);
  }, [chatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const runCmd = useCallback((c: string) => {
    if (!c.trim()) return;

    if (c.startsWith("cd ")) {
      const target = c.slice(3).trim();
      const newCwd = target.startsWith("/") ? target : `${cwd}/${target}`;
      writeFile.mutate({ data: { path: `${chatRoot}/.keep`, content: "" } }, {
        onSuccess: () => {
          executeCommand.mutate({ data: { command: `cd "${newCwd}" && pwd`, cwd } }, {
            onSuccess: res => {
              if (res.exitCode === 0) setCwd(res.stdout.trim());
              setHistory(prev => [...prev, { cmd: c, out: res.stdout.trim(), code: res.exitCode }]);
            },
          });
        },
      });
      return;
    }

    writeFile.mutate({ data: { path: `${chatRoot}/.keep`, content: "" } }, {
      onSuccess: () => {
        executeCommand.mutate({ data: { command: c, cwd } }, {
          onSuccess: res => {
            setHistory(prev => [...prev, {
              cmd: c,
              out: [res.stdout, res.stderr].filter(Boolean).join("\n"),
              code: res.exitCode,
            }]);
          },
          onError: err => {
            setHistory(prev => [...prev, { cmd: c, out: `Ошибка: ${err instanceof Error ? err.message : String(err)}`, code: 1 }]);
          },
        });
      },
    });
  }, [cwd, chatRoot, executeCommand, writeFile]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || !cmd.trim()) return;
    const c = cmd.trim();
    setCmd("");
    runCmd(c);
  };

  const displayCwd = cwd.replace("/home/runner/workspace/chat-workspaces", "~");

  return (
    <div className="flex flex-col h-full font-mono text-[12px] bg-black/35">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {history.length === 0 && (
          <div className="text-muted-foreground/25 text-[11px] pt-2 leading-relaxed">
            {chatId ? `~ chat-${chatId}\nВведите команду и нажмите Enter` : "Выберите чат для работы"}
          </div>
        )}
        {history.map((h, i) => (
          <div key={i} className="space-y-1">
            <div className="text-primary/70">$ {h.cmd}</div>
            {h.out && (
              <div className={`whitespace-pre-wrap text-[11px] leading-relaxed ${
                h.code && h.code !== 0 ? "text-red-400/70" : "text-foreground/50"
              }`}>{h.out}</div>
            )}
            {h.code !== undefined && h.code !== 0 && (
              <div className="text-red-500/40 text-[10px]">код выхода: {h.code}</div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <span className="text-primary/50 shrink-0 text-[10px] max-w-[80px] truncate" title={displayCwd}>{displayCwd} $</span>
        <input
          value={cmd}
          onChange={e => setCmd(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent border-none outline-none text-foreground/70 placeholder:text-muted-foreground/25 text-[12px]"
          placeholder={chatId ? "введите команду..." : "выберите чат..."}
          autoFocus
          disabled={executeCommand.isPending || !chatId}
          data-testid="input-terminal-command"
        />
        {executeCommand.isPending && <Loader2 size={10} className="text-primary/40 animate-spin shrink-0" />}
      </div>
    </div>
  );
}

/* ─────────────── Git Panel ─────────────── */
type GitStep = { label: string; cmd: string };
type StepState = "idle" | "running" | "done" | "error" | "skipped";

function injectToken(url: string, token: string): string {
  try {
    const u = new URL(url.trim());
    u.username = "oauth2";
    u.password = token.trim();
    return u.toString();
  } catch {
    return url;
  }
}

function GitPanel({ chatId }: { chatId: number | null }) {
  const chatRoot = CHAT_WORKSPACE(chatId);
  const [repoUrl, setRepoUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [railwayToken, setRailwayToken] = useState("");
  const [showRailwayToken, setShowRailwayToken] = useState(false);
  const [commitMsg, setCommitMsg] = useState("feat: initial commit from SYNAPSE AGENT");
  const [branch, setBranch] = useState("main");
  const [steps, setSteps] = useState<{ step: GitStep; state: StepState; out: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const executeCommand = useExecuteCommand();
  const writeFile = useWriteFile();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then(r => r.json())
      .then((d: Record<string, string>) => {
        if (d.github_token) setToken(d.github_token);
        if (d.railway_token) setRailwayToken(d.railway_token);
      }).catch(() => {});
  }, []);

  const saveToken = (val: string) => {
    setToken(val);
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ github_token: val }),
    }).catch(() => {});
  };

  const saveRailwayToken = (val: string) => {
    setRailwayToken(val);
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ railway_token: val }),
    }).catch(() => {});
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps]);

  const buildSteps = (rawUrl: string, tok: string, msg: string, br: string): GitStep[] => {
    const authUrl = tok ? injectToken(rawUrl, tok) : rawUrl;
    const safeMsg = msg.replace(/"/g, '\\"');
    return [
      { label: "Инициализация git", cmd: "git init -b main 2>/dev/null || git init" },
      { label: "Настройка профиля", cmd: 'git config user.email "synapse@agent.ai" && git config user.name "SYNAPSE AGENT" && git config credential.helper ""' },
      { label: "Добавление файлов", cmd: "git add -A && git status --short" },
      { label: `Коммит: ${msg}`, cmd: `git diff --cached --quiet && echo "nothing to commit" || git commit -m "${safeMsg}"` },
      { label: "Настройка remote origin", cmd: `git remote remove origin 2>/dev/null; git remote add origin ${authUrl}` },
      { label: `Публикация → ${br}`, cmd: `GIT_TERMINAL_PROMPT=0 git push -u origin HEAD:${br} --force` },
    ];
  };

  const runStep = (cmd: string): Promise<{ out: string; ok: boolean }> =>
    new Promise(res => {
      executeCommand.mutate(
        { data: { command: cmd, cwd: chatRoot } },
        {
          onSuccess: r => {
            const out = [r.stdout, r.stderr].filter(Boolean).join("\n").trim();
            res({ out, ok: r.exitCode === 0 });
          },
          onError: err => res({ out: err instanceof Error ? err.message : "Ошибка", ok: false }),
        }
      );
    });

  const runGit = async () => {
    if (!repoUrl.trim() || !chatId) return;
    if (!token.trim()) { setError("Введи GitHub Personal Access Token"); return; }
    setRunning(true);
    setDone(false);
    setError(null);
    setPublishedUrl(null);

    const stepsToRun = buildSteps(repoUrl.trim(), token.trim(), commitMsg.trim() || "feat: initial commit", branch.trim() || "main");
    setSteps(stepsToRun.map(s => ({ step: s, state: "idle" as StepState, out: "" })));

    await new Promise<void>(res =>
      writeFile.mutate({ data: { path: `${chatRoot}/.keep`, content: "" } }, { onSuccess: () => res(), onError: () => res() })
    );

    let failed = false;
    for (let i = 0; i < stepsToRun.length; i++) {
      if (failed) {
        setSteps(prev => prev.map((s, j) => j === i ? { ...s, state: "skipped" } : s));
        continue;
      }

      setSteps(prev => prev.map((s, j) => j === i ? { ...s, state: "running" } : s));
      const result = await runStep(stepsToRun[i].cmd);

      const isNoOp = result.out.includes("nothing to commit");
      const ok = result.ok || isNoOp;
      setSteps(prev => prev.map((s, j) => j === i ? { ...s, state: ok ? "done" : "error", out: result.out } : s));

      if (!ok) {
        failed = true;
        setError(`Ошибка на шаге «${stepsToRun[i].label}»`);
      }
    }

    setRunning(false);
    if (!failed) {
      setDone(true);
      try {
        const u = new URL(repoUrl.trim());
        u.username = "";
        u.password = "";
        setPublishedUrl(u.toString().replace(/\.git$/, ""));
      } catch { setPublishedUrl(repoUrl.replace(/\.git$/, "")); }
    }
  };

  const canPush = !running && repoUrl.trim() && token.trim() && chatId;

  return (
    <div className="flex flex-col h-full text-[12px]">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">

        <div className="flex items-center gap-2">
          <Github size={14} className="text-foreground/50" />
          <span className="text-[11px] font-medium text-foreground/60">Публикация на GitHub</span>
        </div>

        <div className="rounded-xl p-2.5 space-y-1.5 text-[11px] leading-relaxed text-muted-foreground/50"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="font-medium text-foreground/40">Нужен Personal Access Token:</p>
          <ol className="space-y-1 list-decimal list-inside">
            <li>Открой <a href="https://github.com/settings/tokens/new" target="_blank" rel="noreferrer"
              className="text-accent/80 hover:underline inline-flex items-center gap-0.5">
              github.com/settings/tokens <ExternalLink size={9} />
            </a></li>
            <li>Выбери <span className="font-mono bg-white/5 px-1 rounded">repo</span> scope</li>
            <li>Нажми «Generate» и вставь токен ниже</li>
          </ol>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground/40">GitHub Personal Access Token</label>
          <div className="relative">
            <input
              type={showToken ? "text" : "password"}
              value={token}
              onChange={e => saveToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              className="w-full bg-black/30 border border-white/8 rounded-xl px-3 py-2 pr-8 text-[11px] text-foreground/80 placeholder:text-muted-foreground/20 focus:outline-none focus:border-primary/30 font-mono"
            />
            <button onClick={() => setShowToken(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/30 hover:text-muted-foreground/60">
              {showToken ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
          </div>
          {token && (
            <p className="text-[10px] text-green-400/50 flex items-center gap-1">
              <CheckCircle2 size={9} /> Токен сохранён
            </p>
          )}
        </div>

        {/* Railway Token */}
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[13px]">🚂</span>
          <span className="text-[11px] font-medium text-foreground/60">Railway Deploy</span>
        </div>
        <div className="rounded-xl p-2.5 space-y-1 text-[11px] leading-relaxed text-muted-foreground/50"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="font-medium text-foreground/40">Railway API Token:</p>
          <p>1. Открой <a href="https://railway.app/account/tokens" target="_blank" rel="noreferrer"
            className="text-accent/80 hover:underline inline-flex items-center gap-0.5">
            railway.app/account/tokens <ExternalLink size={9} />
          </a></p>
          <p>2. Создай токен и вставь ниже</p>
          <p>3. В Railway подключи GitHub: Account → Connections</p>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground/40">Railway API Token</label>
          <div className="relative">
            <input
              type={showRailwayToken ? "text" : "password"}
              value={railwayToken}
              onChange={e => saveRailwayToken(e.target.value)}
              placeholder="railway_xxxxxxxxxxxxxxxxxxxxxxxx"
              className="w-full bg-black/30 border border-white/8 rounded-xl px-3 py-2 pr-8 text-[11px] text-foreground/80 placeholder:text-muted-foreground/20 focus:outline-none focus:border-primary/30 font-mono"
            />
            <button onClick={() => setShowRailwayToken(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/30 hover:text-muted-foreground/60">
              {showRailwayToken ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
          </div>
          {railwayToken && (
            <p className="text-[10px] text-green-400/50 flex items-center gap-1">
              <CheckCircle2 size={9} /> Railway токен сохранён
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground/40">URL репозитория</label>
          <input
            value={repoUrl}
            onChange={e => setRepoUrl(e.target.value)}
            placeholder="https://github.com/user/repo.git"
            className="w-full bg-black/30 border border-white/8 rounded-xl px-3 py-2 text-[11px] text-foreground/80 placeholder:text-muted-foreground/20 focus:outline-none focus:border-primary/30 font-mono"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground/40">Ветка</label>
            <input
              value={branch}
              onChange={e => setBranch(e.target.value)}
              placeholder="main"
              className="w-full bg-black/30 border border-white/8 rounded-xl px-2 py-2 text-[11px] text-foreground/80 placeholder:text-muted-foreground/20 focus:outline-none focus:border-primary/30 font-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground/40">Сообщение коммита</label>
            <input
              value={commitMsg}
              onChange={e => setCommitMsg(e.target.value)}
              placeholder="feat: initial"
              className="w-full bg-black/30 border border-white/8 rounded-xl px-2 py-2 text-[11px] text-foreground/80 placeholder:text-muted-foreground/20 focus:outline-none focus:border-primary/30 font-mono"
            />
          </div>
        </div>

        <button
          onClick={runGit}
          disabled={!canPush}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-medium transition-all disabled:opacity-30"
          style={{
            background: done ? "rgba(25,120,53,0.5)" : running ? "rgba(25,95,53,0.3)" : "rgba(25,95,53,0.45)",
            border: "1px solid rgba(25,200,80,0.2)",
            color: "#4ade80"
          }}
        >
          {running
            ? <><Loader2 size={12} className="animate-spin" /> Выполняю git...</>
            : done
            ? <><CheckCircle2 size={12} /> Запушено!</>
            : <><GitBranch size={12} /> Запушить на GitHub</>}
        </button>

        {steps.length > 0 && (
          <div className="space-y-1.5 font-mono">
            {steps.map((s, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">
                  {s.state === "idle"    && <span className="w-3 h-3 block rounded-full bg-white/10" />}
                  {s.state === "skipped" && <span className="w-3 h-3 block rounded-full bg-white/5" />}
                  {s.state === "running" && <Loader2 size={12} className="animate-spin text-primary" />}
                  {s.state === "done"    && <CheckCircle2 size={12} className="text-green-400" />}
                  {s.state === "error"   && <AlertCircle size={12} className="text-red-400" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className={`text-[11px] truncate ${
                    s.state === "done"    ? "text-foreground/55" :
                    s.state === "error"   ? "text-red-400/80"   :
                    s.state === "running" ? "text-primary"       :
                    "text-muted-foreground/25"
                  }`}>{s.step.label}</div>
                  {s.out && (s.state === "error" || s.state === "done") && s.out !== "nothing to commit" && (
                    <div className={`text-[10px] whitespace-pre-wrap mt-0.5 leading-relaxed ${
                      s.state === "error" ? "text-red-400/60" : "text-muted-foreground/30"
                    }`}>{s.out.slice(0, 200)}</div>
                  )}
                </div>
              </div>
            ))}

            {done && publishedUrl && (
              <div className="mt-2 rounded-xl p-2.5 space-y-1"
                style={{ background: "rgba(25,120,53,0.15)", border: "1px solid rgba(25,200,80,0.15)" }}>
                <div className="flex items-center gap-1.5 text-green-400/80 text-[11px]">
                  <CheckCircle2 size={11} /> Опубликовано!
                </div>
                <a href={publishedUrl} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 text-[10px] text-accent/70 hover:text-accent break-all">
                  <ExternalLink size={9} className="shrink-0" /> {publishedUrl}
                </a>
              </div>
            )}

            {error && !done && (
              <div className="flex items-start gap-2 mt-1 text-red-400/70 text-[11px]">
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
