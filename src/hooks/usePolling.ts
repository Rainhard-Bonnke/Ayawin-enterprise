import { useEffect, useRef, useState } from "react";

/** Polls a callback on an interval; pauses when tab is hidden. */
export function usePolling(callback: () => void | Promise<void>, intervalMs: number, enabled = true) {
  const cbRef = useRef(callback);
  const [slowMode, setSlowMode] = useState(false);

  useEffect(() => {
    cbRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const tick = async () => {
      if (document.hidden) return;
      try {
        await cbRef.current();
        if (!cancelled) setSlowMode(false);
      } catch {
        if (!cancelled) setSlowMode(true);
      }
    };

    void tick();
    timer = setInterval(tick, intervalMs);

    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, intervalMs]);

  return { reconnecting: slowMode };
}
