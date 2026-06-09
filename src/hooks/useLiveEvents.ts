import { useCallback, useEffect, useRef, useState } from "react";
import { getStoredTokens, isApiSessionToken, onAccessTokenRefreshed } from "@/lib/api-v1";

export type LiveEvent = {
  type: string;
  data?: Record<string, unknown>;
  ts?: string;
};

function wsBase() {
  const api = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
  if (api) {
    const u = new URL(api);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.origin;
  }
  if (import.meta.env.DEV) return "ws://localhost:4000";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

type Listener = (event: LiveEvent) => void;
const globalListeners = new Set<Listener>();

export function subscribeLiveEvents(listener: Listener) {
  globalListeners.add(listener);
  return () => {
    globalListeners.delete(listener);
  };
}

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 15000, 30000];
const MAX_RECONNECT_ATTEMPTS = 8;

function isLiveWsEnabled() {
  const flag = import.meta.env.VITE_ENABLE_LIVE_WS;
  if (flag === "false" || flag === "0") return false;
  if (flag === "true" || flag === "1") return true;
  return true;
}

export function useLiveEvents(enabled = true) {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const hadConnectionRef = useRef(false);

  const connect = useCallback(() => {
    const { access } = getStoredTokens();
    if (!enabled || !isLiveWsEnabled() || !isApiSessionToken(access)) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const url = `${wsBase()}/ws?token=${encodeURIComponent(access!)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setReconnecting(false);
      attemptRef.current = 0;
      if (hadConnectionRef.current) {
        globalListeners.forEach((fn) => fn({ type: "sync", data: { reason: "reconnected" } }));
      }
      hadConnectionRef.current = true;
    };

    ws.onmessage = (ev) => {
      try {
        const event = JSON.parse(String(ev.data)) as LiveEvent;
        if (event.type === "pong" || event.type === "connected") return;
        globalListeners.forEach((fn) => fn(event));
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      const canRetry =
        enabled &&
        isLiveWsEnabled() &&
        isApiSessionToken(getStoredTokens().access) &&
        attemptRef.current < MAX_RECONNECT_ATTEMPTS;
      if (canRetry) {
        setReconnecting(true);
        const delay = RECONNECT_DELAYS_MS[Math.min(attemptRef.current, RECONNECT_DELAYS_MS.length - 1)];
        attemptRef.current += 1;
        retryRef.current = setTimeout(connect, delay);
      } else {
        setReconnecting(false);
      }
    };

    ws.onerror = () => {
      setReconnecting(true);
    };
  }, [enabled]);

  useEffect(() => {
    connect();
    const ping = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 60_000);

    const offRefresh = onAccessTokenRefreshed(() => {
      wsRef.current?.close();
      connect();
    });

    return () => {
      clearInterval(ping);
      offRefresh();
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected, reconnecting };
}
