import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopbarStats } from "../pages/AgentsPage";

export function Layout() {
  return (
    <div className="layout">
      <Sidebar />
      <div className="main-wrapper">
        <header className="topbar">
          <div className="topbar-spacer" />
          <TopbarStats />
        </header>
        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
