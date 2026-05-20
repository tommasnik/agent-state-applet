import { useAgentsStore, stateColor, stateLabel } from "../store/agents";
import type { Agent } from "../store/agents";

function AgentCard({ agent }: { agent: Agent }) {
  const color = stateColor(agent.state);
  const label = stateLabel(agent.state);
  const name =
    agent.ai_title ||
    agent.tab_name ||
    agent.project_root.split("/").pop() ||
    String(agent.pid);

  return (
    <div className="agent-card">
      <span className="agent-dot" style={{ background: color }} />
      <div className="agent-info">
        <div className="agent-name">{name}</div>
        <div className="agent-meta">
          <span className="agent-state" style={{ color }}>
            {label}
          </span>
          {agent.project_root && (
            <span className="agent-project">{agent.project_root.split("/").pop()}</span>
          )}
          {agent.subagent_count > 0 && (
            <span className="agent-subagents">{agent.subagent_count} sub</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function AgentsPage() {
  const { agents, connected } = useAgentsStore();
  const agentList = Object.values(agents);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Agents</h1>
        <span className={`connection-badge ${connected ? "connected" : "disconnected"}`}>
          {connected ? "live" : "disconnected"}
        </span>
      </div>
      {agentList.length === 0 ? (
        <p className="empty-state">No active agents</p>
      ) : (
        <div className="agent-list">
          {agentList.map((agent) => (
            <AgentCard key={agent.pid} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
