import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useListMessages, useGetChat,
  getListMessagesQueryKey, getGetChatQueryKey,
  useExecuteCommand
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListChatsQueryKey } from "@workspace/api-client-react";
import { useStreamChat } from "@/hooks/use-stream-chat";
import {
  Send, Paperclip, Copy, Check, Loader2, Zap,
  FileCode, Terminal, Play, CheckCircle2, X,
  FolderOpen, Search, Globe, File, TestTube2,
  GitCompare, Package, Shield, Plug, Mic, MicOff,
  FileText, ExternalLink, FlaskConical, Eye, MessageCircle
} from "lucide-react";

/* ─────────────── Octopus animation ─────────────── */
function OctopusIcon({ swimming, size = 64 }: { swimming: boolean; size?: number }) {
  return (
    <div className={swimming ? "octopus-swimming" : "octopus-idle"} style={{ width: size, height: size }}>
      <div className={swimming ? "octopus-swimming-inner" : ""}>
        <img src="/synapse-icon.webp" alt="Synapse" style={{ width: size, height: size }} className="rounded-2xl" />
      </div>
    </div>
  );
}

/* ─────────────── Completion burst ─────────────── */
function CompletionBurst() {
  const colors = ["hsl(25 95% 58%)", "hsl(213 94% 68%)", "hsl(25 80% 70%)", "hsl(213 70% 75%)"];
  return (
    <div className="completion-overlay absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
      <div className="relative flex items-center justify-center">
        {[0, 1, 2].map(i => (
          <div key={i} className={`absolute rounded-full border-2 ${["burst-ring", "burst-ring-2", "burst-ring-3"][i]}`}
            style={{ width: 80, height: 80, borderColor: colors[i % 2], opacity: 0 }} />
        ))}
        {Array.from({ length: 8 }).map((_, i) => {
          const angle = (i / 8) * 360;
          const dist = 60 + (i % 3) * 15;
          return (
            <div key={i} className="burst-sparkle absolute"
              style={{ width: 8, height: 8, borderRadius: "50%", background: colors[i % colors.length],
                transform: `rotate(${angle}deg) translateX(${dist}px)`, animationDelay: `${i * 0.06}s`, opacity: 0 }} />
          );
        })}
        <div className="relative z-10">
          <img src="/synapse-icon.webp" alt="" className="w-16 h-16 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Code block ─────────────── */
function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative my-3 rounded-2xl overflow-hidden border border-white/8">
      <div className="flex items-center justify-between bg-black/30 px-3 py-1.5">
        <span className="text-[10px] text-muted-foreground/60 font-mono uppercase tracking-wider">{lang || "код"}</span>
        <button onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors">
          {copied ? <><Check size={10} className="text-green-400" /> Скопировано</> : <><Copy size={10} /> Копировать</>}
        </button>
      </div>
      <pre className="bg-black/50 p-3 overflow-x-auto text-xs text-foreground/80 font-mono leading-relaxed">{code}</pre>
    </div>
  );
}

/* ─────────────── Command confirmation badge ─────────────── */
type CmdState = "pending" | "running" | "done" | "error";
interface RunCmd { cmd: string; state: CmdState; output?: string; exitCode?: number }

function CommandConfirmBadge({
  rc, chatId, onStateChange
}: { rc: RunCmd; chatId: number; onStateChange: (state: CmdState, output?: string, code?: number) => void }) {
  const exec = useExecuteCommand();
  const CHAT_ROOT = `/home/runner/workspace/chat-workspaces/chat-${chatId}`;

  const run = () => {
    onStateChange("running");
    exec.mutate({ data: { command: rc.cmd, cwd: CHAT_ROOT } }, {
      onSuccess: res => {
        const out = [res.stdout, res.stderr].filter(Boolean).join("\n");
        onStateChange(res.exitCode === 0 ? "done" : "error", out, res.exitCode);
      },
      onError: err => {
        onStateChange("error", err instanceof Error ? err.message : "Ошибка", 1);
      }
    });
  };

  return (
    <div className="my-2 rounded-xl border border-white/8 overflow-hidden font-mono text-[12px]">
      <div className="flex items-center gap-2 px-3 py-2 bg-black/30">
        <Terminal size={11} className="text-primary/70 shrink-0" />
        <span className="flex-1 text-foreground/70 truncate">{rc.cmd}</span>
        {rc.state === "pending" && (
          <button onClick={run}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/80 hover:bg-primary text-primary-foreground text-[11px] font-medium transition-all shrink-0">
            <Play size={10} /> Выполнить
          </button>
        )}
        {rc.state === "running" && (
          <span className="flex items-center gap-1 text-primary/60 text-[11px] shrink-0">
            <Loader2 size={10} className="animate-spin" /> Запускаю...
          </span>
        )}
        {rc.state === "done" && <CheckCircle2 size={14} className="text-green-400 shrink-0" />}
        {rc.state === "error" && <span className="text-red-400 text-[11px] shrink-0">✕ Ошибка</span>}
      </div>
      {rc.output && (
        <div className={`px-3 py-2 bg-black/40 text-[11px] whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto ${
          rc.state === "error" ? "text-red-400/80" : "text-foreground/55"
        }`}>
          {rc.output}
        </div>
      )}
    </div>
  );
}

/* ─────────────── File action badge ─────────────── */
function FileActionBadge({ label, chatId, streamingLabel }: { label: string; chatId?: number; streamingLabel?: string }) {
  const [showPreview, setShowPreview] = useState(false);
  const [previewHeight, setPreviewHeight] = useState(400);
  const isHtml = label.endsWith(".html") || label.endsWith(".htm");

  if (label === "__streaming__") {
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-xl font-sans my-1 border"
        style={{ background: "rgba(59,130,246,0.08)", borderColor: "rgba(59,130,246,0.2)", color: "rgba(147,197,253,0.8)" }}>
        <Loader2 size={10} className="animate-spin shrink-0" />
        {streamingLabel ? `Записываю ${streamingLabel}...` : "Записываю файл..."}
      </div>
    );
  }

  const previewUrl = chatId
    ? `/api/workspace/${chatId}/${label}`
    : `/api/preview-file?path=${encodeURIComponent(label)}`;

  return (
    <div className="my-1.5">
      <div className="inline-flex items-center gap-1.5 flex-wrap">
        <div className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-xl font-mono border bg-accent/10 border-accent/20 text-accent">
          <FileCode size={10} className="shrink-0" /> {label}
        </div>
        {isHtml && (
          <>
            <button
              onClick={() => setShowPreview(p => !p)}
              className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border transition-all"
              style={{
                background: showPreview ? "rgba(249,115,22,0.15)" : "rgba(249,115,22,0.06)",
                borderColor: "rgba(249,115,22,0.3)",
                color: "rgba(253,186,116,0.9)"
              }}
            >
              <Eye size={9} />
              {showPreview ? "Скрыть" : "Превью"}
            </button>
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border transition-all"
              style={{
                background: "rgba(99,102,241,0.06)",
                borderColor: "rgba(99,102,241,0.25)",
                color: "rgba(165,180,252,0.9)",
                textDecoration: "none"
              }}
            >
              <ExternalLink size={9} />
              Открыть
            </a>
          </>
        )}
      </div>
      {isHtml && showPreview && (
        <div className="mt-2 rounded-xl overflow-hidden border" style={{ borderColor: "rgba(249,115,22,0.2)" }}>
          <div className="flex items-center gap-2 px-2.5 py-1.5 text-[10px]"
            style={{ background: "rgba(249,115,22,0.06)", borderBottom: "1px solid rgba(249,115,22,0.12)", color: "rgba(253,186,116,0.7)" }}>
            <Eye size={9} />
            <span className="font-mono">{label}</span>
            <div className="ml-auto flex items-center gap-1">
              <button onClick={() => setPreviewHeight(h => Math.max(250, h - 150))}
                className="px-1.5 py-0.5 rounded text-[10px] hover:bg-white/5 transition-colors" title="Уменьшить">▲</button>
              <button onClick={() => setPreviewHeight(h => h + 150)}
                className="px-1.5 py-0.5 rounded text-[10px] hover:bg-white/5 transition-colors" title="Увеличить">▼</button>
              <a href={previewUrl} target="_blank" rel="noopener noreferrer"
                className="px-1.5 py-0.5 rounded text-[10px] hover:bg-white/5 transition-colors" title="Открыть в новой вкладке">
                <ExternalLink size={9} />
              </a>
            </div>
          </div>
          <iframe
            key={previewUrl}
            src={previewUrl}
            className="w-full"
            style={{ height: previewHeight, border: "none", background: "white" }}
            sandbox="allow-scripts allow-same-origin allow-forms"
            title={`Превью ${label}`}
          />
        </div>
      )}
    </div>
  );
}

/* ─────────────── Tool-call badge ─────────────── */
type ToolKind =
  | "list_files" | "read_file" | "web_search" | "fetch_url"
  | "view_outline" | "grep_search" | "manage_env_vars" | "scan_secrets"
  | "git_commit_and_push" | "create_pull_request"
  | "run_tests" | "diff_file" | "lint_file" | "install_package"
  | "check_dependencies" | "audit_dependencies" | "check_port"
  | "analyze_telegram_bot" | "crawl_telegram_bot"
  | "telegram_auth_start" | "telegram_auth_complete";

const TOOL_META: Record<ToolKind, { icon: React.ElementType; label: string; color: string; border: string; textColor: string }> = {
  list_files:           { icon: FolderOpen,   label: "list_files",           color: "rgba(250,173,20,0.08)",  border: "rgba(250,173,20,0.2)",  textColor: "rgba(253,213,119,0.9)" },
  read_file:            { icon: File,          label: "read_file",            color: "rgba(59,130,246,0.08)",  border: "rgba(59,130,246,0.2)",  textColor: "rgba(147,197,253,0.9)" },
  web_search:           { icon: Search,        label: "web_search",           color: "rgba(52,211,153,0.08)",  border: "rgba(52,211,153,0.2)",  textColor: "rgba(110,231,183,0.9)" },
  fetch_url:            { icon: Globe,         label: "fetch_url",            color: "rgba(167,139,250,0.08)", border: "rgba(167,139,250,0.2)", textColor: "rgba(196,181,253,0.9)" },
  view_outline:         { icon: FileCode,      label: "view_outline",         color: "rgba(251,113,133,0.08)", border: "rgba(251,113,133,0.2)", textColor: "rgba(253,164,175,0.9)" },
  grep_search:          { icon: Search,        label: "grep_search",          color: "rgba(45,212,191,0.08)",  border: "rgba(45,212,191,0.2)",  textColor: "rgba(94,234,212,0.9)" },
  manage_env_vars:      { icon: File,          label: "manage_env_vars",      color: "rgba(249,115,22,0.08)",  border: "rgba(249,115,22,0.2)",  textColor: "rgba(253,186,116,0.9)" },
  scan_secrets:         { icon: CheckCircle2,  label: "scan_secrets",         color: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.2)",   textColor: "rgba(252,165,165,0.9)" },
  git_commit_and_push:  { icon: Zap,           label: "git_commit_and_push",  color: "rgba(99,102,241,0.08)",  border: "rgba(99,102,241,0.2)",  textColor: "rgba(165,180,252,0.9)" },
  create_pull_request:  { icon: Zap,           label: "create_pull_request",  color: "rgba(99,102,241,0.08)",  border: "rgba(99,102,241,0.2)",  textColor: "rgba(165,180,252,0.9)" },
  run_tests:            { icon: TestTube2,     label: "run_tests",            color: "rgba(34,197,94,0.08)",   border: "rgba(34,197,94,0.2)",   textColor: "rgba(134,239,172,0.9)" },
  diff_file:            { icon: GitCompare,    label: "diff_file",            color: "rgba(251,191,36,0.08)",  border: "rgba(251,191,36,0.2)",  textColor: "rgba(253,224,132,0.9)" },
  lint_file:            { icon: FlaskConical,  label: "lint_file",            color: "rgba(168,85,247,0.08)",  border: "rgba(168,85,247,0.2)",  textColor: "rgba(216,180,254,0.9)" },
  install_package:      { icon: Package,       label: "install_package",      color: "rgba(20,184,166,0.08)",  border: "rgba(20,184,166,0.2)",  textColor: "rgba(94,234,212,0.9)" },
  check_dependencies:   { icon: Package,       label: "check_dependencies",   color: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.2)",  textColor: "rgba(252,211,77,0.9)"  },
  audit_dependencies:   { icon: Shield,        label: "audit_dependencies",   color: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.2)",   textColor: "rgba(252,165,165,0.9)" },
  check_port:           { icon: Plug,          label: "check_port",           color: "rgba(14,165,233,0.08)",  border: "rgba(14,165,233,0.2)",  textColor: "rgba(125,211,252,0.9)" },
  analyze_telegram_bot: { icon: MessageCircle,  label: "analyze_telegram_bot", color: "rgba(14,182,246,0.08)",  border: "rgba(14,182,246,0.2)",  textColor: "rgba(125,211,252,0.9)" },
  crawl_telegram_bot:   { icon: MessageCircle,  label: "crawl_telegram_bot",   color: "rgba(99,102,241,0.08)",  border: "rgba(99,102,241,0.2)",  textColor: "rgba(165,180,252,0.9)" },
  telegram_auth_start:    { icon: Plug,          label: "telegram_auth_start",   color: "rgba(34,197,94,0.08)",   border: "rgba(34,197,94,0.2)",   textColor: "rgba(134,239,172,0.9)" },
  telegram_auth_complete: { icon: CheckCircle2,  label: "telegram_auth_complete",color: "rgba(34,197,94,0.08)",   border: "rgba(34,197,94,0.2)",   textColor: "rgba(134,239,172,0.9)" },
};

function ToolCallBadge({ kind, content }: { kind: ToolKind; content: string }) {
  const meta = TOOL_META[kind];
  const Icon = meta.icon;
  const short = content.length > 48 ? content.slice(0, 48) + "…" : content;
  return (
    <div className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-xl font-mono my-1 border"
      style={{ background: meta.color, borderColor: meta.border, color: meta.textColor }}>
      <Icon size={10} className="shrink-0" />
      <span className="opacity-60">{meta.label}</span>
      <span className="opacity-80">({short})</span>
    </div>
  );
}

/* ─────────────── Message renderer ─────────────── */
interface ContentPart {
  type: "text" | "code" | "file" | "cmd" | "toolcall";
  content: string;
  lang?: string;
  label?: string;
  toolKind?: ToolKind;
}

function parseContent(content: string, isStreaming = false): ContentPart[] {
  const actions: ContentPart[] = [];
  let remaining = content;

  remaining = remaining.replace(/<create_file\s+path="([^"]+)">([\s\S]*?)<\/create_file>/g, (_, p, body) => {
    actions.push({ type: "file", content: body, label: p });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<run_command>([\s\S]*?)<\/run_command>/g, (_, cmd) => {
    actions.push({ type: "cmd", content: cmd.trim(), label: cmd.trim() });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<list_files(?:\s+path="([^"]*)")?\s*\/>/g, (_, p) => {
    actions.push({ type: "toolcall", content: p || "workspace", toolKind: "list_files" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<read_file\s+path="([^"]+)"\s*\/>/g, (_, p) => {
    actions.push({ type: "toolcall", content: p, toolKind: "read_file" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<web_search\s+query="([^"]+)"\s*\/>/g, (_, q) => {
    actions.push({ type: "toolcall", content: q, toolKind: "web_search" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<fetch_url\s+url="([^"]+)"\s*\/>/g, (_, u) => {
    actions.push({ type: "toolcall", content: u, toolKind: "fetch_url" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<analyze_telegram_bot\s+username="([^"]+)"\s*\/>/g, (_, u) => {
    actions.push({ type: "toolcall", content: u, toolKind: "analyze_telegram_bot" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<crawl_telegram_bot\s+username="([^"]+)"\s+session="[^"]*"\s*\/>/g, (_, u) => {
    actions.push({ type: "toolcall", content: u, toolKind: "crawl_telegram_bot" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<telegram_auth_start\s+phone="([^"]+)"\s*\/>/g, (_, p) => {
    actions.push({ type: "toolcall", content: p, toolKind: "telegram_auth_start" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<telegram_auth_complete\s+phone="([^"]+)"\s+code="([^"]+)"\s*\/>/g, (_, p, c) => {
    actions.push({ type: "toolcall", content: `${p} code:${c}`, toolKind: "telegram_auth_complete" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<view_outline\s+path="([^"]+)"\s*\/>/g, (_, p) => {
    actions.push({ type: "toolcall", content: p, toolKind: "view_outline" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<grep_search\s+pattern="([^"]+)"[^/]*\/>/g, (_, p) => {
    actions.push({ type: "toolcall", content: p, toolKind: "grep_search" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<manage_env_vars\s+action="([^"]+)"[^/]*\/>/g, (_, a) => {
    actions.push({ type: "toolcall", content: a, toolKind: "manage_env_vars" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<scan_secrets\s*\/>/g, () => {
    actions.push({ type: "toolcall", content: "workspace", toolKind: "scan_secrets" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<git_commit_and_push\s+branch="([^"]+)"[^/]*\/>/g, (_, b) => {
    actions.push({ type: "toolcall", content: b, toolKind: "git_commit_and_push" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<create_pull_request\s+title="([^"]+)"[^/]*\/>/g, (_, t) => {
    actions.push({ type: "toolcall", content: t, toolKind: "create_pull_request" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<run_tests(?:\s+framework="([^"]*)")?(?:\s+command="([^"]*)")?\s*\/>/g, (_, fw, cmd) => {
    actions.push({ type: "toolcall", content: fw || cmd || "auto", toolKind: "run_tests" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<diff_file\s+path="([^"]+)"\s*\/>/g, (_, p) => {
    actions.push({ type: "toolcall", content: p, toolKind: "diff_file" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<lint_file\s+path="([^"]+)"\s*\/>/g, (_, p) => {
    actions.push({ type: "toolcall", content: p, toolKind: "lint_file" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<install_package\s+name="([^"]+)"[^/]*\/>/g, (_, n) => {
    actions.push({ type: "toolcall", content: n, toolKind: "install_package" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<check_dependencies(?:\s+file="([^"]+)")?\s*\/>/g, (_, f) => {
    actions.push({ type: "toolcall", content: f || "auto", toolKind: "check_dependencies" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<audit_dependencies(?:\s+manager="([^"]+)")?\s*\/>/g, (_, mg) => {
    actions.push({ type: "toolcall", content: mg || "npm", toolKind: "audit_dependencies" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });
  remaining = remaining.replace(/<check_port\s+number="(\d+)"\s*\/>/g, (_, n) => {
    actions.push({ type: "toolcall", content: n, toolKind: "check_port" });
    return `\n__ACT_${actions.length - 1}__\n`;
  });

  if (isStreaming) {
    remaining = remaining.replace(/<create_file\s+path="([^"]+)"[^>]*>[\s\S]*$/, (_, fname) =>
      `\n__WRITING_FILE:${fname}__\n`
    );
    remaining = remaining.replace(/<run_command>[\s\S]*$/, "\n__WRITING_CMD__\n");
  } else {
    remaining = remaining.replace(/<create_file\s[^>]*>[\s\S]*$/, "");
    remaining = remaining.replace(/<run_command>[\s\S]*$/, "");
  }

  const result: ContentPart[] = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0; let m;
  while ((m = re.exec(remaining)) !== null) {
    if (m.index > last) result.push(...splitPlaceholders(remaining.slice(last, m.index), actions));
    result.push({ type: "code", content: m[2].trimEnd(), lang: m[1] || undefined });
    last = m.index + m[0].length;
  }
  if (last < remaining.length) result.push(...splitPlaceholders(remaining.slice(last), actions));
  const safe = result.filter((p): p is ContentPart => p != null && typeof p === "object" && "type" in p);
  return safe.length ? safe : [{ type: "text", content }];
}

function splitPlaceholders(text: string, actions: ContentPart[]): ContentPart[] {
  const re = /__ACT_(\d+)__|__WRITING_FILE:([^_]*)__|__WRITING_FILE__|__WRITING_CMD__/g;
  const segs: ContentPart[] = [];
  let last = 0; let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ type: "text", content: text.slice(last, m.index) });
    if (m[0] === "__WRITING_FILE__") {
      segs.push({ type: "file", content: "", label: "__streaming__" });
    } else if (m[0].startsWith("__WRITING_FILE:")) {
      segs.push({ type: "file", content: m[2] || "", label: "__streaming__" });
    } else if (m[0] === "__WRITING_CMD__") {
      segs.push({ type: "cmd", content: "__streaming__", label: "__streaming__" });
    } else {
      const act = actions[parseInt(m[1])];
      if (act) segs.push(act);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ type: "text", content: text.slice(last) });
  return segs.filter(Boolean);
}

/* ─────────────── Markdown renderer ─────────────── */
function MarkdownText({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className="text-sm leading-relaxed mb-2 last:mb-0">{children}</p>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-foreground">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="italic text-foreground/80">{children}</em>
        ),
        h1: ({ children }) => (
          <h1 className="text-lg font-bold text-foreground mt-3 mb-1.5 pb-1"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-base font-semibold text-foreground mt-3 mb-1.5">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-sm font-semibold text-foreground/90 mt-2 mb-1">{children}</h3>
        ),
        ul: ({ children }) => (
          <ul className="space-y-1 my-2 pl-0">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="space-y-1 my-2 pl-0 list-none">{children}</ol>
        ),
        li: ({ children, ...props }) => {
          void (props as { ordered?: boolean }).ordered;
          return (
            <li className="flex items-start gap-2 text-sm leading-relaxed">
              <span className="shrink-0 mt-1.5"
                style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: "hsl(25 95% 53% / 0.7)",
                  display: "block", flexShrink: 0
                }} />
              <span className="flex-1">{children}</span>
            </li>
          );
        },
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer"
            className="text-accent/80 hover:text-accent underline underline-offset-2 break-words">
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="pl-3 my-2 text-sm text-foreground/60 italic"
            style={{ borderLeft: "3px solid hsl(25 95% 53% / 0.4)" }}>
            {children}
          </blockquote>
        ),
        code: ({ children, className }) => {
          if (className) return <code className={className}>{children}</code>;
          return (
            <code className="px-1.5 py-0.5 rounded-md text-[12px] font-mono"
              style={{ background: "rgba(255,255,255,0.08)", color: "hsl(25 95% 70%)" }}>
              {children}
            </code>
          );
        },
        hr: () => (
          <hr className="my-3" style={{ borderColor: "rgba(255,255,255,0.08)" }} />
        ),
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto rounded-xl"
            style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
            <table className="w-full text-sm border-collapse">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="px-3 py-2 text-left text-xs font-semibold text-foreground/60"
            style={{ background: "rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2 text-sm text-foreground/70"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            {children}
          </td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function MessageContent({
  content, chatId, isStreaming, pendingCmds, onCmdStateChange
}: {
  content: string;
  chatId?: number;
  isStreaming?: boolean;
  pendingCmds?: Map<string, RunCmd>;
  onCmdStateChange?: (cmd: string, state: CmdState, out?: string, code?: number) => void;
}) {
  const parts = parseContent(content, isStreaming);
  return (
    <>
      {parts.map((p, i) => {
        if (!p || typeof p !== "object" || !("type" in p)) return null;
        if (p.type === "code") return <CodeBlock key={i} code={p.content} lang={p.lang} />;
        if (p.type === "file") {
          const isStreamingBadge = p.label === "__streaming__";
          return (
            <FileActionBadge
              key={i}
              label={isStreamingBadge ? "__streaming__" : (p.label || p.content)}
              chatId={chatId}
              streamingLabel={isStreamingBadge ? p.content : undefined}
            />
          );
        }
        if (p.type === "toolcall" && p.toolKind) {
          return <ToolCallBadge key={i} kind={p.toolKind} content={p.content} />;
        }
        if (p.type === "cmd" && chatId && pendingCmds && onCmdStateChange) {
          const rc = pendingCmds.get(p.content) || { cmd: p.content, state: "pending" as CmdState };
          return (
            <CommandConfirmBadge key={i} rc={rc} chatId={chatId}
              onStateChange={(state, out, code) => onCmdStateChange(p.content, state, out, code)} />
          );
        }
        if (p.type === "cmd") {
          const isStreamingCmd = p.content === "__streaming__";
          return (
            <div key={i} className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-xl font-mono my-1 border bg-primary/10 border-primary/20 text-primary">
              {isStreamingCmd ? <Loader2 size={10} className="animate-spin shrink-0" /> : <Terminal size={10} />}
              {isStreamingCmd ? "Подготавливаю команду..." : p.label}
            </div>
          );
        }
        return <MarkdownText key={i} content={p.content} />;
      })}
    </>
  );
}

type AgentMode = "chat" | "plan" | "build";
type ThinkingLevel = "auto" | "t1" | "t2" | "t3" | "t4";

const MODES: { id: AgentMode; label: string; title: string }[] = [
  { id: "chat", label: "Чат", title: "Обсуждение без создания кода" },
  { id: "plan", label: "План", title: "Сначала план, потом код" },
  { id: "build", label: "Создать", title: "Сразу пишет код и файлы" },
];

const THINKING_LEVELS: { id: ThinkingLevel; label: string; title: string }[] = [
  { id: "auto", label: "Авто", title: "Уровень мышления по умолчанию" },
  { id: "t1", label: "T1 Быстрый", title: "Быстрый краткий ответ" },
  { id: "t2", label: "T2 Глубокий", title: "Тщательный анализ" },
  { id: "t3", label: "T3 Архитектор", title: "Взгляд senior architect" },
  { id: "t4", label: "T4 Консилиум", title: "Многоуровневый анализ экспертов" },
];

/* ─────────────── Main ChatArea ─────────────── */
export function ChatArea({ chatId, onFilesCreated }: { chatId: number | null; onFilesCreated?: () => void }) {
  const queryClient = useQueryClient();
  const { data: messages } = useListMessages(chatId || 0, {
    query: { enabled: !!chatId, queryKey: getListMessagesQueryKey(chatId || 0) }
  });
  const { data: chat } = useGetChat(chatId || 0, {
    query: { enabled: !!chatId, queryKey: getGetChatQueryKey(chatId || 0) }
  });
  const { streamMessage, isStreaming, streamContent, streamStatus, lastFullContent, cancelStream } = useStreamChat(chatId, onFilesCreated);

  const [input, setInput] = useState("");
  const [showCompletion, setShowCompletion] = useState(false);
  const [attachedImages, setAttachedImages] = useState<{ name: string; dataUrl: string }[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; content: string }[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [cmdStates, setCmdStates] = useState<Map<number, Map<string, RunCmd>>>(new Map());
  const [agentMode, setAgentMode] = useState<AgentMode>("build");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("auto");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevStreamingRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent]);

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && lastFullContent) {
      setShowCompletion(true);
      setTimeout(() => setShowCompletion(false), 2400);
      queryClient.invalidateQueries({ queryKey: getGetChatQueryKey(chatId || 0) });
      queryClient.invalidateQueries({ queryKey: getListChatsQueryKey() });
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, lastFullContent, chatId, queryClient]);

  const handleCmdState = useCallback((msgId: number, cmd: string, state: CmdState, out?: string, code?: number) => {
    setCmdStates(prev => {
      const next = new Map(prev);
      const msgMap = new Map(next.get(msgId) || []);
      msgMap.set(cmd, { cmd, state, output: out, exitCode: code });
      next.set(msgId, msgMap);
      return next;
    });
  }, []);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const TEXT_EXTS = ["py","ts","tsx","js","jsx","json","yaml","yml","toml","txt","md","html","css","sh","env","conf","ini","rs","go","rb","php","java","c","cpp","h"];
    Array.from(files).forEach(file => {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = e => {
          const dataUrl = e.target?.result as string;
          setAttachedImages(prev => [...prev.slice(-3), { name: file.name, dataUrl }]);
        };
        reader.readAsDataURL(file);
      } else {
        const ext = file.name.split(".").pop()?.toLowerCase() || "";
        if (TEXT_EXTS.includes(ext) || file.type.startsWith("text/")) {
          const reader = new FileReader();
          reader.onload = e => {
            const text = e.target?.result as string;
            setAttachedFiles(prev => [...prev.slice(-3), { name: file.name, content: text.slice(0, 30000) }]);
          };
          reader.readAsText(file);
        }
      }
    });
  };

  const toggleVoice = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) { alert("Голосовой ввод не поддерживается в вашем браузере"); return; }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const rec = new SR();
    rec.lang = "ru-RU";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: { results: { [n: number]: { [n: number]: { transcript: string } } } }) => {
      const transcript = e.results[0][0].transcript;
      setInput(prev => prev ? `${prev} ${transcript}` : transcript);
    };
    rec.onend = () => setIsListening(false);
    rec.onerror = () => setIsListening(false);
    recognitionRef.current = rec;
    rec.start();
    setIsListening(true);
  };

  const handleSend = () => {
    if ((!input.trim() && attachedImages.length === 0 && attachedFiles.length === 0) || isStreaming) return;
    let content = input.trim();
    if (attachedFiles.length > 0) {
      const fileBlocks = attachedFiles.map(f => {
        const ext = f.name.split(".").pop() || "";
        return `\n\n📎 **${f.name}**:\n\`\`\`${ext}\n${f.content}\n\`\`\``;
      }).join("");
      content = (content || "") + fileBlocks;
    }
    if (!content && attachedImages.length > 0) content = "(Изображение)";
    if (!content.trim()) return;
    const images = attachedImages.map(i => i.dataUrl);
    setInput("");
    setAttachedImages([]);
    setAttachedFiles([]);
    streamMessage(content, images, agentMode, thinkingLevel);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") handleSend();
  };

  /* ── Empty state (no chat selected) ── */
  if (!chatId) {
    return (
      <div className="synapse-bg flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
        <div className="flex flex-col items-center gap-5">
          <OctopusIcon swimming={false} size={72} />
          <h2 className="synapse-logo-text text-2xl font-bold tracking-widest uppercase">SYNAPSE AGENT</h2>
          <p className="max-w-xs text-center text-sm leading-relaxed text-muted-foreground/50">
            Создайте новый чат, чтобы начать
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="synapse-bg flex-1 flex flex-col h-full overflow-hidden relative">

      {showCompletion && <CompletionBurst />}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {messages?.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
            <OctopusIcon swimming={false} size={56} />
            <p className="text-muted-foreground/30 text-sm">Начните диалог с агентом</p>
          </div>
        )}

        {messages?.map(msg => {
          const msgCmds = cmdStates.get(msg.id);
          const timeStr = msg.createdAt
            ? new Date(msg.createdAt).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })
            : null;
          return (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[82%] min-w-0 overflow-hidden rounded-2xl px-4 py-3 ${
                msg.role === "user"
                  ? "bg-primary/12 border border-primary/15 text-foreground"
                  : "bg-black/18 border border-white/6 backdrop-blur-sm border-l-2 border-l-accent/50"
              }`}>
                <MessageContent
                  content={msg.content}
                  chatId={msg.role === "assistant" ? chatId : undefined}
                  pendingCmds={msgCmds}
                  onCmdStateChange={(cmd, state, out, code) => handleCmdState(msg.id, cmd, state, out, code)}
                />
                <div className="mt-2 flex items-center justify-end gap-2">
                  {msg.role === "assistant" && msg.tokensUsed > 0 && (
                    <span className="text-[10px] text-muted-foreground/35 bg-black/15 px-2 py-0.5 rounded-full">
                      {msg.tokensUsed.toLocaleString("ru")} тк
                    </span>
                  )}
                  {timeStr && (
                    <span className="text-[10px] text-muted-foreground/30 select-none">
                      {timeStr}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Streaming message */}
        {isStreaming && (
          <div className="flex justify-start">
            <div className="max-w-[82%] min-w-0 overflow-hidden rounded-2xl px-4 py-3 bg-black/18 border border-white/6 backdrop-blur-sm border-l-2 border-l-accent/50">
              {streamContent
                ? <MessageContent content={streamContent} isStreaming={true} chatId={chatId ?? undefined} />
                : (
                  <div className="flex items-center gap-2 py-1">
                    <OctopusIcon swimming size={32} />
                    <div className="flex gap-1 ml-1">
                      <span className="pulse-dot" />
                      <span className="pulse-dot d1" />
                      <span className="pulse-dot d2" />
                    </div>
                  </div>
                )
              }
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-accent/60">
                <Loader2 size={10} className="animate-spin" />
                <span>{streamStatus || "Думаю..."}</span>
                <div className="ml-auto">
                  <OctopusIcon swimming size={18} />
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="px-5 pb-4 pt-2 shrink-0">

        {/* Attachments row */}
        {(attachedImages.length > 0 || attachedFiles.length > 0) && (
          <div className="flex gap-2 mb-2 flex-wrap items-center">
            {attachedImages.map((img, i) => (
              <div key={`img-${i}`} className="relative group rounded-xl overflow-hidden shrink-0"
                style={{ width: 56, height: 56, border: "1px solid rgba(255,255,255,0.12)" }}>
                <img src={img.dataUrl} alt={img.name} className="w-full h-full object-cover" />
                <button onClick={() => setAttachedImages(prev => prev.filter((_, j) => j !== i))}
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: "rgba(0,0,0,0.7)" }}>
                  <X size={9} className="text-white" />
                </button>
              </div>
            ))}
            {attachedFiles.map((f, i) => (
              <div key={`file-${i}`} className="relative group flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-xl font-mono border shrink-0"
                style={{ background: "rgba(20,184,166,0.08)", borderColor: "rgba(20,184,166,0.25)", color: "rgba(94,234,212,0.9)" }}>
                <FileText size={10} className="shrink-0" />
                <span>{f.name}</span>
                <button onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))}
                  className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity">
                  <X size={9} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Voice listening indicator */}
        {isListening && (
          <div className="flex items-center gap-2 mb-2 px-3 py-1.5 rounded-xl text-[11px]"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "rgba(252,165,165,0.9)" }}>
            <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: "rgba(239,68,68,0.7)" }} />
            Слушаю... Говорите по-русски. Нажмите 🎤 ещё раз чтобы остановить.
          </div>
        )}

        {/* Mode + thinking selectors */}
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <div className="flex items-center rounded-xl overflow-hidden shrink-0"
            style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {MODES.map((m, i) => (
              <button
                key={m.id}
                onClick={() => setAgentMode(m.id)}
                title={m.title}
                className={`px-2.5 py-1 text-[11px] font-semibold transition-all ${
                  agentMode === m.id
                    ? m.id === "build"
                      ? "bg-primary text-primary-foreground"
                      : m.id === "plan"
                      ? "bg-accent/80 text-accent-foreground"
                      : "bg-white/15 text-foreground"
                    : "text-muted-foreground/50 hover:text-muted-foreground/80"
                } ${i > 0 ? "border-l border-white/8" : ""}`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="flex items-center rounded-xl overflow-hidden shrink-0"
            style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {THINKING_LEVELS.map((t, i) => (
              <button
                key={t.id}
                onClick={() => setThinkingLevel(t.id)}
                title={t.title}
                className={`px-2.5 py-1 text-[11px] font-semibold transition-all ${
                  thinkingLevel === t.id
                    ? "bg-white/12 text-foreground"
                    : "text-muted-foreground/40 hover:text-muted-foreground/70"
                } ${i > 0 ? "border-l border-white/8" : ""}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative flex items-center bg-black/20 border border-white/8 rounded-2xl backdrop-blur-sm focus-within:border-primary/25 transition-colors">
          <button
            onClick={() => fileInputRef.current?.click()}
            className={`shrink-0 ml-3 p-2 transition-colors rounded-xl ${(attachedImages.length + attachedFiles.length) > 0 ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground/70"}`}
            title="Прикрепить файл (картинки, код, текст)"
          >
            <Paperclip size={15} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,.py,.ts,.tsx,.js,.jsx,.json,.yaml,.yml,.toml,.txt,.md,.html,.css,.sh,.env,.conf,.ini,.rs,.go,.rb,.php,.java,.c,.cpp,.h"
            multiple
            onChange={e => { handleFiles(e.target.files); e.target.value = ""; }}
          />

          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isListening ? "Слушаю..." : "Спросить SYNAPSE"}
            disabled={isStreaming}
            className="flex-1 bg-transparent border-none outline-none px-2 py-3.5 text-sm text-foreground placeholder:text-muted-foreground/35 resize-none min-h-[52px] max-h-[180px] font-sans disabled:opacity-50"
            rows={1}
            style={{ fieldSizing: "content" } as React.CSSProperties}
            data-testid="input-message"
          />

          <button
            onClick={toggleVoice}
            className={`shrink-0 p-2 transition-all rounded-xl mr-1 ${isListening ? "text-red-400 animate-pulse" : "text-muted-foreground/40 hover:text-muted-foreground/70"}`}
            title={isListening ? "Остановить запись" : "Голосовой ввод (ru)"}
          >
            {isListening ? <MicOff size={14} /> : <Mic size={14} />}
          </button>

          {isStreaming ? (
            <button
              onClick={cancelStream}
              className="shrink-0 mr-3 p-2.5 rounded-xl transition-all text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-400/50 hover:bg-red-500/10"
              title="Остановить генерацию"
            >
              <X size={14} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() && attachedImages.length === 0 && attachedFiles.length === 0}
              className="shrink-0 mr-3 p-2.5 bg-primary disabled:bg-primary/25 text-primary-foreground rounded-xl transition-all hover:bg-primary/90 disabled:cursor-not-allowed"
              data-testid="button-send"
            >
              <Send size={14} />
            </button>
          )}
        </div>

        {/* Bottom stats */}
        <div className="mt-1.5 flex items-center justify-center gap-4 text-[10px] text-muted-foreground/30">
          <span className="flex items-center gap-1"><Zap size={9} />{(chat?.totalTokens || 0).toLocaleString("ru")} токенов</span>
          <span>{chat?.messageCount || 0} сообщений</span>
          <span className="font-mono">{chat?.model?.split("/")[1] || "—"}</span>
          <span className="opacity-50">⌘Enter · 🎤 голос · 📎 файлы</span>
        </div>
      </div>
    </div>
  );
}
