# Claude Agent State Applet — agent context

## What this project is

A Cinnamon desktop panel applet that shows live state of every running Claude Code session as a colored dot. The user runs Claude Code in IntelliJ IDEA terminal tabs; this applet lets them see at a glance which agents are busy, done, or waiting — across multiple projects and terminal tabs — without switching windows.

## Components (read this before touching anything)

```
state-report.py  →  HTTP :7855  →  /tmp/claude-agents.json  →  applet.js
   (hook)            (server)          (state file)            (Cinnamon panel)
```

| File | What it is | Runs as |
|------|-----------|---------|
| `~/.claude/hooks/state-report.py` | Claude hook, fires on every Claude event | subprocess per event |
| `server/claude_state_server.py` | HTTP server, aggregates state | systemd user service `claude-state-server` |
| `applet/applet.js` | Cinnamon applet, reads state file | inside Cinnamon shell |

**The server must be running** for anything to work. Check: `systemctl --user status claude-state-server`

## Key design decisions

- **Grouping by `project_root`**, not by window: the hook detects the nearest ancestor dir with `.git`/`.idea`/etc. and sends it. This is more reliable than X11 window IDs from wmctrl.
- **`window_id` is still tracked** (via wmctrl process-tree walk) for the focus action (clicking dot/label → `wmctrl -i -a window_id`).
- **`tty`** (PTY path like `/dev/pts/3`) is tracked per agent so the server can detect when a new session starts on the same terminal (after `/clear`) and remove the old done agent.
- **Inotify** watches `/tmp/` for changes to `claude-agents.json`. Fallback poll every 3s.
- **Notifications** via `notify-send`, suppressed if the agent's IDE window is focused.
- The server indexes agents by **PID** (string). PID liveness is checked every 5s; dead PIDs are removed.

## State machine

```
SessionStart → initialized (grey)
UserPromptSubmit / PreToolUse / PostToolUse → working (yellow)
PreToolUse with AskUserQuestion/AskUserQuestions → asking_user (blue)
Notification → waiting_for_approval (orange)
Stop → done (green)
```

`done` agents are kept visible until: PID dies (pid_checker removes them), OR a new session starts on the same TTY (server removes them immediately).

## HTTP API (server on :7855)

```
POST /agent   — update agent state (called by hook)
POST /focus   — wmctrl focus window for given PID
GET  /status  — dump current agents dict (debugging)
```

POST /agent payload fields:
- `pid`, `cwd`, `state`, `hook_event`, `tool_name`, `session_id`
- `project_root` — project root dir (from hook, for grouping)
- `tty` — PTY path like /dev/pts/3 (for /clear detection)
- `window_id` — X11 window ID hex string (set at SessionStart/UserPromptSubmit only)
- `tab_name` — terminal tab title, format `cc-<session_id[:8]>`
- `subagent_count`

## How to apply changes

**Hook** (`state-report.py`) — no restart, executes fresh each time.

**Server** (`claude_state_server.py`) — `systemctl --user restart claude-state-server`

**Applet** (`applet.js`) — run `make applet` (copies the file + reloads via D-Bus). Underlying command:
```
gdbus call --session --dest org.Cinnamon --object-path /org/Cinnamon --method org.Cinnamon.ReloadXlet "claude-agent-state@tommasnik" "APPLET"
```
Note: `dbus-send` does NOT work for this — use `gdbus call`.

## Common tasks

- **Add a new agent state/color**: add to `STATE_COLOR` and `STATE_LABEL` in `applet.js`, add mapping in `HOOK_STATE` in `state-report.py`.
- **Change grouping key**: edit `_update()` in `applet.js` (the `gkey` line) and the `_projectName()` method.
- **Add a new server endpoint**: add `elif self.path == "/new-endpoint":` in `Handler.do_POST` or `do_GET`.
- **Change notification behavior**: edit `_sendNotification` calls in `applet.js` `_update()`.
- **Debug state file**: `curl -s http://127.0.0.1:7855/status | python3 -m json.tool`
- **Test without Claude running**: POST to `/agent` manually (see README for curl example).

## What NOT to break

- The server writes the state file atomically via `os.replace()` on a temp file — the applet watches the directory for `IN_MOVED_TO` events. Don't change to in-place writes.
- `window_id` is preserved across events (only updated at SessionStart/UserPromptSubmit). Don't send it on every event — it would cause unnecessary wmctrl calls.
- The `started_at` timestamp is set once and preserved. Don't overwrite it.
