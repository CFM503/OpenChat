import { useState, useEffect, useRef, useCallback } from 'react';
import { backendClient } from '../services/api';

export function useBackend() {
  const [backendAvailable, setBackendAvailable] = useState(false);
  const backendAvailableRef = useRef(false);

  useEffect(() => {
    backendClient.isAvailable().then(async (available) => {
      if (available) {
        setBackendAvailable(true);
        backendAvailableRef.current = true;
        await backendClient.connect();
      }
    });
    return () => {
      backendClient.disconnect();
    };
  }, []);

  const markUnavailable = useCallback(() => {
    setBackendAvailable(false);
    backendAvailableRef.current = false;
  }, []);

  const markAvailable = useCallback(() => {
    setBackendAvailable(true);
    backendAvailableRef.current = true;
  }, []);

  return {
    backendAvailable,
    backendAvailableRef,
    markUnavailable,
    markAvailable,
  };
}
