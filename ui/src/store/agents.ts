import { createContext, useContext } from "react";

export interface Agent {
  pid: number;
  cwd: string;
  state: string;
  timestamp: number;
  hook_event: string;
  tool_name: string;
  session_id: string;
  subagent_count: number;
  started_at: number;
  window_id: string;
  tab_name: string;
  terminal_type: string;
  tty: string;
  project_root: string;
  ai_title: string;
  ghostty_tab_index?: number | null;
}

export type AgentsDict = Record<string, Agent>;

export interface WsMessage {
  agents: AgentsDict;
  reviews: unknown[];
  updated_at: number;
}

export interface AgentsState {
  agents: AgentsDict;
  reviews: unknown[];
  connected: boolean;
  updatedAt: number | null;
}

export const AgentsContext = createContext<AgentsState>({
  agents: {},
  reviews: [],
  connected: false,
  updatedAt: null,
});

export function useAgentsStore(): AgentsState {
  return useContext(AgentsContext);
}

export const STATE_COLORS: Record<string, string> = {
  initialized: "var(--color-initialized)",
  working: "var(--color-working)",
  asking_user: "var(--color-asking-user)",
  waiting_for_approval: "var(--color-waiting-for-approval)",
  done: "var(--color-done)",
};

export const STATE_LABELS: Record<string, string> = {
  initialized: "initialized",
  working: "working",
  asking_user: "asking",
  waiting_for_approval: "waiting",
  done: "done",
};

export function stateColor(state: string): string {
  return STATE_COLORS[state] ?? "var(--text-muted)";
}

export function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}
