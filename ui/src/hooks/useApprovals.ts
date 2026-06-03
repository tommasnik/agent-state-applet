import { useState, useEffect, useRef, useCallback } from "react";

const WS_URL = "/ws";
const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

// ----------------------------------------------------------------
// Types — mirrors server ApprovalRow (server/src/routes/approvals.ts)
// ----------------------------------------------------------------

export interface Approval {
  id: number;
  run_id: number | null;
  session_id: string | null;
  created_at: string;
  status: "pending" | "answered" | "dismissed";
  payload: string | null;
  answer: string | null;
  answered_at: string | null;
}

export interface ApprovalsState {
  approvals: Approval[];
  loading: boolean;
}

/**
 * Subscribes to the pending approval queue.
 *
 * - Seeds from `GET /api/approvals` (pending only).
 * - Opens its own WebSocket to `/ws` and listens for the discrete approval
 *   events the server broadcasts (`approval_pending` adds, `approval_answer`
 *   removes). The agents snapshot messages (which carry an `agents` dict) are
 *   ignored here — they are handled by `useAgents`.
 *
 * `removeLocal` lets the page optimistically drop an item after it has answered
 * or dismissed it via the REST API, without waiting for a WS round-trip.
 */
export function useApprovals(): ApprovalsState & { removeLocal: (id: number) => void } {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  const upsert = useCallback((row: Approval) => {
    setApprovals((prev) => {
      if (row.status !== "pending") {
        return prev.filter((a) => a.id !== row.id);
      }
      const idx = prev.findIndex((a) => a.id === row.id);
      if (idx === -1) return [...prev, row];
      const next = prev.slice();
      next[idx] = row;
      return next;
    });
  }, []);

  const removeLocal = useCallback((id: number) => {
    setApprovals((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const scheduleReconnectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}${WS_URL}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) return;
      backoffRef.current = INITIAL_BACKOFF_MS;
    };

    ws.onmessage = (event: MessageEvent) => {
      if (unmountedRef.current) return;
      let msg: unknown;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      const e = msg as { event?: string; approval?: Approval; id?: number };
      if (e.event === "approval_pending" && e.approval) {
        upsert(e.approval);
      } else if (e.event === "approval_answer" && typeof e.id === "number") {
        removeLocal(e.id);
      }
      // any other message (e.g. the agents snapshot) is ignored here
    };

    ws.onclose = () => {
      if (unmountedRef.current) return;
      scheduleReconnectRef.current();
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [upsert, removeLocal]);

  const scheduleReconnect = useCallback(() => {
    if (unmountedRef.current) return;
    const delay = backoffRef.current;
    backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
    timeoutRef.current = setTimeout(() => {
      if (!unmountedRef.current) connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    scheduleReconnectRef.current = scheduleReconnect;
  }, [scheduleReconnect]);

  // initial fetch
  useEffect(() => {
    let cancelled = false;
    fetch("/api/approvals")
      .then((r) => r.json())
      .then((data: { approvals?: Approval[] }) => {
        if (cancelled) return;
        setApprovals(data.approvals ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ws lifecycle
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

  return { approvals, loading, removeLocal };
}
