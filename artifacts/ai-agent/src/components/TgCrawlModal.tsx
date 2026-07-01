import { useState, useRef, useEffect, useCallback } from "react";
import {
  X, Bot, Loader2, AlertCircle, CheckCircle, Phone, Hash, ChevronRight, StopCircle
} from "lucide-react";

interface CrawlResult {
  bot_info: {
    id: number;
    first_name: string;
    username: string;
    description: string;
  };
  bot_commands: Array<{ command: string; description: string }>;
  menu_nodes: Array<{
    path: string;
    label: string;
    text: string;
    buttons: Array<Array<{ label: string; callback?: string; url?: string }>>;
    depth: number;
  }>;
  total_nodes: number;
  structure_text: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCrawlComplete: (result: CrawlResult, botUsername: string) => void;
}

export function TgCrawlModal({ open, onClose, onCrawlComplete }: Props) {
  const [step, setStep] = useState<"form" | "checking" | "crawling" | "code" | "password" | "done" | "error">("form");
  const [botUsername, setBotUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [progress, setProgress] = useState<string>("");
  const [progressDetail, setProgressDetail] = useState("");
  const [error, setError] = useState("");
  const [needsSettings, setNeedsSettings] = useState(false);
  const [needsPhone, setNeedsPhone] = useState(false);
  const [nodesFound, setNodesFound] = useState(0);
  const [currentDepth, setCurrentDepth] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const jobIdRef = useRef<string>("");

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  // Проверяем настройки при открытии
  useEffect(() => {
    if (!open) return;
    setStep("checking");
    fetch("/api/tg-crawl/check-settings")
      .then(r => r.json())
      .then((data: { configured: boolean; hasSession: boolean; hasPhone: boolean }) => {
        if (!data.configured) {
          setNeedsSettings(true);
          setStep("form");
        } else {
          setNeedsSettings(false);
          setNeedsPhone(!data.hasPhone);
          setStep("form");
        }
      })
      .catch(() => setStep("form"));
  }, [open]);

  const startCrawl = useCallback((phoneNum: string, codeVal?: string, passVal?: string) => {
    setStep("crawling");
    setProgress("Запускаю краулер...");
    setError("");

    const body: Record<string, unknown> = {
      botUsername: botUsername.trim(),
      phone: phoneNum || undefined,
      maxDepth: 3,
    };
    if (codeVal) body.code = codeVal;
    if (passVal) body.password = passVal;

    // Используем fetch + ReadableStream для SSE (EventSource не поддерживает POST)
    fetch("/api/tg-crawl/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(response => {
      if (!response.ok) {
        return response.json().then((err: { error?: string; needsSettings?: boolean; needsPhone?: boolean }) => {
          if (err.needsSettings) setNeedsSettings(true);
          if (err.needsPhone) setNeedsPhone(true);
          throw new Error(err.error || `Ошибка ${response.status}`);
        });
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Нет response body");

      const decoder = new TextDecoder();
      let buffer = "";

      function read() {
        reader.read().then(({ done, value }) => {
          if (done) return;
          buffer += decoder.decode(value, { stream: true });

          // Парсим SSE
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            const lines = part.split("\n");
            let event = "message";
            let data = "";

            for (const line of lines) {
              if (line.startsWith("event: ")) event = line.slice(7).trim();
              if (line.startsWith("data: ")) data = line.slice(6);
            }

            try {
              const msg = JSON.parse(data);

              if (event === "progress") {
                setProgress(msg.message || "");
                if (msg.current) setNodesFound(msg.current);
                if (msg.depth !== undefined) setCurrentDepth(msg.depth);
                if (msg.step) setProgressDetail(msg.step);
              } else if (event === "needs_code") {
                setStep("code");
                // Сохраняем event source для отправки кода
                return;
              } else if (event === "needs_password") {
                setStep("password");
                return;
              } else if (event === "error") {
                setError(msg.message || "Неизвестная ошибка");
                setStep("error");
                return;
              } else if (event === "done") {
                setStep("done");
                setProgress(`Обход завершён! Найдено узлов: ${msg.data?.total_nodes || 0}`);
                if (msg.data) {
                  onCrawlComplete(msg.data as CrawlResult, botUsername.trim());
                }
                return;
              }
            } catch {
              // ignore parse errors
            }
          }

          read();
        }).catch(() => {});
      }

      read();
    }).catch(err => {
      setError(err.message);
      setStep("error");
    });
  }, [botUsername, onCrawlComplete]);

  const handleSubmitCode = () => {
    if (!code.trim()) return;
    // Перезапускаем с кодом
    startCrawl(phone, code.trim());
  };

  const handleSubmitPassword = () => {
    if (!password.trim()) return;
    startCrawl(phone, undefined, password.trim());
  };

  const handleStop = () => {
    eventSourceRef.current?.close();
    setStep("form");
    setProgress("");
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="settings-card rounded-2xl overflow-hidden shadow-2xl">

          {/* Header */}
          <div className="relative p-6 pb-4 overflow-hidden"
            style={{ background: "linear-gradient(135deg, hsl(220 80% 40%) 0%, hsl(260 60% 35%) 100%)" }}>
            <div className="relative z-10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
                  <Bot size={20} className="text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Парсинг бота</h2>
                  <p className="text-xs text-white/60">Telegram Bot Crawler</p>
                </div>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors">
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="p-6 space-y-4">

            {/* Форма ввода */}
            {(step === "form" || step === "checking") && (
              <>
                {step === "checking" && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 size={14} className="animate-spin" /> Проверяю настройки...
                  </div>
                )}

                {needsSettings && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                    <AlertCircle size={16} className="text-yellow-400 mt-0.5 shrink-0" />
                    <div className="text-xs text-yellow-200/80">
                      Сначала настрой API ID и API Hash в{" "}
                      <button onClick={() => { onClose(); }} className="underline text-yellow-300">
                        Настройках
                      </button>{" "}
                      (my.telegram.org → API development tools)
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Юзернейм бота</label>
                  <input
                    type="text"
                    value={botUsername}
                    onChange={e => setBotUsername(e.target.value)}
                    placeholder="@StarsMarket_bot"
                    className="w-full bg-input border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 font-mono"
                    autoFocus
                  />
                </div>

                {needsPhone && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Phone size={14} className="text-blue-400" />
                      Номер телефона (Telegram)
                    </label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="+7 900 123 4567"
                      className="w-full bg-input border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 font-mono"
                    />
                    <p className="text-[10px] text-muted-foreground/60">
                      Нужен для авторизации в Telegram. Сохраняется в настройках.
                    </p>
                  </div>
                )}

                <button
                  onClick={() => startCrawl(phone)}
                  disabled={!botUsername.trim() || needsSettings}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg, hsl(25 95% 48%), hsl(213 94% 55%))" }}
                >
                  <Bot size={16} />
                  Начать парсинг
                  <ChevronRight size={14} />
                </button>
              </>
            )}

            {/* Ввод кода */}
            {step === "code" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-blue-400">
                  <Hash size={14} /> Telegram отправил код на {phone}
                </div>
                <input
                  type="text"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder="Код из Telegram"
                  className="w-full bg-input border border-border rounded-xl px-4 py-3 text-center text-lg font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 tracking-[0.3em]"
                  autoFocus
                />
                <button
                  onClick={handleSubmitCode}
                  disabled={!code.trim()}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg, hsl(25 95% 48%), hsl(213 94% 55%))" }}
                >
                  Подтвердить
                </button>
              </div>
            )}

            {/* Ввод 2FA пароля */}
            {step === "password" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-yellow-400">
                  <AlertCircle size={14} /> Включена двухфакторная аутентификация
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Пароль 2FA"
                  className="w-full bg-input border border-border rounded-xl px-4 py-3 text-center text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-yellow-400 focus:border-yellow-400"
                  autoFocus
                />
                <button
                  onClick={handleSubmitPassword}
                  disabled={!password.trim()}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg, hsl(25 95% 48%), hsl(213 94% 55%))" }}
                >
                  Подтвердить
                </button>
              </div>
            )}

            {/* Прогресс парсинга */}
            {(step === "crawling") && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Loader2 size={18} className="animate-spin text-blue-400" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{progress || "Парсинг..."}</p>
                    {nodesFound > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Узлов собрано: {nodesFound}
                        {currentDepth > 0 && ` · Глубина: ${currentDepth}`}
                      </p>
                    )}
                  </div>
                  <button onClick={handleStop} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-red-400 transition-colors">
                    <StopCircle size={16} />
                  </button>
                </div>

                {/* Анимация шагов */}
                <div className="space-y-2">
                  {[
                    { label: "Авторизация", done: progressDetail !== "auth", active: progressDetail === "auth" },
                    { label: "Поиск бота", done: progressDetail === "bot_info" && !progress.includes("Ищу"), active: progressDetail === "bot_info" },
                    { label: "Обход меню", done: false, active: progressDetail === "crawling" },
                  ].map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {s.active ? (
                        <Loader2 size={12} className="animate-spin text-blue-400" />
                      ) : s.done ? (
                        <CheckCircle size={12} className="text-green-400" />
                      ) : (
                        <div className="w-3 h-3 rounded-full border border-border" />
                      )}
                      <span className={s.active ? "text-foreground" : "text-muted-foreground/60"}>
                        {s.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Успех */}
            {step === "done" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <CheckCircle size={24} className="text-green-400" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Парсинг завершён!</p>
                    <p className="text-xs text-muted-foreground">{progress}</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-full py-2 px-4 rounded-xl text-sm font-medium text-foreground bg-white/5 hover:bg-white/10 border border-border transition-colors"
                >
                  Закрыть
                </button>
              </div>
            )}

            {/* Ошибка */}
            {step === "error" && (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <AlertCircle size={20} className="text-red-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-300/80">{error}</p>
                </div>
                <button
                  onClick={() => { setError(""); setStep("form"); setProgress(""); }}
                  className="w-full py-2 px-4 rounded-xl text-sm font-medium text-foreground bg-white/5 hover:bg-white/10 border border-border transition-colors"
                >
                  Попробовать снова
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .settings-card { background: hsl(220 40% 11%); border: 1px solid hsl(220 30% 22%); }
      `}</style>
    </div>
  );
}