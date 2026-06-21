import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getListMessagesQueryKey, getListChatsQueryKey } from '@workspace/api-client-react';

export function useStreamChat(chatId: number | null, onFilesCreated?: () => void) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [lastFullContent, setLastFullContent] = useState<string | null>(null);
  const contentRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

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

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
              setLastFullContent(contentRef.current);
              setIsStreaming(false);
              setStreamStatus(null);
              setStreamContent('');
              queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(chatId) });
              queryClient.invalidateQueries({ queryKey: getListChatsQueryKey() });
            } else if (event.type === 'error') {
              setIsStreaming(false);
              setStreamStatus(null);
              setStreamContent('');
              queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(chatId) });
              queryClient.invalidateQueries({ queryKey: getListChatsQueryKey() });
            } else if (event.type === 'user_message') {
              queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(chatId) });
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('Stream error:', err);
      }
      setIsStreaming(false);
      setStreamStatus(null);
      setStreamContent('');
    } finally {
      abortRef.current = null;
    }
  }, [chatId, queryClient, onFilesCreated]);

  return { isStreaming, streamContent, streamStatus, streamMessage, lastFullContent, cancelStream };
}
