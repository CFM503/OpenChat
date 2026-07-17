import { useState, useEffect, useCallback } from 'react';
import type { ChatMessage } from '../core/types';
import type { SessionInfo } from '../components/SessionList';
import { backendClient } from '../services/api';

export function useSessions(
  messages: ChatMessage[],
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
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
    const timer = setTimeout(async () => {
      await backendClient.updateSession(activeSessionId, messages).catch(() => {});
      const list = await backendClient.getSessions().catch(() => null);
      if (list) {
        setSessions(
          list.map(s => ({
            id: s.id,
            title: s.title,
            messageCount: s.messages.length,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          })),
        );
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [messages, activeSessionId]);

  const handleNewSession = useCallback(async () => {
    if (activeSessionId && messages.length > 0) {
      await backendClient.updateSession(activeSessionId, messages).catch(() => {});
    }
    setMessages([]);
    setActiveSessionId(null);
  }, [activeSessionId, messages, setMessages]);

  const handleSelectSession = useCallback(
    async (id: string) => {
      const session = await backendClient.getSession(id);
      if (session) {
        setActiveSessionId(id);
        setMessages(session.messages);
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
        setMessages([]);
      }
    },
    [activeSessionId, setMessages],
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
