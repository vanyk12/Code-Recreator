import { Plus, Trash, Settings, Sun, Moon, PanelLeftClose, PanelLeftOpen, LogOut } from "lucide-react";
import { useListChats, useCreateChat, useDeleteChat, getListChatsQueryKey, getGetChatQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { SettingsDialog } from "./SettingsDialog";
import { useState, useEffect } from "react";
import { useTheme } from "@/App";
import { CLERK_ENABLED } from "@/lib/clerk";
import { useClerk, useUser } from "@clerk/react";

// Safe Clerk hooks — return stubs when Clerk is disabled
function useSafeClerk() {
  try {
    return useClerk();
  } catch { return { signOut: () => {} }; }
}
function useSafeUser() {
  try {
    return useUser();
  } catch { return { user: null }; }
}

export function Sidebar({ activeChatId, onSelectChat }: { activeChatId: number | null; onSelectChat: (id: number | null) => void }) {
  const { data: chats } = useListChats();
  const createChat = useCreateChat();
  const deleteChat = useDeleteChat();
  const queryClient = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [defaultModel, setDefaultModel] = useState("anthropic/claude-3.5-sonnet");
  const { theme, toggle } = useTheme();
  const { signOut } = useSafeClerk();
  const { user } = useSafeUser();

  useEffect(() => {
    fetch("/api/settings")
      .then(r => r.json())
      .then((d: Record<string, string>) => {
        if (d.default_model) setDefaultModel(d.default_model);
      })
      .catch(() => {});
  }, []);

  const handleNewChat = () => {
    createChat.mutate({ data: { title: "Новый чат", model: defaultModel } }, {
      onSuccess: (chat) => {
        onSelectChat(chat.id);
        queryClient.invalidateQueries({ queryKey: getListChatsQueryKey() });
      }
    });
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    deleteChat.mutate({ id }, {
      onSuccess: () => {
        if (activeChatId === id) onSelectChat(null);
        queryClient.invalidateQueries({ queryKey: getListChatsQueryKey() });
      }
    });
  };

  const handleModelSaved = () => {
    if (activeChatId) {
      queryClient.invalidateQueries({ queryKey: getGetChatQueryKey(activeChatId) });
      queryClient.invalidateQueries({ queryKey: getListChatsQueryKey() });
    }
  };

  const handleSignOut = () => {
    signOut();
    queryClient.clear();
  };

  /* ── Collapsed state ── */
  if (collapsed) {
    return (
      <>
        <div
          className="synapse-sidebar-bg flex flex-col items-center py-3 gap-3 h-full shrink-0"
          style={{ width: 52, borderRight: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="flex flex-col items-center gap-1 mb-1">
            <img
              src="/synapse-icon.webp"
              alt="Synapse"
              className="w-8 h-8 rounded-xl cursor-pointer hover:scale-105 transition-transform"
              onClick={() => setCollapsed(false)}
              title="Открыть историю чатов"
            />
          </div>

          <button
            onClick={() => setCollapsed(false)}
            className="p-2 rounded-xl text-muted-foreground/40 hover:text-primary hover:bg-white/5 transition-all"
            title="Открыть боковую панель"
          >
            <PanelLeftOpen size={15} />
          </button>

          <button
            onClick={() => { setCollapsed(false); handleNewChat(); }}
            className="p-2 rounded-xl bg-primary/80 hover:bg-primary text-primary-foreground transition-all"
            title="Новый чат"
          >
            <Plus size={15} />
          </button>

          <div className="flex-1 flex flex-col items-center gap-1.5 py-1 overflow-hidden">
            {chats?.slice(0, 8).map(chat => (
              <button
                key={chat.id}
                onClick={() => { onSelectChat(chat.id); setCollapsed(false); }}
                title={chat.title || "Без названия"}
                className={`w-2 h-2 rounded-full transition-all ${
                  activeChatId === chat.id
                    ? "bg-primary scale-125"
                    : "bg-white/15 hover:bg-white/30"
                }`}
              />
            ))}
          </div>

          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-xl text-muted-foreground/40 hover:text-sidebar-foreground hover:bg-white/5 transition-all"
            title="Настройки"
          >
            <Settings size={14} />
          </button>
        </div>

        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          activeChatId={activeChatId}
          onModelSaved={handleModelSaved}
        />
      </>
    );
  }

  /* ── Expanded state ── */
  return (
    <>
      <div
        className="synapse-sidebar-bg flex flex-col h-full select-none text-sidebar-foreground"
        style={{ width: 240, borderRight: "1px solid rgba(255,255,255,0.06)", transition: "width 0.2s ease" }}
      >
        <div className="px-3 pt-3 pb-2 flex items-center gap-2">
          <img src="/synapse-icon.webp" alt="Synapse" className="w-7 h-7 rounded-xl shrink-0" />
          <span className="synapse-logo-text text-sm font-bold tracking-widest uppercase flex-1 truncate">
            SYNAPSE AGENT
          </span>
          <button
            onClick={() => setCollapsed(true)}
            className="p-1.5 rounded-xl text-muted-foreground/30 hover:text-muted-foreground/70 hover:bg-white/5 transition-all shrink-0"
            title="Свернуть панель"
          >
            <PanelLeftClose size={14} />
          </button>
        </div>

        <div className="px-3 pb-2">
          <button
            onClick={handleNewChat}
            disabled={createChat.isPending}
            className="w-full flex items-center justify-center gap-2 bg-primary/90 hover:bg-primary text-primary-foreground py-2 rounded-xl font-semibold text-sm transition-all shadow-sm"
            data-testid="button-new-chat"
          >
            <Plus size={15} />
            Новый чат
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-1 space-y-0.5">
          {(!chats || chats.length === 0) && (
            <div className="text-center text-muted-foreground text-xs py-8 px-3 leading-relaxed">
              Нет чатов.<br />Нажмите «Новый чат».
            </div>
          )}
          {chats?.map(chat => (
            <div
              key={chat.id}
              onClick={() => onSelectChat(chat.id)}
              className={`group relative px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
                activeChatId === chat.id
                  ? "bg-white/10 text-foreground"
                  : "hover:bg-white/5 text-muted-foreground hover:text-sidebar-foreground"
              }`}
              style={activeChatId === chat.id ? { borderLeft: "2px solid hsl(25 95% 53%)" } : {}}
              data-testid={`chat-item-${chat.id}`}
            >
              <div className="font-medium truncate pr-6 text-sm">{chat.title || "Без названия"}</div>
              <div className="flex justify-between mt-0.5 text-[11px] opacity-45">
                <span>{format(new Date(chat.createdAt), "d MMM, HH:mm", { locale: ru })}</span>
                <span>{chat.totalTokens.toLocaleString("ru")} тк</span>
              </div>
              <button
                onClick={(e) => handleDelete(e, chat.id)}
                className="absolute right-2 top-2.5 opacity-0 group-hover:opacity-50 hover:!opacity-100 hover:text-destructive transition-all"
                data-testid={`button-delete-chat-${chat.id}`}
              >
                <Trash size={13} />
              </button>
            </div>
          ))}
        </div>

        <div className="p-3 space-y-1">
          {user && (
            <div
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl mb-1"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              {user.imageUrl ? (
                <img src={user.imageUrl} alt="Avatar" className="w-6 h-6 rounded-full shrink-0 object-cover" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-primary/30 flex items-center justify-center shrink-0 text-xs text-primary font-bold">
                  {(user.firstName?.[0] || user.emailAddresses?.[0]?.emailAddress?.[0] || "?").toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate text-sidebar-foreground">
                  {user.firstName || user.emailAddresses?.[0]?.emailAddress?.split("@")[0] || "Пользователь"}
                </div>
                <div className="text-[10px] text-muted-foreground/60 truncate">
                  {user.emailAddresses?.[0]?.emailAddress}
                </div>
              </div>
            </div>
          )}

          <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <button
              onClick={() => setSettingsOpen(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-muted-foreground/70 hover:text-sidebar-foreground hover:bg-white/5 transition-all text-left"
              data-testid="button-open-settings"
            >
              <Settings size={14} className="shrink-0" />
              <span className="text-sm font-medium">Настройки</span>
            </button>
            <div style={{ height: "1px", background: "rgba(255,255,255,0.05)", margin: "0 10px" }} />
            <button
              onClick={toggle}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-muted-foreground/70 hover:text-sidebar-foreground hover:bg-white/5 transition-all text-left"
              data-testid="button-toggle-theme"
            >
              {theme === "dark"
                ? <><Sun size={14} className="shrink-0" /><span className="text-sm font-medium">Светлая тема</span></>
                : <><Moon size={14} className="shrink-0" /><span className="text-sm font-medium">Тёмная тема</span></>
              }
            </button>
            {CLERK_ENABLED && <>
            <div style={{ height: "1px", background: "rgba(255,255,255,0.05)", margin: "0 10px" }} />
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-muted-foreground/70 hover:text-destructive hover:bg-white/5 transition-all text-left"
              data-testid="button-sign-out"
            >
              <LogOut size={14} className="shrink-0" />
              <span className="text-sm font-medium">Выйти</span>
            </button>
            </>}
          </div>
        </div>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        activeChatId={activeChatId}
        onModelSaved={handleModelSaved}
      />
    </>
  );
}
