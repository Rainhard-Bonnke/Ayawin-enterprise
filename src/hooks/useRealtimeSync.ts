import { useEffect } from "react";
import { subscribeLiveEvents, useLiveEvents } from "@/hooks/useLiveEvents";
import { usePolling } from "@/hooks/usePolling";

/**
 * Keeps data fresh via WebSocket events; falls back to polling when WS is down.
 */
export function useRealtimeSync(
  onRefresh: () => void | Promise<void>,
  options?: { enabled?: boolean; pollIntervalMs?: number },
) {
  const enabled = options?.enabled ?? true;
  const pollIntervalMs = options?.pollIntervalMs ?? 30_000;
  const { connected } = useLiveEvents(enabled);

  usePolling(onRefresh, pollIntervalMs, enabled && !connected);

  useEffect(() => {
    if (!enabled) return;
    return subscribeLiveEvents((ev) => {
      if (ev.type === "sync") {
        void onRefresh();
      }
    });
  }, [enabled, onRefresh]);
}
