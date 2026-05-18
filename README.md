# Claude Agent State Applet

> Live status of every Claude Code session — in your desktop panel.

Running 4 agents across 3 projects? This puts a colored dot per session in your panel bar so you know at a glance which ones are working, waiting for input, or done — without switching windows.

Works on **Cinnamon** and **GNOME** (X11 and Wayland).

```
┌──────────────────────────────────────────────────────────────────┐
│ panel                                                            │
│  agent-state  ● ● |  my-api  ● ● |  frontend  ●                │
│               working done   asking  working   done             │
└──────────────────────────────────────────────────────────────────┘
  click label → focus IDE window
```

| Dot color | Meaning                       |
|-----------|-------------------------------|
| grey      | Session started               |
| yellow    | Working (tool running)        |
| blue      | Waiting for your input        |
| orange    | Waiting for tool approval     |
| green     | Done                          |

---

## Requirements

### Runtime

| What                   | Why                                                          |
|------------------------|--------------------------------------------------------------|
| Linux desktop          | **Cinnamon 4+** or **GNOME Shell 45+** (X11 or Wayland)      |
| [Claude Code](https://claude.ai/code) CLI | Source of the hook events                  |
| Python 3.8+            | Hook script + state server (`stdlib` only, no pip packages)  |
| `wmctrl`               | Resolve / focus IDE windows                                  |
| `libnotify-bin`        | `notify-send` for state-change notifications                 |
| `curl`                 | Adapters POST to the local server via curl                   |
| `systemd` (user)       | Runs `claude-state-server.service`                           |

Debian / Ubuntu / Mint:

```bash
sudo apt install python3 wmctrl libnotify-bin curl
```

Fedora:

```bash
sudo dnf install python3 wmctrl libnotify curl
```

Arch:

```bash
sudo pacman -S python wmctrl libnotify curl
```

### Development / tests

Only needed if you want to run `make test` or hack on the code.

| What             | Why                                                              |
|------------------|------------------------------------------------------------------|
| `make`           | Build / reload / test orchestration                              |
| `sed`            | Generates `applet/core.js` from `shared/core.mjs` (Cinnamon path) |
| Node.js ≥ 18     | Runs JS unit tests (`node --test`)                               |
| `python3-pytest` | Runs server tests (`make test-server`)                           |
| `gdbus`          | Reloads the Cinnamon applet without restarting Cinnamon (in `glib2`) |
| `gnome-extensions` CLI | Enables/disables the GNOME extension (in `gnome-shell-common`) |

Debian / Ubuntu / Mint:

```bash
sudo apt install make nodejs python3-pytest libglib2.0-bin gnome-shell-common
```

---

## Install

```bash
git clone https://github.com/tomas-masnik/agent-state-applet ~/code/agent-state-applet
cd ~/code/agent-state-applet
./install.sh          # detects Cinnamon or GNOME automatically
```

**Cinnamon:** right-click panel → *Add applets* → search "Claude Agent State" → Add

**GNOME:** the extension is enabled automatically; on Wayland log out and back in once.

### Register the hook

`install.sh` installs the server but cannot write to `~/.claude/settings.json` (Claude Code owns that file). Add this block once:

<details>
<summary>~/.claude/settings.json — hook configuration</summary>

```json
{
  "hooks": {
    "SessionStart":     [{"hooks": [{"type": "command", "command": "python3 ~/.claude/hooks/state-report.py"}]}],
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "python3 ~/.claude/hooks/state-report.py"}]}],
    "PreToolUse":       [{"hooks": [{"type": "command", "command": "python3 ~/.claude/hooks/state-report.py"}]}],
    "PostToolUse":      [{"hooks": [{"type": "command", "command": "python3 ~/.claude/hooks/state-report.py"}]}],
    "Notification":     [{"hooks": [{"type": "command", "command": "python3 ~/.claude/hooks/state-report.py"}]}],
    "Stop":             [{"hooks": [{"type": "command", "command": "python3 ~/.claude/hooks/state-report.py"}]}],
    "SubagentStop":     [{"hooks": [{"type": "command", "command": "python3 ~/.claude/hooks/state-report.py"}]}]
  }
}
```

</details>

---

## Verify it works

```bash
# Server running?
systemctl --user status claude-state-server

# Inject a fake agent event and watch the dot appear:
curl -s -X POST http://127.0.0.1:7855/agent \
  -H 'Content-Type: application/json' \
  -d '{"pid":9999,"cwd":"/tmp","state":"working","hook_event":"PreToolUse",
       "tool_name":"Bash","session_id":"test1234","project_root":"/tmp","tty":""}'

# Dump live state:
curl -s http://127.0.0.1:7855/status | python3 -m json.tool
```

---

## How it works

```
state-report.py  →  HTTP :7855  →  /tmp/claude-agents.json  →  applet / extension
   (hook)            (server)          (state file)              (panel UI)
```

Every Claude hook event (tool call, stop, notification, …) fires `state-report.py` as a subprocess. It detects the project root, PTY, and IDE window, then POSTs to the local server. The server writes the state file atomically; the panel UI picks it up via inotify within ~30 ms.

---

## Development

### Component map

| Component | Source file | Deployed location | Restart to apply |
|-----------|-------------|-------------------|------------------|
| Hook | `~/.claude/hooks/state-report.py` | already final | none — runs fresh each event |
| Server | `server/claude_state_server.py` | run in-place | `systemctl --user restart claude-state-server` |
| Cinnamon applet | `applet/applet.js` | `~/.local/share/cinnamon/applets/claude-agent-state@tommasnik/` | `make applet` |
| GNOME extension | `gnome-extension/extension.js` | `~/.local/share/gnome-shell/extensions/claude-agent-state@tommasnik/` | `make gnome` |
| Service file | `server/claude-state-server.service.template` | `~/.config/systemd/user/claude-state-server.service` | `systemctl --user daemon-reload && restart` |

### State machine

```
SessionStart                                  → initialized  (grey)
UserPromptSubmit / PreToolUse / PostToolUse   → working      (yellow)
PreToolUse[AskUserQuestion]                   → asking_user  (blue)
Notification                                  → waiting_for_approval  (orange)
Stop / SubagentStop                           → done         (green)
```

`done` agents stay visible until the PID dies (checked every 5 s) or a new session starts on the same PTY (detected via `tty` field — handles `/clear`).

### HTTP API (server on :7855)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/agent` | Update agent state (called by hook) |
| `POST` | `/focus` | Focus IDE window for given PID (`wmctrl -i -a`) |
| `GET`  | `/status` | Dump full agents dict (debugging) |

`POST /agent` payload: `pid`, `cwd`, `state`, `hook_event`, `tool_name`, `session_id`, `project_root`, `tty`, `window_id`, `tab_name`, `subagent_count`.

### Common changes

- **New agent state/color** — add to `STATE_COLOR` + `STATE_LABEL` in `applet.js`, add mapping in `HOOK_STATE` in `state-report.py`.
- **Change grouping** — edit the `gkey` line in `_update()` in `applet.js` and `_projectName()` in the hook.
- **New server endpoint** — add `elif self.path == "/new-path":` in `Handler.do_POST` or `do_GET`.
- **Notification behavior** — edit `_sendNotification` calls in `_update()` in `applet.js`.

### Invariants — do not break

- The server writes the state file via `os.replace()` on a temp file. The applet watches for `IN_MOVED_TO` events. In-place writes will break the inotify trigger.
- `window_id` is set only at `SessionStart` / `UserPromptSubmit` and preserved across all other events. Sending it on every event causes unnecessary wmctrl calls.
- `started_at` is set once and must not be overwritten.

### Live logs

```bash
journalctl --user -u claude-state-server -f
```
