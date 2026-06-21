let _initData = "";

export function setInitData(data: string) {
  _initData = data;
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (_initData) {
    headers["X-Telegram-Init-Data"] = _initData;
  }
  return fetch(`/api${path}`, { ...options, headers });
}

export interface Chat {
  id: number;
  title: string;
  model: string;
  totalTokens: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: number;
  chatId: number;
  role: "user" | "assistant" | "system";
  content: string;
  tokensUsed: number;
  createdAt: string;
}

export async function listChats(): Promise<Chat[]> {
  const r = await apiFetch("/chats");
  if (!r.ok) throw new Error("Failed to load chats");
  return r.json();
}

export async function createChat(title: string, model: string): Promise<Chat> {
  const r = await apiFetch("/chats", {
    method: "POST",
    body: JSON.stringify({ title, model }),
  });
  if (!r.ok) throw new Error("Failed to create chat");
  return r.json();
}

export async function deleteChat(id: number): Promise<void> {
  await apiFetch(`/chats/${id}`, { method: "DELETE" });
}

export async function listMessages(chatId: number): Promise<Message[]> {
  const r = await apiFetch(`/chats/${chatId}/messages`);
  if (!r.ok) throw new Error("Failed to load messages");
  return r.json();
}

export async function streamChat(
  chatId: number,
  content: string,
  onChunk: (text: string) => void,
  onStatus: (s: string) => void,
  onDone: () => void,
  onError: (e: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (_initData) headers["X-Telegram-Init-Data"] = _initData;

  const r = await fetch(`/api/chats/${chatId}/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content, mode: "build", thinkingLevel: "auto" }),
    signal,
  });

  if (!r.ok || !r.body) {
    onError("Ошибка подключения к агенту");
    return;
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === "[DONE]") continue;
      try {
        const ev = JSON.parse(raw);
        if (ev.type === "chunk" && ev.content) onChunk(ev.content);
        else if (ev.type === "status" && ev.status) onStatus(ev.status);
        else if (ev.type === "done") onDone();
        else if (ev.type === "error") onError(ev.error || "Ошибка");
      } catch { /* ignore */ }
    }
  }
}
