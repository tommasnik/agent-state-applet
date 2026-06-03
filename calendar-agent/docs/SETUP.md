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

## Part 2 — Gmail + Google Calendar (official Google remote MCP servers)  → closes AC#2

We use Google's **official, remote-hosted** MCP servers (Developer Preview), not
third-party local servers. There is nothing to install or run locally for
Gmail/Calendar — the agent connects over HTTPS to:

- Calendar: `https://calendarmcp.googleapis.com/mcp/v1`
- Gmail: `https://gmailmcp.googleapis.com/mcp/v1`

The Claude Agent SDK does **not** perform the OAuth flow for these. It only
forwards a `Authorization: Bearer <access_token>` header. So you create **one**
Google Cloud OAuth client, obtain a **refresh_token** once, and store
`{client_id, client_secret, refresh_token}` in
`~/.config/agent-manager/google-oauth.json`. The agent's token manager
(`src/googleAuth.ts`) exchanges the refresh_token for short-lived access tokens
at runtime and injects them into both Google MCP servers.

> ⚠️ **GOTCHA:** the Calendar OAuth scope is **not per-calendar** — granting
> `calendar.events` (write) gives technical write access to *all* your
> calendars. The "read everything / write only the AI calendar" boundary is
> enforced only by the agent's prompt (accepted risk, see TASK-30). Gmail is
> requested **read-only** (`gmail.readonly`).

> ⏱️ **GOTCHA (token lifetime):** Google access tokens live ~1 hour. The host
> fetches a token at **startup** and injects it once; the token manager caches +
> refreshes it for future (re)connections. The SDK exposes no hook to swap the
> header on an already-open MCP connection, so a session that has held a Google
> MCP connection open for >1h may need the host restarted. Mid-session header
> re-injection is out of MVP scope.

### 2.1 Enroll in the Google Workspace Developer Preview Program

The official MCP servers are in Developer Preview. Enroll your Google account /
Workspace here first, or the MCP APIs below won't be available:

- <https://developers.google.com/workspace/preview>

> **→ RETURN THIS TO ME:** confirmation that you're enrolled in the
> Google Workspace Developer Preview Program.

### 2.2 Create the Google Cloud project + enable APIs

1. Go to <https://console.cloud.google.com/> → create a new project (e.g.
   `calendar-agent`).
2. **APIs & Services → Library**, enable **all four**:
   - **Google Calendar API**
   - **Calendar MCP API**
   - **Gmail API**
   - **Gmail MCP API**

> **→ RETURN THIS TO ME:** confirmation that all four APIs are enabled.

### 2.3 Configure the OAuth consent screen + scopes

1. **APIs & Services → OAuth consent screen.**
2. User type **External** (unless you have a Workspace org → Internal is fine).
3. Fill app name + your email.
4. **Scopes:** add exactly these (Calendar write + reads, Gmail read-only):
   - `https://www.googleapis.com/auth/calendar.events` (write to AI calendar)
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/calendar.events.freebusy`
   - `https://www.googleapis.com/auth/calendar.events.readonly`
   - `https://www.googleapis.com/auth/gmail.readonly`
5. **Test users:** add your own Google account (the one whose mail/calendar the
   agent reads), otherwise consent fails while the app is unverified.

> **Note:** if the official Gmail MCP later rejects `gmail.readonly` at live
> connect, widen the Gmail scope accordingly and re-run the consent. This can
> only be confirmed against the live server.

### 2.4 Create the OAuth client (Web application)

For the **Claude** integration the OAuth client type is **Web application**
(Gemini CLI uses Desktop — we use the Web variant).

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID.**
2. Application type: **Web application.**
3. Add an **Authorized redirect URI**. The simplest one that works with the
   OAuth Playground (step 2.5) is:
   `https://developers.google.com/oauthplayground`
   (If you instead use your own one-shot script, use
   `http://localhost:<port>/` and match it there.)
4. Create. Copy the **Client ID** and **Client secret**.

> **→ RETURN THIS TO ME:** the **Client ID** and **Client secret**.

### 2.5 Obtain a refresh_token (one-time consent)

Easiest path for a Web application client — **Google OAuth 2.0 Playground**:

1. Open <https://developers.google.com/oauthplayground/>.
2. Top-right **gear ⚙ → "Use your own OAuth credentials"** → paste the Client ID
   + Client secret from 2.4. (Make sure the Playground redirect URI from 2.3 is
   authorized on the client.)
3. In the left **"Step 1 — Select & authorize APIs"** box, paste the scopes from
   2.3 (space-separated), then **Authorize APIs** → sign in → grant access.
4. **"Step 2 — Exchange authorization code for tokens"** → **Exchange**. Copy the
   **Refresh token**.

Alternatively run a tiny one-shot Node script with a `http://localhost:<port>/`
redirect that prints the refresh token — but the Playground needs no code.

> **→ RETURN THIS TO ME:** the **refresh_token** string.

### 2.6 Store the credentials

```bash
mkdir -p ~/.config/agent-manager
cp calendar-agent/google-oauth.example.json \
   ~/.config/agent-manager/google-oauth.json
chmod 600 ~/.config/agent-manager/google-oauth.json
# then edit it and fill in client_id / client_secret / refresh_token
```

Result — `~/.config/agent-manager/google-oauth.json`:

```json
{
  "client_id": "...apps.googleusercontent.com",
  "client_secret": "...",
  "refresh_token": "..."
}
```

(Override the path with `$GOOGLE_OAUTH_CREDENTIALS` if you keep it elsewhere.)

> **→ RETURN THIS TO ME:** confirmation that
> `~/.config/agent-manager/google-oauth.json` exists with all three fields set.

The Calendar + Gmail entries are already in the example config
(`calendar-agent.config.example.json`) as official remote servers — no
client_id/secret there, the host injects the bearer at startup:

```json
"calendar": {
  "type": "http",
  "url": "https://calendarmcp.googleapis.com/mcp/v1",
  "google": true,
  "scopes": ["...calendar.events", "...calendar.events.readonly", "..."]
},
"gmail": {
  "type": "http",
  "url": "https://gmailmcp.googleapis.com/mcp/v1",
  "google": true,
  "scopes": ["https://www.googleapis.com/auth/gmail.readonly"]
}
```

### 2.7 Which Gmail senders / labels should the agent read?

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
- [ ] Enrolled in Google Workspace Developer Preview Program
- [ ] Google Cloud APIs enabled: Calendar API + Calendar MCP API + Gmail API + Gmail MCP API
- [ ] OAuth client (type **Web application**) created → Client ID + Client secret
- [ ] `refresh_token` obtained (OAuth Playground or one-shot script)
- [ ] `~/.config/agent-manager/google-oauth.json` exists with `{client_id, client_secret, refresh_token}`
- [ ] Gmail senders/labels to whitelist

Once these are in place and `~/.config/agent-manager/calendar-agent.json` is
filled in, AC#1 and AC#2 are satisfied and the host (TASK-28) will connect all
three MCP servers on start (Calendar + Gmail via the injected Google bearer,
WhatsApp via the local stdio server).

---

## References (verified)

- WhatsApp MCP: <https://github.com/lharries/whatsapp-mcp>
- Google Workspace Developer Preview Program: <https://developers.google.com/workspace/preview>
- Official Google Calendar MCP: `https://calendarmcp.googleapis.com/mcp/v1`
- Official Gmail MCP: `https://gmailmcp.googleapis.com/mcp/v1`
- Claude Agent SDK — remote MCP auth: <https://code.claude.com/docs/en/agent-sdk/mcp>
- Google OAuth 2.0 Playground: <https://developers.google.com/oauthplayground/>
