# Calendar Agent — Setup Guide (TASK-29)

This guide is **for you, the user.** The agent has implemented everything that
can be automated (whitelist filtering, MCP wiring, config schema, the example
config). What remains needs **live, interactive authentication** that only you
can do with your phone and browser:

- **WhatsApp:** scan a QR code with your real phone.
- **Google:** create a Google Cloud project + OAuth consent in your browser.

Throughout, watch for the marker:

> **→ RETURN THIS TO ME:** `<value or path>`

Those are the exact values/paths the agent needs back from you to finish wiring
the config and close AC#1 and AC#2.

The final config lives at `~/.config/agent-manager/calendar-agent.json`. Start
from `calendar-agent/calendar-agent.config.example.json` and fill in every
`<PLACEHOLDER>`.

---

## Prerequisites

```bash
# Go (for the WhatsApp bridge)
go version          # need a recent Go toolchain

# uv (Python package manager, runs the WhatsApp MCP server)
which uv             # if missing: curl -LsSf https://astral.sh/uv/install.sh | sh

# Node.js LTS (for the Gmail + Calendar MCP servers via npx)
node --version
```

---

## Part 1 — WhatsApp (lharries/whatsapp-mcp)  → closes AC#1

> ⚠️ **GOTCHA:** whatsapp-mcp is **unofficial** and using it **violates
> WhatsApp's Terms of Service** — there is a real risk of the account being
> banned. Use a number you are willing to risk. This is an accepted risk
> recorded in TASK-29.

The setup has two parts that run as **separate processes**:

1. the **Go bridge** (`whatsapp-bridge`) — talks to WhatsApp via whatsmeow,
   holds the QR-authenticated session in a local SQLite store, **must be
   running and logged in before the agent starts**;
2. the **Python MCP server** (`whatsapp-mcp-server`) — what the agent connects
   to; it reads from the bridge's SQLite store. This one is launched by the
   agent via the config (you do not run it by hand).

### 1.1 Clone

```bash
git clone https://github.com/lharries/whatsapp-mcp.git
cd whatsapp-mcp
```

> **→ RETURN THIS TO ME:** the absolute path where you cloned it (e.g.
> `/home/tom/code/whatsapp-mcp`). This becomes `<PATH_TO_REPO>` in the config.

### 1.2 Run the bridge and authenticate (QR)

```bash
cd whatsapp-bridge
go run main.go
```

On first run it prints a **QR code in the terminal**. On your phone:
**WhatsApp → Settings → Linked Devices → Link a Device → scan the QR.**

After scanning, the bridge stays running and stores the session in:

```
whatsapp-bridge/store/    # SQLite: messages.db + whatsmeow.db
```

Keep this process running (or run it under a service/`tmux`/`systemd`). **If the
bridge is not running and logged in, the MCP server returns nothing.**

> Session lifetime is **~20 days**, after which you must re-scan the QR. See
> `WHATSAPP-REAUTH.md`.

### 1.3 Confirm the MCP server launch command

The agent will launch the Python server itself using:

```bash
<PATH_TO_UV> --directory <PATH_TO_REPO>/whatsapp-mcp/whatsapp-mcp-server run main.py
```

You do **not** need to run this by hand — just give the agent the paths.

> **→ RETURN THIS TO ME:**
> - `<PATH_TO_UV>` = output of `which uv`
> - `<PATH_TO_REPO>` = the clone path from step 1.1
> - confirmation that the **bridge is running and shows your chats** (`go run
>   main.go` is up and you successfully scanned)

### 1.4 Which WhatsApp groups should the agent read?

The agent only reads groups you list **by name** in the whitelist. Open
WhatsApp and note the **exact group names**.

> **→ RETURN THIS TO ME:** the exact names of the WhatsApp groups the agent may
> read (e.g. `"Family"`, `"Team Standup"`). These go into
> `whitelist.whatsapp.groups`.

---

## Part 2 — Gmail + Google Calendar (one Google Cloud OAuth project)  → closes AC#2

Both servers authorize against **one** Google Cloud project and **one** OAuth
client (one `gcp-oauth.keys.json`). Each server still stores its own refresh
token and must be auth'd once.

> ⚠️ **GOTCHA:** the Calendar OAuth scope is **not per-calendar** — granting
> `calendar` gives technical write access to *all* your calendars. The "read
> everything / write only the AI calendar" boundary is enforced only by the
> agent's prompt (accepted risk, see TASK-30). Gmail is requested as
> **read-only** (`gmail.readonly`).

### 2.1 Create the Google Cloud project + enable APIs

1. Go to <https://console.cloud.google.com/> → create a new project (e.g.
   `calendar-agent`).
2. **APIs & Services → Library**, enable both:
   - **Gmail API**
   - **Google Calendar API**

### 2.2 Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen.**
2. User type **External** (unless you have a Workspace org → Internal is fine).
3. Fill app name + your email.
4. **Scopes:** add exactly these two:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/calendar`
5. **Test users:** add your own Google account (the one whose mail/calendar the
   agent reads), otherwise consent will fail while the app is unverified.

### 2.3 Create the OAuth client (Desktop)

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID.**
2. Application type: **Desktop app.**
3. Create, then **Download JSON**. This is your `gcp-oauth.keys.json`.

Place **one copy** where both servers can reach it:

```bash
mkdir -p ~/.gmail-mcp ~/.config/agent-manager
# Gmail server expects it here:
cp ~/Downloads/client_secret_*.json ~/.gmail-mcp/gcp-oauth.keys.json
# Calendar server reads it via the path you set in the config (env var):
cp ~/.gmail-mcp/gcp-oauth.keys.json ~/.config/agent-manager/gcp-oauth.keys.json
```

> **→ RETURN THIS TO ME:** confirmation that `~/.gmail-mcp/gcp-oauth.keys.json`
> and `~/.config/agent-manager/gcp-oauth.keys.json` exist (same file content).

### 2.4 Authorize the Gmail MCP server (GongRzhe/Gmail-MCP-Server)

```bash
npx @gongrzhe/server-gmail-autoauth-mcp auth
```

A browser window opens → sign in with your Google account → grant access.
On success the refresh token is written to:

```
~/.gmail-mcp/credentials.json
```

> **→ RETURN THIS TO ME:** confirmation that `~/.gmail-mcp/credentials.json`
> exists after the browser flow.

The config entry the agent uses (already in the example):

```json
"gmail": {
  "command": "npx",
  "args": ["@gongrzhe/server-gmail-autoauth-mcp"],
  "env": {
    "GMAIL_OAUTH_PATH": "/home/<you>/.gmail-mcp/gcp-oauth.keys.json",
    "GMAIL_CREDENTIALS_PATH": "/home/<you>/.gmail-mcp/credentials.json"
  }
}
```

### 2.5 Authorize the Google Calendar MCP server (@cocal/google-calendar-mcp)

```bash
GOOGLE_OAUTH_CREDENTIALS="$HOME/.config/agent-manager/gcp-oauth.keys.json" \
  npx @cocal/google-calendar-mcp auth
```

A browser window opens → grant access. On success the token is written to:

```
~/.config/google-calendar-mcp/tokens.json
```

> **→ RETURN THIS TO ME:** confirmation that
> `~/.config/google-calendar-mcp/tokens.json` exists after the browser flow.

The config entry the agent uses (already in the example):

```json
"google-calendar": {
  "command": "npx",
  "args": ["@cocal/google-calendar-mcp"],
  "env": {
    "GOOGLE_OAUTH_CREDENTIALS": "/home/<you>/.config/agent-manager/gcp-oauth.keys.json"
  }
}
```

> **Note on "one OAuth grant":** both servers use the *same* Google Cloud
> project and OAuth client, so it is one OAuth identity. Technically you run the
> consent twice (once per server) because each server keeps its own token file;
> there is no shared-token server that covers both Gmail and Calendar. This is
> the closest available to the "one grant" requirement with off-the-shelf
> open-source servers.

### 2.6 Which Gmail senders / labels should the agent read?

> **→ RETURN THIS TO ME:** the Gmail senders (addresses or domains, e.g.
> `@yourcompany.com`) and/or labels the agent may read. These go into
> `whitelist.gmail.senders` and `whitelist.gmail.labels`.

---

## Part 3 — Assemble the config

1. Copy the example:

   ```bash
   mkdir -p ~/.config/agent-manager
   cp calendar-agent/calendar-agent.config.example.json \
      ~/.config/agent-manager/calendar-agent.json
   ```

2. Replace every `<PLACEHOLDER>` with the values you returned above and remove
   the `_comment*` keys if you like (they are ignored either way).

3. Sanity-check it loads (no MCP servers contacted yet, just parsing):

   ```bash
   cd calendar-agent && npm run build && node -e "console.log(require('./dist/config').loadConfig())"
   ```

You should see your `mcpServers` and `whitelist` printed back.

---

## What the agent still needs from you — checklist

- [ ] `<PATH_TO_UV>` (from `which uv`)
- [ ] `<PATH_TO_REPO>` (whatsapp-mcp clone path) + bridge running & QR-scanned
- [ ] WhatsApp group names to whitelist
- [ ] `~/.gmail-mcp/gcp-oauth.keys.json` + `~/.config/agent-manager/gcp-oauth.keys.json` exist
- [ ] `~/.gmail-mcp/credentials.json` exists (Gmail auth done)
- [ ] `~/.config/google-calendar-mcp/tokens.json` exists (Calendar auth done)
- [ ] Gmail senders/labels to whitelist

Once these are in place and `~/.config/agent-manager/calendar-agent.json` is
filled in, AC#1 and AC#2 are satisfied and the host (TASK-28) will connect all
three MCP servers on start.

---

## References (verified)

- WhatsApp MCP: <https://github.com/lharries/whatsapp-mcp>
- Gmail MCP: <https://github.com/GongRzhe/Gmail-MCP-Server>
  (`npm: @gongrzhe/server-gmail-autoauth-mcp`)
- Google Calendar MCP: <https://github.com/nspady/google-calendar-mcp>
  (`npm: @cocal/google-calendar-mcp`)
