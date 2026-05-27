import { NavLink } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/", label: "Agents" },
  { to: "/schedules", label: "Schedules" },
  { to: "/projects", label: "Projects" },
  { to: "/prompts", label: "Prompts" },
  { to: "/runs", label: "Runs" },
];

export function Sidebar() {
  return (
    <nav className="sidebar">
      <div className="sidebar-title">Agent State</div>
      <ul className="sidebar-nav">
        {NAV_ITEMS.map(({ to, label }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                "sidebar-link" + (isActive ? " sidebar-link--active" : "")
              }
            >
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
