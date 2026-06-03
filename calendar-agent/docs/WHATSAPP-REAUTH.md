# WhatsApp Re-Authentication (~ every 20 days) — TASK-29 AC#4

The whatsapp-mcp Go bridge holds a **whatsmeow** linked-device session in a
local SQLite store. That session expires after roughly **20 days**, after which
the bridge can no longer fetch messages and the agent silently stops receiving
WhatsApp input. This is expected and requires a quick manual re-scan.

## How to tell the session has expired

Any of these are symptoms:

- The bridge process (`go run main.go` in `whatsapp-bridge/`) **prints a new QR
  code** on (re)start instead of connecting silently.
- Bridge logs show **logged out / `401` / `stream:error` / "device removed"**
  type messages from whatsmeow.
- The agent reports **no new WhatsApp messages** from whitelisted groups even
  though there are new ones on your phone.
- On your phone, **WhatsApp → Settings → Linked Devices** no longer lists the
  bridge device (or shows it as expired).

## Re-authentication steps

1. Make sure the old bridge process is stopped.

2. Restart the bridge from the clone:

   ```bash
   cd <PATH_TO_REPO>/whatsapp-mcp/whatsapp-bridge
   go run main.go
   ```

3. It prints a **fresh QR code** in the terminal.

4. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device →
   scan the QR.**

5. The session is re-established and written back into
   `whatsapp-bridge/store/`. Leave the bridge running.

You do **not** need to touch the config, the Python MCP server, or re-run any
Google auth — only the WhatsApp QR scan is involved.

## Notes

- The existing SQLite store (`whatsapp-bridge/store/`) is reused; message
  history is **not** lost on re-auth. Only the device session is refreshed.
- If re-scanning fails repeatedly, delete the store and start clean (this loses
  cached history and forces a full re-link):

  ```bash
  rm -rf <PATH_TO_REPO>/whatsapp-mcp/whatsapp-bridge/store/
  go run main.go   # scan the QR again
  ```

- Consider running the bridge under `systemd --user` or `tmux` so a restart +
  re-scan is the only manual step, and so it survives reboots.

- ⚠️ Reminder: whatsapp-mcp is unofficial and violates WhatsApp ToS — frequent
  re-linking from the same number carries account-ban risk.
