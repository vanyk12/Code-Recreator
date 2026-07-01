import { useState, useCallback, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getListMessagesQueryKey, getListChatsQueryKey } from '@workspace/api-client-react';

// Messages that were streamed but not saved to DB (DB schema mismatch, etc.)
export type UnsavedMessage = {
  id: number;
  chatId: number;
  role: 'user' | 'assistant';
  content: string;
  tokensUsed: number;
  status: string;
  createdAt: string;
};

const LS_PREFIX = 'synapse_unsaved_';

// Global cache: chatId → unsaved messages (survives chat switches + page reloads)
const unsavedCache = new Map<number, UnsavedMessage[]>();

function loadCacheFromStorage(): void {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(LS_PREFIX)) continue;
      const chatId = Number(key.slice(LS_PREFIX.length));
      if (!Number.isNaN(chatId)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try { unsavedCache.set(chatId, JSON.parse(raw)); } catch { /* corrupt */ }
        }
      }
    }
  } catch { /* localStorage unavailable */ }
}

function persistCache(chatId: number, msgs: UnsavedMessage[]): void {
  if (msgs.length === 0) {
    unsavedCache.delete(chatId);
    try { localStorage.removeItem(LS_PREFIX + chatId); } catch {}
  } else {
    unsavedCache.set(chatId, msgs);
    try { localStorage.setItem(LS_PREFIX + chatId, JSON.stringify(msgs)); } catch {}
  }
}

// Load persisted messages on module init
loadCacheFromStorage();

// Re-export for use in ChatArea image generation
export { persistCache };

/** Get total unsaved tokens for a chat (used by Sidebar) */
export function getUnsavedTokensForChat(chatId: number): number {
  const msgs = unsavedCache.get(chatId);
  if (!msgs) return 0;
  return msgs.reduce((sum, m) => sum + (m.tokensUsed || 0), 0);
}

export function useStreamChat(chatId: number | null, onFilesCreated?: () => void) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [lastFullContent, setLastFullContent] = useState<string | null>(null);
  const [unsavedMessages, setUnsavedMessages] = useState<UnsavedMessage[]>([]);
  const contentRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  // When switching chats, load this chat's unsaved messages from cache
  useEffect(() => {
    if (chatId) {
      // If DB has messages for this chat, clear unsaved (they were saved)
      setUnsavedMessages(unsavedCache.get(chatId) || []);
    } else {
      setUnsavedMessages([]);
    }
    setStreamError(null);
  }, [chatId]);

  // Helper: persist current unsaved messages to cache + localStorage
  const saveToCache = useCallback((msgs: UnsavedMessage[]) => {
    if (chatId) {
      persistCache(chatId, msgs);
    }
  }, [chatId]);

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setStreamStatus(null);
    setStreamContent('');
  }, []);

  const streamMessage = useCallback(async (
    content: string,
    images?: string[],
    mode?: string,
    thinkingLevel?: string,
  ) => {
    if (!chatId) return;
    const abortCtrl = new AbortController();
    abortRef.current = abortCtrl;
    setIsStreaming(true);
    setStreamContent('');
    setStreamStatus('Думаю...');
    setLastFullContent(null);
    contentRef.current = '';
    setStreamError(null);

    // Optimistically show user message immediately (keep previous unsaved messages)
    const optimisticUserMsg: UnsavedMessage = {
      id: Date.now(),
      chatId,
      role: 'user',
      content,
      tokensUsed: 0,
      status: 'done',
      createdAt: new Date().toISOString(),
    };
    setUnsavedMessages(prev => {
      const next = [...prev, optimisticUserMsg];
      saveToCache(next);
      return next;
    });

    try {
      const response = await fetch(`/api/chats/${chatId}/stream`, {
        method: 'POST',
        signal: abortCtrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          images: images?.length ? images : undefined,
          mode: mode || 'build',
          thinkingLevel: thinkingLevel || 'auto',
        })
      });

      if (!response.ok) {
        let errMsg = `Ошибка сервера: ${response.status}`;
        try { const e = await response.json(); errMsg = e.error || errMsg; } catch {}
        setStreamError(errMsg);
        setIsStreaming(false);
        setStreamStatus(null);
        return;
      }

      if (!response.body) {
        setStreamError('Пустой ответ от сервера');
        setIsStreaming(false);
        setStreamStatus(null);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let dbSavedUserMsg = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === '[DONE]') continue;

          try {
            const event = JSON.parse(raw);

            if (event.type === 'chunk' && event.content) {
              contentRef.current += event.content;
              setStreamContent(contentRef.current);
            } else if (event.type === 'status' && event.status) {
              setStreamStatus(event.status);
            } else if (event.type === 'title') {
              queryClient.invalidateQueries({ queryKey: getListChatsQueryKey() });
            } else if (event.type === 'files_created') {
              onFilesCreated?.();
            } else if (event.type === 'done') {
              const finalContent = contentRef.current;
              setLastFullContent(finalContent);
              setIsStreaming(false);
              setStreamStatus(null);
              setStreamContent('');

              if (event.message) {
                // DB saved — clear unsaved for this chat, refetch
                const cleared: UnsavedMessage[] = [];
                saveToCache(cleared);
                setUnsavedMessages(cleared);
                queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(chatId) });
              } else {
                // DB failed — keep assistant message locally (sync cache update first)
                const assistantMsg: UnsavedMessage = {
                  id: Date.now() + 1,
                  chatId: chatId!,
                  role: 'assistant' as const,
                  content: finalContent,
                  tokensUsed: event.tokens || 0,
                  status: 'done',
                  createdAt: new Date().toISOString(),
                };
                const current = unsavedCache.get(chatId!) || [];
                const next = [...current, assistantMsg];
                saveToCache(next);
                setUnsavedMessages(next);
              }
              queryClient.invalidateQueries({ queryKey: getListChatsQueryKey() });
            } else if (event.type === 'error') {
              const errMsg = event.content || 'Неизвестная ошибка';
              setStreamError(errMsg);
              setIsStreaming(false);
              setStreamStatus(null);
              if (contentRef.current) {
                const errorMsg: UnsavedMessage = {
                  id: Date.now() + 1,
                  chatId: chatId!,
                  role: 'assistant' as const,
                  content: contentRef.current,
                  tokensUsed: 0,
                  status: 'error',
                  createdAt: new Date().toISOString(),
                };
                const current = unsavedCache.get(chatId!) || [];
                const next = [...current, errorMsg];
                saveToCache(next);
                setUnsavedMessages(next);
              }
              setStreamContent('');
              queryClient.invalidateQueries({ queryKey: getListChatsQueryKey() });
            } else if (event.type === 'user_message') {
              if (event.message && event.message.id !== 0) {
                dbSavedUserMsg = true;
              }
            }
          } catch { /* ignore parse errors */ }
        }
      }

      // After stream ends
      if (dbSavedUserMsg) {
        // DB has the user message, remove optimistic version
        setUnsavedMessages(prev => {
          const next = prev.filter(m => m.role !== 'user');
          saveToCache(next);
          return next;
        });
        queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(chatId) });
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('Stream error:', err);
        setStreamError(err.message || 'Ошибка соединения');
      }
      setIsStreaming(false);
      setStreamStatus(null);
      setStreamContent('');
    } finally {
      abortRef.current = null;
    }
  }, [chatId, queryClient, onFilesCreated, saveToCache]);

  return { isStreaming, streamContent, streamStatus, streamError, streamMessage, lastFullContent, cancelStream, unsavedMessages };
}