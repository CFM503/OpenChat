import { useState, useEffect, useRef, useCallback } from 'react';
import { backendClient } from '../services/api';

export type ConnectionState = 'online' | 'offline' | 'reconnecting' | 'checking';

export function useBackend() {
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('checking');
  const backendAvailableRef = useRef(false);

  const probe = useCallback(async () => {
    // Fast path: WebSocket already open — skip HTTP probe most of the time
    if (backendClient.isConnected()) {
      if (!backendAvailableRef.current) {
        setBackendAvailable(true);
        backendAvailableRef.current = true;
        setConnectionState('online');
      }
      return;
    }

    const available = await backendClient.isAvailable();
    if (available) {
      const connected = await backendClient.connect();
      if (connected) {
        if (!backendAvailableRef.current) {
          setBackendAvailable(true);
          backendAvailableRef.current = true;
        }
        setConnectionState(prev => (prev === 'online' ? prev : 'online'));
        return;
      }
      setConnectionState('reconnecting');
      return;
    }
    setBackendAvailable(false);
    backendAvailableRef.current = false;
    setConnectionState(prev => (prev === 'offline' ? prev : 'offline'));
  }, []);

  useEffect(() => {
    probe();
    // Heartbeat — 15s is enough; was 8s and caused extra re-renders
    const id = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      probe();
    }, 15000);
    const onVis = () => {
      if (document.visibilityState === 'visible') probe();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      backendClient.disconnect();
    };
  }, [probe]);

  const markUnavailable = useCallback(() => {
    setBackendAvailable(false);
    backendAvailableRef.current = false;
    setConnectionState('offline');
  }, []);

  const markAvailable = useCallback(() => {
    setBackendAvailable(true);
    backendAvailableRef.current = true;
    setConnectionState('online');
  }, []);

  return {
    backendAvailable,
    backendAvailableRef,
    connectionState,
    markUnavailable,
    markAvailable,
    reconnect: probe,
  };
}
