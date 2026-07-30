import { useState, useEffect, useCallback, useRef } from 'react';
import type { ChatMessage } from '../core/types';
import type { SessionInfo } from '../components/SessionList';
import { backendClient } from '../services/api';

const SESSIONS_KEY = 'openchat_local_sessions';
const ACTIVE_SESSION_KEY = 'openchat_local_active_session_id';

function loadLocalSessions(): SessionInfo[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalSessions(list: SessionInfo[]): void {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

function loadLocalMessages(sessionId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(`openchat_local_session_${sessionId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalMessages(sessionId: string, msgs: ChatMessage[]): void {
  try {
    localStorage.setItem(`openchat_local_session_${sessionId}`, JSON.stringify(msgs));
  } catch { /* ignore */ }
}

function deleteLocalSession(sessionId: string): void {
  try {
    localStorage.removeItem(`openchat_local_session_${sessionId}`);
  } catch { /* ignore */ }
}

function generateTitle(msgs: ChatMessage[]): string {
  const userMsg = msgs.find(m => m.role === 'user' && m.content?.trim());
  if (!userMsg) return 'New Chat';
  const text = userMsg.content.trim().replace(/^#+\s*/, '');
  return text.length > 30 ? text.slice(0, 30) + '…' : text;
}

export function useSessions(
  messages: ChatMessage[],
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  resetToWelcome?: () => void,
  isStreaming?: boolean,
) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const isBackendRef = useRef(false);

  // Load initial session list (Backend or LocalStorage)
  useEffect(() => {
    (async () => {
      const isConnected = backendClient.isConnected();
      isBackendRef.current = isConnected;
      if (isConnected) {
        try {
          const list = await backendClient.getSessions();
          if (list && list.length > 0) {
            setSessions(
              list.map(s => ({
                id: s.id,
                title: s.title,
                messageCount: s.messages.length,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
              })),
            );
            return;
          }
        } catch { /* fallback */ }
      }
      // LocalStorage fallback for pure static mode
      const localList = loadLocalSessions();
      setSessions(localList);

      const lastActiveId = localStorage.getItem(ACTIVE_SESSION_KEY);
      if (lastActiveId && localList.some(s => s.id === lastActiveId)) {
        setActiveSessionId(lastActiveId);
        const localMsgs = loadLocalMessages(lastActiveId);
        if (localMsgs.length > 0) {
          setMessages(localMsgs);
        }
      }
    })();
  }, []);

  // Save current messages when updated (debounce 1.5s)
  useEffect(() => {
    if (!activeSessionId || messages.length === 0 || isStreaming) return;

    const timer = setTimeout(async () => {
      if (backendClient.isConnected()) {
        await backendClient.updateSession(activeSessionId, messages).catch(() => {});
        setSessions(prev =>
          prev.map(s =>
            s.id === activeSessionId
              ? { ...s, messageCount: messages.length, updatedAt: Date.now() }
              : s,
          ),
        );
      } else {
        // Pure static mode: save to localStorage
        saveLocalMessages(activeSessionId, messages);
        const title = generateTitle(messages);
        setSessions(prev => {
          const next = prev.map(s =>
            s.id === activeSessionId
              ? {
                  ...s,
                  title: s.title === 'New Chat' || !s.title ? title : s.title,
                  messageCount: messages.length,
                  updatedAt: Date.now(),
                }
              : s,
          );
          saveLocalSessions(next);
          return next;
        });
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [messages, activeSessionId, isStreaming]);

  const handleNewSession = useCallback(async () => {
    if (activeSessionId && messages.length > 0) {
      if (backendClient.isConnected()) {
        await backendClient.updateSession(activeSessionId, messages).catch(() => {});
      } else {
        saveLocalMessages(activeSessionId, messages);
      }
    }
    setActiveSessionId(null);
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    if (resetToWelcome) resetToWelcome();
    else setMessages([]);
  }, [activeSessionId, messages, setMessages, resetToWelcome]);

  const handleSelectSession = useCallback(
    async (id: string) => {
      if (backendClient.isConnected()) {
        const session = await backendClient.getSession(id);
        if (session) {
          setActiveSessionId(id);
          setMessages(session.messages.length ? session.messages : []);
          return;
        }
      }
      // LocalStorage fallback
      setActiveSessionId(id);
      localStorage.setItem(ACTIVE_SESSION_KEY, id);
      const localMsgs = loadLocalMessages(id);
      setMessages(localMsgs);
    },
    [setMessages],
  );

  const handleDeleteSession = useCallback(
    async (id: string) => {
      if (backendClient.isConnected()) {
        await backendClient.deleteSession(id).catch(() => {});
      } else {
        deleteLocalSession(id);
      }

      setSessions(prev => {
        const next = prev.filter(s => s.id !== id);
        saveLocalSessions(next);
        return next;
      });

      if (activeSessionId === id) {
        setActiveSessionId(null);
        localStorage.removeItem(ACTIVE_SESSION_KEY);
        if (resetToWelcome) resetToWelcome();
        else setMessages([]);
      }
    },
    [activeSessionId, setMessages, resetToWelcome],
  );

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (activeSessionId) return activeSessionId;

    if (backendClient.isConnected()) {
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
    }

    // LocalStorage fallback for pure static mode (Cloudflare Pages)
    const newId = `local_session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setActiveSessionId(newId);
    localStorage.setItem(ACTIVE_SESSION_KEY, newId);

    const newSessionItem: SessionInfo = {
      id: newId,
      title: 'New Chat',
      messageCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setSessions(prev => {
      const next = [newSessionItem, ...prev];
      saveLocalSessions(next);
      return next;
    });

    return newId;
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
