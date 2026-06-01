import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RunningAgentsPage } from "./pages/RunningAgentsPage";
import { AgentsPage } from "./pages/AgentsPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { PromptsPage } from "./pages/PromptsPage";
import { RunsPage } from "./pages/RunsPage";
import { useAgents } from "./hooks/useAgents";
import { AgentsContext } from "./store/agents";
import "./app.css";

export default function App() {
  const agentsState = useAgents();

  return (
    <AgentsContext.Provider value={agentsState}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<RunningAgentsPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="prompts" element={<PromptsPage />} />
          <Route path="runs" element={<RunsPage />} />
        </Route>
      </Routes>
    </AgentsContext.Provider>
  );
}
