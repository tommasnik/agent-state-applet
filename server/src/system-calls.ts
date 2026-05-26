import { execSync, spawnSync } from "child_process";
import * as http from "http";

export interface SystemCalls {
  wmctrlList(): string;
  wmctrlFocus(xid: string): void;
  wmctrlSwitchDesktop(desktop: string): void;
  httpGet(url: string): void;
}

export const defaultSystemCalls: SystemCalls = {
  wmctrlList(): string {
    const env = { ...process.env, DISPLAY: process.env["DISPLAY"] ?? ":0" };
    return execSync("wmctrl -l", { timeout: 2000, env }).toString();
  },
  wmctrlFocus(xid: string): void {
    const env = { ...process.env, DISPLAY: process.env["DISPLAY"] ?? ":0" };
    spawnSync("wmctrl", ["-i", "-a", xid], { env, timeout: 2000 });
  },
  wmctrlSwitchDesktop(desktop: string): void {
    const env = { ...process.env, DISPLAY: process.env["DISPLAY"] ?? ":0" };
    spawnSync("wmctrl", ["-s", desktop], { env, timeout: 2000 });
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
