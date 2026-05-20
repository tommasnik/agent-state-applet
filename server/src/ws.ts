import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import type { AgentsDict } from "./agents";

export function createWsServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    // Send a ping/pong to keep alive, nothing else needed on connect
    ws.on("error", () => {
      // ignore client errors
    });
  });

  return wss;
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
