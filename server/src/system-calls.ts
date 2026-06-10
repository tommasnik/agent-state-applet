import { execSync, spawnSync } from "child_process";
import * as http from "http";

export interface SystemCalls {
  wmctrlList(): string;
  wmctrlFocus(xid: string): void;
  wmctrlSwitchDesktop(desktop: string): void;
  httpGet(url: string): void;
}

// The systemd user service often starts before the graphical session imports
// DISPLAY/XAUTHORITY into the user manager, so process.env may lack both
// (GNOME/GDM runs on :1 with Xauthority under /run/user/<uid>/gdm/, so a
// hardcoded :0 fallback silently breaks wmctrl). Resolve them per call from
// `systemctl --user show-environment`, which the session keeps up to date.
export function resolveXEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!env["DISPLAY"] || !env["XAUTHORITY"]) {
    try {
      const out = execSync("systemctl --user show-environment", { timeout: 2000 }).toString();
      for (const line of out.split("\n")) {
        const m = /^(DISPLAY|XAUTHORITY)=(.*)$/.exec(line);
        if (m && !env[m[1]]) env[m[1]] = m[2];
      }
    } catch {
      // systemctl unavailable — fall through to defaults
    }
  }
  if (!env["DISPLAY"]) env["DISPLAY"] = ":0";
  return env;
}

export const defaultSystemCalls: SystemCalls = {
  wmctrlList(): string {
    return execSync("wmctrl -l", { timeout: 2000, env: resolveXEnv() }).toString();
  },
  wmctrlFocus(xid: string): void {
    spawnSync("wmctrl", ["-i", "-a", xid], { env: resolveXEnv(), timeout: 2000 });
  },
  wmctrlSwitchDesktop(desktop: string): void {
    spawnSync("wmctrl", ["-s", desktop], { env: resolveXEnv(), timeout: 2000 });
  },
  httpGet(url: string): void {
    try {
      const req = http.request(url, { timeout: 1000 });
      req.on("error", () => {/* ignore */});
      req.end();
    } catch {
      // ignore
    }
  },
};
