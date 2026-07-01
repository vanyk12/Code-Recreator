
import { useState } from "react";
import { toast } from "sonner";

interface GitPanelProps {
  chatId: number | null;
}

const API_BASE = (import.meta as any).env?.VITE_API_URL || "";

export function GitPanel({ chatId }: GitPanelProps) {
  const [status, setStatus] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [commitMsg, setCommitMsg] = useState("");

  const getToken = () => localStorage.getItem("auth_token");

  const runGitCommand = async (command: string) => {
    if (!chatId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/terminal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        },
        body: JSON.stringify({ command, chatId }),
      });
      const data = await res.json();
      setStatus(data.output || data.error || "[no output]");
    } catch (e: any) {
      setStatus(e.message || "Error");
      toast.error(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      <div className="text-sm font-semibold text-foreground">Git</div>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => runGitCommand("git status")}
          disabled={isLoading || !chatId}
          className="px-2.5 py-1.5 text-xs rounded-md bg-muted hover:bg-muted/80 text-foreground disabled:opacity-50 transition-colors"
        >
          git status
        </button>
        <button
          onClick={() => runGitCommand("git log --oneline -10")}
          disabled={isLoading || !chatId}
          className="px-2.5 py-1.5 text-xs rounded-md bg-muted hover:bg-muted/80 text-foreground disabled:opacity-50 transition-colors"
        >
          git log
        </button>
        <button
          onClick={() => runGitCommand("git branch -a")}
          disabled={isLoading || !chatId}
          className="px-2.5 py-1.5 text-xs rounded-md bg-muted hover:bg-muted/80 text-foreground disabled:opacity-50 transition-colors"
        >
          git branch
        </button>
        <button
          onClick={() => runGitCommand("git diff --stat")}
          disabled={isLoading || !chatId}
          className="px-2.5 py-1.5 text-xs rounded-md bg-muted hover:bg-muted/80 text-foreground disabled:opacity-50 transition-colors"
        >
          git diff
        </button>
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Clone репозитория</label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="https://github.com/owner/repo"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-md bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <button
            onClick={() => {
              if (repoUrl.trim()) {
                runGitCommand(`git clone ${repoUrl.trim()}`);
                setRepoUrl("");
              }
            }}
            disabled={isLoading || !repoUrl.trim()}
            className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Clone
          </button>
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Commit & Push</label>
        <input
          type="text"
          placeholder="Сообщение коммита..."
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs border border-border rounded-md bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/50 mb-2"
        />
        <button
          onClick={() => {
            if (commitMsg.trim()) {
              runGitCommand(`git add -A && git commit -m "${commitMsg.trim()}" && git push`);
              setCommitMsg("");
            }
          }}
          disabled={isLoading || !commitMsg.trim()}
          className="w-full px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Commit & Push
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <label className="text-xs text-muted-foreground mb-1">Вывод</label>
        <div className="flex-1 overflow-y-auto bg-[#0a0a0a] rounded-md p-3 font-mono text-xs text-foreground/80">
          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              Выполнение...
            </div>
          )}
          <pre className="whitespace-pre-wrap break-all">{status || "[нет вывода]"}</pre>
        </div>
      </div>
    </div>
  );
}
