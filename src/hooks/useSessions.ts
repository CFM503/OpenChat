import { useState, useEffect, useCallback } from 'react';
import type { ChatMessage } from '../core/types';
import type { SessionInfo } from '../components/SessionList';
import { backendClient } from '../services/api';

export function useSessions(
  messages: ChatMessage[],
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  resetToWelcome?: () => void,
  /** Skip auto-save while streaming to avoid N POSTs per second */
  isStreaming?: boolean,
) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    backendClient
      .getSessions()
      .then(list => {
        setSessions(
          list.map(s => ({
            id: s.id,
            title: s.title,
            messageCount: s.messages.length,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          })),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeSessionId || messages.length === 0) return;
    // Don't hammer the network while tokens are streaming
    if (isStreaming) return;
    const timer = setTimeout(async () => {
      await backendClient.updateSession(activeSessionId, messages).catch(() => {});
      // Lightweight list refresh: only update the active row counts, not full re-fetch every time
      setSessions(prev =>
        prev.map(s =>
          s.id === activeSessionId
            ? { ...s, messageCount: messages.length, updatedAt: Date.now() }
            : s,
        ),
      );
    }, 1500);
    return () => clearTimeout(timer);
  }, [messages, activeSessionId, isStreaming]);

  const handleNewSession = useCallback(async () => {
    if (activeSessionId && messages.length > 0) {
      await backendClient.updateSession(activeSessionId, messages).catch(() => {});
    }
    setActiveSessionId(null);
    if (resetToWelcome) resetToWelcome();
    else setMessages([]);
  }, [activeSessionId, messages, setMessages, resetToWelcome]);

  const handleSelectSession = useCallback(
    async (id: string) => {
      const session = await backendClient.getSession(id);
      if (session) {
        setActiveSessionId(id);
        setMessages(session.messages.length ? session.messages : []);
      }
    },
    [setMessages],
  );

  const handleDeleteSession = useCallback(
    async (id: string) => {
      await backendClient.deleteSession(id);
      setSessions(prev => prev.filter(s => s.id !== id));
      if (activeSessionId === id) {
        setActiveSessionId(null);
        if (resetToWelcome) resetToWelcome();
        else setMessages([]);
      }
    },
    [activeSessionId, setMessages, resetToWelcome],
  );

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (activeSessionId) return activeSessionId;
    const result = await backendClient.createSession();
    if (result) {
      setActiveSessionId(result.id);
      setSessions(prev => [
        {
          id: result.id,
          title: 'New Chat',
          messageCount: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ...prev,
      ]);
      return result.id;
    }
    return null;
  }, [activeSessionId]);

  return {
    sessions,
    activeSessionId,
    handleNewSession,
    handleSelectSession,
    handleDeleteSession,
    ensureSession,
  };
}
