/**
 * Coalesce high-frequency stream updates into one React commit per animation frame.
 * Makes the UI feel smoother and uses far less CPU than setState-per-token.
 */
export function createStreamBatcher(flush: () => void) {
  let scheduled = false;
  let cancelled = false;

  return {
    schedule() {
      if (cancelled || scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        if (!cancelled) flush();
      });
    },
    /** Force immediate flush (e.g. on done / error) */
    flushNow() {
      scheduled = false;
      if (!cancelled) flush();
    },
    cancel() {
      cancelled = true;
    },
  };
}
