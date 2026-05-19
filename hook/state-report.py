#!/usr/bin/env python3
"""Claude Code hook: reports agent state + window metadata to claude-state-server."""

import json
import os
import subprocess
import sys
import urllib.request

SERVER_URL = "http://127.0.0.1:7855/agent"

HOOK_STATE = {
    "SessionStart":     "initialized",
    "UserPromptSubmit": "working",
    "PreToolUse":       "working",
    "PostToolUse":      "working",
    "Notification":     "waiting_for_approval",
    "Stop":             "done",
}

ASK_USER_TOOLS = {"AskUserQuestion", "AskUserQuestions"}

_IDEA_MARKERS = (
    "intellij", "idea64", "idea.sh", "-didea", "jetbrains",
    "pycharm", "webstorm", "goland", "clion", "rider",
)

# Strong markers identify the true repo root (SCM root takes precedence over
# per-package files so that monorepos report the top-level name, not a subpackage).
_STRONG_MARKERS = (".git",)
_WEAK_MARKERS   = (".idea", "pyproject.toml", "package.json", "Cargo.toml", "go.mod", "pom.xml")


def _is_idea_pid(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            cmd = f.read().decode(errors="replace").lower()
        return any(k in cmd for k in _IDEA_MARKERS)
    except Exception:
        return False


def get_window_id_for_pid(target_pid):
    """Find the X11 window that owns the terminal containing target_pid.

    Walks the process tree upward from target_pid and checks each ancestor
    against the PID reported by wmctrl for each window.  Prefers windows
    belonging to IntelliJ/JetBrains processes over other ancestors.
    Falls back to _NET_ACTIVE_WINDOW if wmctrl is unavailable or finds nothing.
    """
    display = os.environ.get("DISPLAY", ":0")
    env = {**os.environ, "DISPLAY": display}

    windows_by_pid = {}
    try:
        r = subprocess.run(
            ["wmctrl", "-l", "-p"], capture_output=True, text=True, timeout=0.1, env=env,
        )
        for line in r.stdout.splitlines():
            parts = line.split(None, 4)
            if len(parts) >= 3:
                try:
                    windows_by_pid[int(parts[2])] = parts[0]
                except ValueError:
                    pass
    except Exception:
        pass

    if windows_by_pid:
        pid = target_pid
        visited = set()
        first_win = None
        while pid > 1 and pid not in visited:
            visited.add(pid)
            if pid in windows_by_pid:
                win_id = windows_by_pid[pid]
                if _is_idea_pid(pid):
                    return win_id  # found the IDE window — stop here
                if first_win is None:
                    first_win = win_id
            try:
                with open(f"/proc/{pid}/status") as f:
                    for line in f:
                        if line.startswith("PPid:"):
                            pid = int(line.split()[1])
                            break
                    else:
                        break
            except Exception:
                break
        if first_win:
            return first_win

    # Fallback: active window
    try:
        r = subprocess.run(
            ["xprop", "-display", display, "-root", "_NET_ACTIVE_WINDOW"],
            capture_output=True, text=True, timeout=0.1,
        )
        for part in r.stdout.split():
            if part.startswith("0x"):
                return part
    except Exception:
        pass
    return ""


def find_project_root(cwd):
    """Walk up from cwd to find the project root.

    Strong markers (.git) take priority over weak ones (package.json etc.) so
    that monorepos report the repo root rather than a nested sub-package dir.
    """
    path = cwd
    prev = None
    weak_candidate = None
    while path and path != prev and path != "/":
        if any(os.path.exists(os.path.join(path, m)) for m in _STRONG_MARKERS):
            return path
        if weak_candidate is None and any(os.path.exists(os.path.join(path, m)) for m in _WEAK_MARKERS):
            weak_candidate = path
        prev = path
        path = os.path.dirname(path)
    return weak_candidate or cwd


def get_tty(pid):
    """Return the PTY path (e.g. /dev/pts/3) for stdin of the given PID."""
    try:
        tty = os.readlink(f"/proc/{pid}/fd/0")
        if tty.startswith("/dev/pts/"):
            return tty
    except Exception:
        pass
    return ""


def get_terminal_type(claude_pid):
    """Return terminal type: 'ghostty', 'idea', or 'generic'."""
    if os.environ.get("TERM_PROGRAM") == "ghostty" or os.environ.get("TERM") == "xterm-ghostty":
        return "ghostty"
    pid = claude_pid
    visited = set()
    while pid > 1 and pid not in visited:
        visited.add(pid)
        if _is_idea_pid(pid):
            return "idea"
        try:
            with open(f"/proc/{pid}/status") as f:
                for line in f:
                    if line.startswith("PPid:"):
                        pid = int(line.split()[1])
                        break
                else:
                    break
        except Exception:
            break
    return "generic"


def set_terminal_title(claude_pid, title):
    """Write OSC-0 escape to Claude's stdin PTY to rename the terminal tab."""
    try:
        tty = os.readlink(f"/proc/{claude_pid}/fd/0")
        if tty.startswith("/dev/pts/"):
            with open(tty, "w") as f:
                f.write(f"\033]0;{title}\007")
    except Exception:
        pass


def post(payload):
    try:
        data = json.dumps(payload).encode()
        req = urllib.request.Request(
            SERVER_URL, data=data,
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=0.1)
    except Exception:
        pass


def find_claude_pid():
    """Return the Claude process PID, skipping any shell wrapper Claude may use to run hooks."""
    parent = os.getppid()
    try:
        with open(f"/proc/{parent}/cmdline", "rb") as f:
            cmd = f.read().replace(b"\x00", b" ").decode(errors="replace").strip()
        basename = cmd.split()[0].split("/")[-1] if cmd.split() else ""
        if basename in ("bash", "sh", "dash", "zsh", "fish"):
            with open(f"/proc/{parent}/status") as f:
                for line in f:
                    if line.startswith("PPid:"):
                        return int(line.split()[1])
    except Exception:
        pass
    return parent


def main():
    try:
        hook = json.loads(sys.stdin.read())
    except Exception:
        sys.exit(0)

    event      = hook.get("hook_event_name", "")
    session_id = hook.get("session_id", "")
    tool_name  = hook.get("tool_name", "")
    state = HOOK_STATE.get(event)
    if state is None:
        sys.exit(0)
    if event == "PreToolUse" and tool_name in ASK_USER_TOOLS:
        state = "asking_user"
    claude_pid = find_claude_pid()
    cwd        = os.getcwd()

    payload = {
        "pid":          claude_pid,
        "session_id":   session_id,
        "state":        state,
        "hook_event":   event,
        "tool_name":    tool_name,
        "cwd":          cwd,
        "project_root": find_project_root(cwd),
        "tty":          get_tty(claude_pid),
    }

    if event in ("SessionStart", "UserPromptSubmit"):
        wid = get_window_id_for_pid(claude_pid)
        tab = f"cc-{session_id[:8]}" if session_id else ""
        payload["window_id"]     = wid
        payload["tab_name"]      = tab
        payload["terminal_type"] = get_terminal_type(claude_pid)
        if tab:
            set_terminal_title(claude_pid, tab)
            if event == "SessionStart":
                project_name = find_project_root(cwd).rstrip("/").split("/")[-1]
                try:
                    import urllib.parse as _up
                    qs = _up.urlencode({"newName": tab, "project": project_name})
                    urllib.request.urlopen(
                        f"http://localhost:63342/api/terminalRename?{qs}", timeout=0.1
                    )
                except Exception:
                    pass

    post(payload)


if __name__ == "__main__":
    main()
