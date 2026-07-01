
import { useState, useRef, useEffect } from "react";

interface TerminalPanelProps {
  chatId: number | null;
}

interface TerminalLine {
  type: "input" | "output" | "error";
  text: string;
}

const API_BASE = (import.meta as any).env?.VITE_API_URL || "";

export function TerminalPanel({ chatId }: TerminalPanelProps) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const getToken = () => localStorage.getItem("auth_token");

  const executeCommand = async (cmd: string) => {
    if (!cmd.trim()) return;
    setLines((prev) => [...prev, { type: "input", text: cmd }]);
    setHistory((prev) => [...prev, cmd]);
    setHistoryIndex(-1);
    setIsRunning(true);
    setInput("");

    try {
      const res = await fetch(`${API_BASE}/api/terminal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        },
        body: JSON.stringify({ command: cmd, chatId }),
      });
      const data = await res.json();
      if (data.output) {
        setLines((prev) => [...prev, { type: "output", text: data.output }]);
      }
      if (data.error) {
        setLines((prev) => [...prev, { type: "error", text: data.error }]);
      }
      if (!data.output && !data.error) {
        setLines((prev) => [...prev, { type: "output", text: "[команда выполнена]" }]);
      }
    } catch (e: any) {
      setLines((prev) => [...prev, { type: "error", text: e.message || "Network error" }]);
    } finally {
      setIsRunning(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isRunning) {
      executeCommand(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length > 0) {
        const newIdx = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIdx);
        setInput(history[newIdx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex !== -1) {
        const newIdx = historyIndex + 1;
        if (newIdx >= history.length) {
          setHistoryIndex(-1);
          setInput("");
        } else {
          setHistoryIndex(newIdx);
          setInput(history[newIdx]);
        }
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 font-mono text-xs">
        {lines.length === 0 && (
          <div className="text-muted-foreground/50 py-2">
            Терминал готов. Введите команду и нажмите Enter.
          </div>
        )}
        {lines.map((line, i) => (
          <div
            key={i}
            className={`whitespace-pre-wrap break-all mb-1 ${
              line.type === "input"
                ? "text-green-400"
                : line.type === "error"
                ? "text-red-400"
                : "text-foreground/80"
            }`}
          >
            {line.type === "input" ? (
              <><span className="text-blue-400">$</span> {line.text}</>
            ) : (
              line.text
            )}
          </div>
        ))}
        {isRunning && (
          <div className="flex items-center gap-2 text-muted-foreground mt-1">
            <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            Выполнение...
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border">
        <span className="text-green-400 font-mono text-xs">$</span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRunning}
          placeholder="Введите команду..."
          className="flex-1 bg-transparent text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
        />
      </div>
    </div>
  );
}
