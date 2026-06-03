# calendar-agent-cli

Alternative Calendar Agent implementation built on a configured Claude Code CLI
(sibling of `calendar-agent/`, the reference Agent SDK solution, left untouched).

## Build & test

```bash
npm install
npm run build      # tsc → dist/
npm test           # jest
node dist/cli.js --help
```

## Commands

```
cal-agent config                 Show the resolved shared config
cal-agent calendar <sub> ...     Google Calendar (read + AI-calendar-only writes)
cal-agent gmail <sub> ...        Gmail (read-only)
cal-agent wa <sub> ...           WhatsApp (read-only, whitelisted groups)
```

## WhatsApp (`cal-agent wa`)

Reads the Go bridge's SQLite store directly (read-only) — no python whatsapp-mcp
/ uv. Only WhatsApp **groups whose name is on the whitelist**
(`whitelist.whatsapp.groups` in the shared config, case-insensitive + trimmed)
are ever returned.

```
cal-agent wa list-chats                 List ONLY whitelisted groups
cal-agent wa messages "<group name>"    Messages from a whitelisted group
    [--since <iso>] [--limit <n>]
Global flags:
    [--db <path>]            Bridge SQLite path (default below, or $WHATSAPP_BRIDGE_DB)
    [--max-age-hours <n>]    Staleness threshold (default 24)
```

Default bridge DB: `~/work/external/whatsapp-mcp/whatsapp-bridge/store/messages.db`.

`messages` for a group **not** on the whitelist fails (non-zero exit, no data).
Output is JSON on stdout; errors go to stderr with a non-zero exit.

### Liveness guard

Before any read, `cal-agent wa` verifies the Go bridge is **listening on TCP
:8080** (the bridge writes incoming messages to the DB in real time, so a live
port == live data). If the bridge is down → hard error + non-zero exit, so a
scheduled run never silently serves stale data. If the newest stored message is
older than `--max-age-hours` (default 24h), a non-fatal `WARNING` is printed to
stderr.

## Bridge as a systemd user service

Data is only live while the Go bridge runs, so run it as a systemd **user**
service with auto-restart/reconnect. The unit lives in this repo at
`systemd/whatsapp-bridge.service`.

```bash
# from the repo root
mkdir -p ~/.config/systemd/user
cp systemd/whatsapp-bridge.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now whatsapp-bridge

# verify
systemctl --user status whatsapp-bridge
cal-agent wa list-chats
```

The unit runs `go run main.go` in
`~/work/external/whatsapp-mcp/whatsapp-bridge` with `Restart=always`. If you have
a compiled binary, point `ExecStart` at it instead (see the comment in the unit
file). First-time login may require scanning the WhatsApp QR code — run the
bridge in a terminal once before enabling the service.
