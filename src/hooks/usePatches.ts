import { useState, useCallback } from 'react';
import type { PendingPatchView } from '../components/DiffReviewPanel';
import { apiUrl } from '../lib/apiBase';

export function usePatches() {
  const [patches, setPatches] = useState<PendingPatchView[]>([]);
  const [busy, setBusy] = useState(false);

  const upsertPatch = useCallback((p: PendingPatchView) => {
    setPatches(prev => {
      // Replace same path with latest staging
      const without = prev.filter(x => x.path !== p.path && x.id !== p.id);
      return [p, ...without];
    });
  }, []);

  const removePatch = useCallback((id: string) => {
    setPatches(prev => prev.filter(p => p.id !== id));
  }, []);

  const applyPatch = useCallback(async (id: string): Promise<string | null> => {
    setBusy(true);
    try {
      const resp = await fetch(apiUrl(`/api/patches/${encodeURIComponent(id)}/apply`), {
        method: 'POST',
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Apply failed');
      removePatch(id);
      return typeof data.path === 'string' ? data.path : null;
    } finally {
      setBusy(false);
    }
  }, [removePatch]);

  const rejectPatch = useCallback(async (id: string) => {
    setBusy(true);
    try {
      await fetch(apiUrl(`/api/patches/${encodeURIComponent(id)}/reject`), { method: 'POST' });
      removePatch(id);
    } finally {
      setBusy(false);
    }
  }, [removePatch]);

  const applyAll = useCallback(async (sessionId?: string): Promise<string[]> => {
    setBusy(true);
    try {
      const resp = await fetch(apiUrl('/api/patches/apply-all'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = await resp.json();
      setPatches([]);
      return Array.isArray(data.applied) ? data.applied : [];
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(async (sessionId?: string) => {
    try {
      const q = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
      const resp = await fetch(apiUrl(`/api/patches${q}`));
      const ct = resp.headers.get('content-type') || '';
      if (!resp.ok || !ct.includes('application/json')) return;
      const data = await resp.json();
      if (Array.isArray(data.patches)) setPatches(data.patches);
    } catch {
      /* ignore */
    }
  }, []);

  return {
    patches,
    busy,
    upsertPatch,
    removePatch,
    applyPatch,
    rejectPatch,
    applyAll,
    refresh,
    setPatches,
  };
}
