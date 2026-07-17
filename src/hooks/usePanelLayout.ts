import { useState, useEffect, useRef } from 'react';

export function usePanelLayout() {
  const [leftPanelPct, setLeftPanelPct] = useState(() => {
    const saved = localStorage.getItem('openchat_left_panel_pct');
    return saved ? Math.min(80, Math.max(20, parseFloat(saved))) : 45;
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isResizingRef = useRef(false);
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    localStorage.setItem('openchat_left_panel_pct', String(leftPanelPct));
  }, [leftPanelPct]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizingRef.current || !mainRef.current) return;
      const rect = mainRef.current.getBoundingClientRect();
      const sidebarWidth = sidebarCollapsed ? 0 : 260;
      const x = e.clientX - rect.left - sidebarWidth;
      const usable = rect.width - sidebarWidth - 8;
      if (usable <= 0) return;
      setLeftPanelPct(Math.min(75, Math.max(25, (x / usable) * 100)));
    };
    const onUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [sidebarCollapsed]);

  const startResize = () => {
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return {
    leftPanelPct,
    sidebarCollapsed,
    setSidebarCollapsed,
    mainRef,
    startResize,
  };
}
