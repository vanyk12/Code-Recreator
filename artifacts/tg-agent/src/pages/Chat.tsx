import { useState, useEffect, useRef, useCallback } from "react";
import {
  listChats, createChat, listMessages, streamChat, deleteChat,
  type Chat, type Message,
} from "../lib/api";
import { useTelegram, getDisplayName } from "../hooks/useTelegram";

const DEFAULT_MODEL = "google/gemini-2.5-flash-preview-05-20";

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];

  const flushCode = (key: string) => {
    elements.push(
      <pre key={key} className="my-1">
        <code className={`language-${codeLang}`}>{codeLines.join("\n")}</code>
      </pre>
    );
    codeLines = [];
    codeLang = "";
  };

  lines.forEach((line, i) => {
    if (line.startsWith("```")) {
      if (!inCode) {
        inCode = true;
        codeLang = line.slice(3).trim();
      } else {
        inCode = false;
        flushCode(`code-${i}`);
      }
      return;
    }
    if (inCode) { codeLines.push(line); return; }

    let content: string | React.ReactNode = line;

    const formatted = line
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/^#{1,3} (.+)/, "<strong>$1</strong>")
      .replace(/^[-*] (.+)/, "• $1");

    elements.push(
      <p key={i} className={line.startsWith("• ") ? "ml-2" : ""} dangerouslySetInnerHTML={{ __html: formatted }} />
    );
  });

  if (inCode && codeLines.length) flushCode("code-final");

  return <div className="space-y-0.5 text-sm leading-relaxed">{elements}</div>;
}

function ChatList({
  chats,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onClose,
}: {
  chats: Chat[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col" style={{ background: "var(--tg-theme-bg-color, #1c1c1e)" }}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
        <button onClick={onClose} className="text-[var(--tg-theme-hint-color)] text-sm">
          ← Назад
        </button>
        <span className="font-semibold flex-1 text-center">Чаты</span>
        <button
          onClick={onCreate}
          className="text-sm font-medium"
          style={{ color: "var(--accent)" }}
        >
          + Новый
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {chats.length === 0 && (
          <div className="text-center py-12 text-sm" style={{ color: "var(--tg-theme-hint-color)" }}>
            Нет чатов
          </div>
        )}
        {chats.map((c) => (
          <div
            key={c.id}
            className="flex items-center px-4 py-3 border-b border-white/5 active:opacity-70"
            style={{ background: c.id === activeId ? "var(--tg-theme-secondary-bg-color)" : "transparent" }}
          >
            <button className="flex-1 text-left" onClick={() => { onSelect(c.id); onClose(); }}>
              <div className="font-medium text-sm truncate">{c.title}</div>
              <div className="text-xs mt-0.5" style={{ color: "var(--tg-theme-hint-color)" }}>
                {c.messageCount} сообщ. · {new Date(c.updatedAt).toLocaleDateString("ru")}
              </div>
            </button>
            {c.id !== activeId && (
              <button
                onClick={() => onDelete(c.id)}
                className="ml-2 text-xs px-2 py-1 rounded opacity-40 hover:opacity-70"
                style={{ color: "var(--tg-theme-hint-color)" }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { user } = useTelegram();

  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamStatus, setStreamStatus] = useState("");
  const [showChats, setShowChats] = useState(false);
  const [loading, setLoading] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  useEffect(() => {
    loadChats();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamText]);

  async function loadChats() {
    try {
      const list = await listChats();
      setChats(list);
      if (list.length > 0) {
        await selectChat(list[0]);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function selectChat(chat: Chat) {
    setActiveChat(chat);
    setMessages([]);
    try {
      const msgs = await listMessages(chat.id);
      setMessages(msgs);
    } catch { /* ignore */ }
    scrollToBottom();
  }

  async function handleNewChat() {
    try {
      const name = getDisplayName(user);
      const chat = await createChat(`Чат ${name}`.slice(0, 40), DEFAULT_MODEL);
      const updated = await listChats();
      setChats(updated);
      await selectChat(chat);
      setShowChats(false);
    } catch { /* ignore */ }
  }

  async function handleDeleteChat(id: number) {
    try {
      await deleteChat(id);
      const updated = await listChats();
      setChats(updated);
      if (activeChat?.id === id) {
        if (updated.length > 0) await selectChat(updated[0]);
        else { setActiveChat(null); setMessages([]); }
      }
    } catch { /* ignore */ }
  }

  async function handleSend() {
    const content = input.trim();
    if (!content || streaming) return;
    if (!activeChat) {
      await handleNewChat();
      return;
    }

    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const userMsg: Message = {
      id: Date.now(),
      chatId: activeChat.id,
      role: "user",
      content,
      tokensUsed: 0,
      createdAt: new Date().toISOString(),
    };
    setMessages((p) => [...p, userMsg]);
    setStreaming(true);
    setStreamText("");
    setStreamStatus("Думаю...");
    scrollToBottom();

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let fullText = "";

    try {
      await streamChat(
        activeChat.id,
        content,
        (chunk) => { fullText += chunk; setStreamText(fullText); },
        (s) => setStreamStatus(s),
        async () => {
          setStreaming(false);
          setStreamText("");
          setStreamStatus("");
          const msgs = await listMessages(activeChat.id);
          setMessages(msgs);
          const updated = await listChats();
          setChats(updated);
          scrollToBottom();
        },
        (_e) => {
          setStreaming(false);
          setStreamText("");
          setStreamStatus("");
        },
        ctrl.signal,
      );
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setStreaming(false);
      setStreamText("");
      setStreamStatus("");
    } finally {
      abortRef.current = null;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex gap-1.5">
          <div className="typing-dot" />
          <div className="typing-dot" />
          <div className="typing-dot" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div
        className="flex items-center px-4 py-3 gap-3 border-b border-white/10 shrink-0"
        style={{ background: "var(--tg-theme-header-bg-color, #1c1c1e)" }}
      >
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
          style={{ background: "var(--accent)" }}>
          S
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">
            {activeChat ? activeChat.title : "SYNAPSE AGENT"}
          </div>
          {streaming && (
            <div className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
              {streamStatus}
            </div>
          )}
        </div>
        <button
          onClick={() => setShowChats(true)}
          className="text-xs px-3 py-1.5 rounded-full border border-white/10"
          style={{ color: "var(--tg-theme-hint-color)" }}
        >
          Чаты
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
        {!activeChat && messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
              style={{ background: "var(--tg-theme-secondary-bg-color)" }}>
              🤖
            </div>
            <div>
              <div className="font-semibold mb-1">SYNAPSE AGENT</div>
              <div className="text-sm" style={{ color: "var(--tg-theme-hint-color)" }}>
                Напишите задачу — агент создаст код, отредактирует файлы и запустит команды
              </div>
            </div>
            <button
              onClick={handleNewChat}
              className="px-6 py-3 rounded-2xl font-medium text-sm"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              Начать чат
            </button>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "user" ? (
              <div className="bubble-user text-sm">{msg.content}</div>
            ) : (
              <div className="bubble-assistant">
                <MarkdownText text={msg.content} />
                <div className="text-xs mt-1 opacity-50">{formatTime(msg.createdAt)}</div>
              </div>
            )}
          </div>
        ))}

        {/* Streaming bubble */}
        {streaming && (
          <div className="flex justify-start">
            <div className="bubble-assistant">
              {streamText ? (
                <>
                  <MarkdownText text={streamText} />
                  <span className="pulse ml-1 text-sm">▋</span>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                  </div>
                  <span className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
                    {streamStatus}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="input-bar px-3 py-2 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={autoResize}
            onKeyDown={handleKeyDown}
            placeholder="Напишите задачу..."
            disabled={streaming}
            className="flex-1 resize-none rounded-2xl px-4 py-2.5 text-sm outline-none leading-relaxed"
            style={{
              background: "var(--tg-theme-bg-color, #1c1c1e)",
              color: "var(--tg-theme-text-color, #fff)",
              border: "1px solid rgba(255,255,255,0.12)",
              maxHeight: "120px",
              overflowY: "auto",
            }}
          />
          <button
            onClick={streaming ? () => { abortRef.current?.abort(); setStreaming(false); setStreamText(""); } : handleSend}
            disabled={!streaming && !input.trim()}
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-opacity"
            style={{
              background: streaming ? "#ff3b30" : (!input.trim() ? "rgba(255,255,255,0.15)" : "var(--accent)"),
              color: "#fff",
            }}
          >
            {streaming ? "■" : "↑"}
          </button>
        </div>
        {!activeChat && chats.length === 0 && (
          <div className="text-center text-xs mt-1.5" style={{ color: "var(--tg-theme-hint-color)" }}>
            Первое сообщение создаст новый чат
          </div>
        )}
      </div>

      {/* Chat list overlay */}
      {showChats && (
        <ChatList
          chats={chats}
          activeId={activeChat?.id ?? null}
          onSelect={(id) => {
            const c = chats.find((x) => x.id === id);
            if (c) selectChat(c);
          }}
          onCreate={handleNewChat}
          onDelete={handleDeleteChat}
          onClose={() => setShowChats(false)}
        />
      )}
    </div>
  );
}
