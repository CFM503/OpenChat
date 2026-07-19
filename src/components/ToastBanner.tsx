// ============================================================================
// Lightweight status toast (top-right)
// ============================================================================

import React, { useEffect } from 'react';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  /** ms; default 4000 */
  duration?: number;
}

interface ToastBannerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

const COLORS: Record<ToastKind, { bg: string; border: string }> = {
  info: { bg: 'rgba(56, 98, 180, 0.95)', border: '#5b8def' },
  success: { bg: 'rgba(34, 120, 70, 0.95)', border: '#3fb950' },
  warn: { bg: 'rgba(140, 100, 20, 0.95)', border: '#d4a72c' },
  error: { bg: 'rgba(140, 40, 40, 0.95)', border: '#f85149' },
};

export function ToastBanner({ toasts, onDismiss }: ToastBannerProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 56,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 360,
        pointerEvents: 'none',
      }}
    >
      {toasts.map(t => (
        <ToastRow key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastRow({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const ms = toast.duration ?? 4000;
    const t = setTimeout(() => onDismiss(toast.id), ms);
    return () => clearTimeout(t);
  }, [toast.id, toast.duration, onDismiss]);

  const c = COLORS[toast.kind];
  return (
    <div
      role="status"
      style={{
        pointerEvents: 'auto',
        padding: '10px 14px',
        borderRadius: 8,
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: '#fff',
        fontSize: 13,
        lineHeight: 1.4,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        cursor: 'pointer',
      }}
      onClick={() => onDismiss(toast.id)}
      title="点击关闭"
    >
      {toast.message}
    </div>
  );
}
