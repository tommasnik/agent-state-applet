import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import type { AgentsDict } from "./agents";

let _wss: WebSocketServer | null = null;

export function createWsServer(
  httpServer: Server,
  getInitialState?: () => object
): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    ws.on("error", () => {});
    if (getInitialState) {
      try {
        ws.send(JSON.stringify(getInitialState()));
      } catch {
        // ignore
      }
    }
  });

  _wss = wss;
  return wss;
}

/** Broadcast an arbitrary message to all connected WebSocket clients */
export function broadcast(msg: object): void {
  if (!_wss || _wss.clients.size === 0) return;
  const payload = JSON.stringify(msg);
  for (const client of _wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch {
        // ignore send errors
      }
    }
  }
}

/** Broadcast current agents state to all connected WebSocket clients */
export function broadcastState(
  wss: WebSocketServer,
  agents: AgentsDict,
  reviews: unknown[] = []
): void {
  if (wss.clients.size === 0) return;

  const payload = JSON.stringify({
    agents,
    reviews,
    updated_at: Date.now() / 1000,
  });

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch {
        // ignore send errors
      }
    }
  }
}
