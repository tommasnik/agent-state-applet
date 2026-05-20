import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AgentsPage } from "./pages/AgentsPage";
import { SchedulesPage } from "./pages/SchedulesPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { PromptsPage } from "./pages/PromptsPage";
import { useAgents } from "./hooks/useAgents";
import { AgentsContext } from "./store/agents";
import "./app.css";

export default function App() {
  const agentsState = useAgents();

  return (
    <AgentsContext.Provider value={agentsState}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<AgentsPage />} />
          <Route path="schedules" element={<SchedulesPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="prompts" element={<PromptsPage />} />
        </Route>
      </Routes>
    </AgentsContext.Provider>
  );
}
