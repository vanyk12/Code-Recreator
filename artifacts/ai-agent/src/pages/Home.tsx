import { useState, useCallback } from "react";
import { useListChats } from "@workspace/api-client-react";
import { ChatArea } from "@/components/ChatArea";
import { Sidebar } from "@/components/Sidebar";
import { RightPanel } from "@/components/RightPanel";
import { TgCrawlModal } from "@/components/TgCrawlModal";
import { useAuth, useTheme } from "@/App";
import { getSupabaseState } from "@/lib/supabase";
import { AUTH_ENABLED } from "@/lib/auth";
import { Bot, MessageSquare, Wrench, Search } from "lucide-react";

interface CrawlResult {
  bot_info: { first_name: string; username: string; description: string };
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

export function Home() {
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const [fileRefreshKey, setFileRefreshKey] = useState(0);
  const [crawlModalOpen, setCrawlModalOpen] = useState(false);
  const { loading: authLoading } = useAuth();
  const { data: chats } = useListChats({
    query: { enabled: !AUTH_ENABLED || !authLoading },
  });
  const { user } = useAuth();
  const { theme, toggle } = useTheme();

  const handleFilesCreated = useCallback(() => {
    setFileRefreshKey(k => k + 1);
  }, []);

  const handleCrawlComplete = useCallback((result: CrawlResult, botUsername: string) => {
    // Закрываем модал и создаём чат с результатами парсинга
    setCrawlModalOpen(false);

    const structureText = result.structure_text || JSON.stringify(result.menu_nodes, null, 2);

    const prompt =
      `Вот реальные данные парсинга бота @${botUsername} (собрано через Telethon, ${result.total_nodes} узлов меню):\n\n` +
      `${structureText}\n\n` +
      `Создай полный рабочий клон этого бота на основе РЕАЛЬНЫХ данных выше. ` +
      `Включи все меню, кнопки, логику. Файлы: main.py, requirements.txt, .env.example, config.py, database.py. ` +
      `Если есть команды (/start, /help и т.д.) — реализуй их. ` +
      `Если в текстах упоминаются платёжные системы (Qiwi, YooMoney, крипта) — добавь заглушки для них. ` +
      `Создай ВСЕ файлы через <create_file>.`;

    handleQuickStart(prompt, `Парсинг @${botUsername}`);
  }, []);

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <Sidebar activeChatId={activeChatId} onSelectChat={setActiveChatId} />
      {activeChatId ? (
        <>
          <ChatArea chatId={activeChatId} onFilesCreated={handleFilesCreated} />
          <RightPanel chatId={activeChatId} fileRefreshKey={fileRefreshKey} />
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center" style={{ background: "hsl(222 47% 8%)" }}>
          <div className="text-center max-w-lg px-6">
            <img
              src="/synapse-icon.webp"
              alt="Synapse"
              className="w-16 h-16 rounded-2xl mx-auto mb-6 opacity-80"
            />
            <h2 className="text-2xl font-bold text-foreground mb-2">SYNAPSE AGENT</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-8">
              Создай новый чат или выбери существующий. Я помогу написать код,
              <br />
              клонировать Telegram-ботов и развернуть проекты.
            </p>

            {/* Quick Actions */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <QuickAction
                icon={<Bot size={22} />}
                label="Парсинг бота"
                desc="Реальный обход через Telethon"
                onClick={() => setCrawlModalOpen(true)}
              />
              <QuickAction
                icon={<MessageSquare size={22} />}
                label="Новый проект"
                desc="Создать с нуля"
                onClick={() => handleQuickStart(
                  "Создай новый проект с нуля. Опиши что нужно сделать и я напишу весь код.",
                  "Новый проект"
                )}
              />
              <QuickAction
                icon={<Wrench size={22} />}
                label="Fix кода"
                desc="Исправить баги"
                onClick={() => handleQuickStart(
                  "У меня есть код с багом. Помоги найти и исправить проблему.",
                  "Fix кода"
                )}
              />
              <QuickAction
                icon={<Search size={22} />}
                label="Анализ кода"
                desc="Разобрать и объяснить"
                onClick={() => handleQuickStart(
                  "Проанализируй код в рабочей области. Объясни структуру, найди проблемы и предложи улучшения.",
                  "Анализ кода"
                )}
              />
            </div>

            {/* User info */}
            {user && (
              <div
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl mx-auto"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                {user.user_metadata?.avatar_url ? (
                  <img src={user.user_metadata.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-primary/30 flex items-center justify-center text-xs text-primary font-bold">
                    {(user.user_metadata?.name?.[0] || user.email?.[0] || "?").toUpperCase()}
                  </div>
                )}
                <span className="text-xs text-muted-foreground">
                  {user.user_metadata?.name || user.user_metadata?.full_name || user.email?.split("@")[0]}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <TgCrawlModal
        open={crawlModalOpen}
        onClose={() => setCrawlModalOpen(false)}
        onCrawlComplete={handleCrawlComplete}
      />
    </div>
  );

  async function handleQuickStart(message: string, title: string) {
    try {
      // Get auth token from Supabase session
      const { client: sb } = getSupabaseState();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (sb) {
        const { data: { session: s } } = await sb.auth.getSession();
        if (s?.access_token) {
          headers["Authorization"] = `Bearer ${s.access_token}`;
        }
      }

      // Create chat
      const chatRes = await fetch("/api/chats", {
        method: "POST",
        headers,
        body: JSON.stringify({ title, model: "anthropic/claude-3.5-sonnet" }),
      });
      if (!chatRes.ok) {
        console.error("Failed to create chat:", chatRes.status);
        return;
      }
      const chat = await chatRes.json();
      setActiveChatId(chat.id);

      // Send the pre-filled message after a short delay (stream endpoint)
      setTimeout(() => {
        fetch(`/api/chats/${chat.id}/stream`, {
          method: "POST",
          headers,
          body: JSON.stringify({ content: message, mode: "build" }),
        }).catch(() => {});
      }, 500);
    } catch (err) {
      console.error("Quick start error:", err);
    }
  }
}

function QuickAction({
  icon,
  label,
  desc,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start gap-1.5 px-4 py-3.5 rounded-2xl text-left transition-all hover:scale-[1.02] hover:bg-white/[0.06]"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-primary/80">{icon}</span>
        <span className="text-sm font-semibold text-foreground">{label}</span>
      </div>
      <span className="text-[11px] text-muted-foreground/70 leading-snug pl-8">{desc}</span>
    </button>
  );
}