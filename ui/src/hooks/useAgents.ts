import { useState, useEffect, useRef, useCallback } from "react";
import type { AgentsState, WsMessage } from "../store/agents";

const WS_URL = "/ws";
const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

export function useAgents(): AgentsState {
  const [state, setState] = useState<AgentsState>({
    agents: {},
    reviews: [],
    connected: false,
    updatedAt: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}${WS_URL}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) return;
      backoffRef.current = INITIAL_BACKOFF_MS;
      setState((prev) => ({ ...prev, connected: true }));
    };

    ws.onmessage = (event: MessageEvent) => {
      if (unmountedRef.current) return;
      try {
        const msg = JSON.parse(String(event.data)) as WsMessage;
        setState({
          agents: msg.agents ?? {},
          reviews: msg.reviews ?? [],
          connected: true,
          updatedAt: msg.updated_at ?? null,
        });
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (unmountedRef.current) return;
      setState((prev) => ({ ...prev, connected: false }));
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (unmountedRef.current) return;
    const delay = backoffRef.current;
    backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
    timeoutRef.current = setTimeout(() => {
      if (!unmountedRef.current) connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    unmountedRef.current = false;
    connect();

    return () => {
      unmountedRef.current = true;
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  return state;
}
