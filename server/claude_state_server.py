#!/usr/bin/env python3
"""Claude Code Agent State Server.

Receives state pushes from Claude Code hooks via HTTP POST /agent,
tracks running agents (with PID liveness checks), and writes current
state atomically to /tmp/claude-agents.json for the Cinnamon applet.

API contract (POST /agent, JSON body):
    pid           int     PID of the Claude Code process (use $PPID in hook)
    cwd           str     Working directory of the Claude Code session
    state         str     idle | busy | waiting_for_approval | session_end
    hook_event    str     PreToolUse | PostToolUse | Notification | Stop | SubagentStop
    tool_name     str     Tool name (relevant when state=busy)
    session_id    str     Claude Code session ID
    subagent_count int    Number of currently active subagents (optional)
    window_id     str     X11 window ID (decimal) captured at session start
    tab_name      str     IntelliJ terminal tab title (cc-<session_id[:8]>)

POST /focus {pid}: switch desktop and raise the agent's IDE window.
"""

import json
import os
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

STATE_FILE = "/tmp/claude-agents.json"
HOST = "127.0.0.1"
PORT = 7855
PID_CHECK_INTERVAL = 5   # seconds between liveness sweeps

agents = {}
agents_lock = threading.Lock()


def write_state():
    tmp = STATE_FILE + ".tmp"
    with agents_lock:
        snapshot = {k: dict(v) for k, v in agents.items()}
    payload = {"agents": snapshot, "updated_at": time.time()}
    with open(tmp, "w") as f:
        json.dump(payload, f)
    os.replace(tmp, STATE_FILE)


def pid_alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except OSError:
        return False


def _parse_xid(s):
    if not s:
        return None
    try:
        return int(str(s), 16) if str(s).startswith("0x") else int(s)
    except (ValueError, TypeError):
        return None


def get_open_xids():
    """Returns set of integer X11 window IDs from wmctrl, or None on error."""
    try:
        env = {**os.environ, "DISPLAY": os.environ.get("DISPLAY", ":0")}
        r = subprocess.run(["wmctrl", "-l"], capture_output=True, text=True, timeout=3, env=env)
        xids = set()
        for line in r.stdout.splitlines():
            parts = line.split(None, 1)
            if parts:
                xid = _parse_xid(parts[0])
                if xid is not None:
                    xids.add(xid)
        return xids
    except Exception:
        return None


def pid_checker():
    while True:
        time.sleep(PID_CHECK_INTERVAL)
        open_xids = get_open_xids()
        changed = False
        with agents_lock:
            for pid, agent in list(agents.items()):
                if not pid_alive(pid):
                    del agents[pid]
                    changed = True
                    continue
                # If the agent's IDE window no longer exists, remove the agent
                # even if the process itself is still alive (e.g. IDEA closed
                # but Claude survived the SIGHUP).
                if open_xids is not None:
                    wid = _parse_xid(agent.get("window_id", ""))
                    if wid and wid not in open_xids:
                        del agents[pid]
                        changed = True
        if changed:
            write_state()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _respond(self, code, body=b""):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/status":
            self._respond(404)
            return
        with agents_lock:
            data = {"agents": dict(agents), "updated_at": time.time()}
        self._respond(200, json.dumps(data).encode())

    def do_POST(self):
        if self.path == "/focus":
            self._handle_focus()
            return
        if self.path != "/agent":
            self._respond(404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length))
        except (ValueError, TypeError):
            self._respond(400, b'{"error":"invalid json"}')
            return

        pid = str(data.get("pid", "")).strip()
        if not pid or not pid.isdigit():
            self._respond(400, b'{"error":"missing pid"}')
            return

        state      = data.get("state", "idle")
        hook_event = data.get("hook_event", "")
        tty        = data.get("tty", "")
        now        = time.time()

        with agents_lock:
            if state == "session_end":
                agents.pop(pid, None)
            else:
                # When a new session starts on the same PTY, remove any lingering
                # done agents from the previous session on that terminal (/clear).
                if tty and hook_event == "SessionStart":
                    for old_pid in list(agents.keys()):
                        if old_pid != pid and agents[old_pid].get("tty") == tty \
                                and agents[old_pid].get("state") == "done":
                            del agents[old_pid]

                existing = agents.get(pid, {})
                agents[pid] = {
                    "pid": int(pid),
                    "cwd": data.get("cwd", existing.get("cwd", "")),
                    "state": state,
                    "timestamp": now,
                    "hook_event": hook_event,
                    "tool_name": data.get("tool_name", ""),
                    "session_id": data.get("session_id", existing.get("session_id", "")),
                    "subagent_count": data.get("subagent_count", existing.get("subagent_count", 0)),
                    "started_at": existing.get("started_at", now),
                    # window_id / tab_name are set once at UserPromptSubmit and preserved
                    "window_id":    data.get("window_id",    existing.get("window_id",    "")),
                    "tab_name":     data.get("tab_name",     existing.get("tab_name",     "")),
                    "tty":          data.get("tty",          existing.get("tty",          "")),
                    "project_root": data.get("project_root", existing.get("project_root", "")),
                }

        write_state()
        self._respond(200, b'{"ok":true}')

    def _handle_focus(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length))
        except (ValueError, TypeError):
            self._respond(400, b'{"error":"invalid json"}')
            return

        pid = str(data.get("pid", "")).strip()
        if not pid or not pid.isdigit():
            self._respond(400, b'{"error":"missing pid"}')
            return

        with agents_lock:
            agent = agents.get(pid)

        if not agent:
            self._respond(404, b'{"error":"agent not found"}')
            return

        window_id    = agent.get("window_id", "")
        project_root = agent.get("project_root", "")
        env = {**os.environ, "DISPLAY": os.environ.get("DISPLAY", ":0")}
        try:
            r = subprocess.run(["wmctrl", "-l"], capture_output=True, text=True, timeout=2, env=env)
            windows = []
            for line in r.stdout.splitlines():
                parts = line.split(None, 3)
                if len(parts) >= 3:
                    windows.append({
                        "xid":     parts[0],
                        "desktop": parts[1],
                        "title":   parts[3] if len(parts) >= 4 else "",
                    })

            # IDEA titles: "project-name – current-file.ext"
            # Each project has its own window; match by project name prefix.
            if project_root:
                project_name = project_root.rstrip("/").split("/")[-1]
                for w in windows:
                    t = w["title"]
                    if t == project_name or t.startswith(project_name + " ") \
                            or t.startswith(project_name + "–") \
                            or t.startswith(project_name + "—"):
                        window_id = w["xid"]
                        break

            if not window_id:
                self._respond(404, b'{"error":"no window"}')
                return

            # Switch to the window's desktop before focusing
            try:
                target_xid = int(window_id, 16) if window_id.startswith("0x") else int(window_id)
            except ValueError:
                target_xid = None
            if target_xid:
                for w in windows:
                    try:
                        if int(w["xid"], 16) == target_xid:
                            subprocess.run(["wmctrl", "-s", w["desktop"]], env=env, timeout=2)
                            break
                    except ValueError:
                        pass

            subprocess.Popen(["wmctrl", "-i", "-a", window_id], env=env)
        except Exception:
            pass

        # Ask the IDEA plugin to switch to the correct terminal tab.
        tab_name = agent.get("tab_name", "")
        if tab_name and project_root:
            project_name = project_root.rstrip("/").split("/")[-1]
            try:
                import urllib.request as _ur
                import urllib.parse as _up
                qs = _up.urlencode({"tabName": tab_name, "project": project_name})
                _ur.urlopen(f"http://localhost:63342/api/terminalFocus?{qs}", timeout=1)
            except Exception:
                pass

        self._respond(200, b'{"ok":true}')


def main():
    threading.Thread(target=pid_checker, daemon=True).start()

    server = HTTPServer((HOST, PORT), Handler)
    print(f"Claude State Server on {HOST}:{PORT}", flush=True)

    def _shutdown(sig, frame):
        try:
            os.unlink(STATE_FILE)
        except FileNotFoundError:
            pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)
    server.serve_forever()


if __name__ == "__main__":
    main()
