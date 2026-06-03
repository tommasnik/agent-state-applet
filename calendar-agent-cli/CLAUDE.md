# calendar-agent-cli — agent context

## What this is

A **Calendar Agent** built on a configured Claude Code CLI (sibling of
`calendar-agent/`, the reference Agent SDK solution — do not touch that one).

On each run the agent reviews pre-filtered incoming messages (whitelisted
WhatsApp groups + Gmail), decides whether any describe a real calendar
commitment, and either records it in a dedicated **AI calendar** or escalates it
to the approval queue. It never talks to Google / WhatsApp APIs directly — it
drives the `cal-agent` CLI via **Bash** (`node dist/cli.js <...>`).

## How to run

```bash
npm run build               # tsc → dist/ (once, or after changing src)
claude -p "/sync-calendar"  # headless run, cwd = this folder
```

The decision logic + concrete steps live in the **`/sync-calendar` skill**
(`.claude/skills/sync-calendar/SKILL.md`). When asked to sync the calendar /
process incoming messages, follow that skill.

## Boundaries (also enforced by `cal-agent`)

- **Write ONLY to the AI calendar.** All other calendars are read-only context.
  On `create-event` / `update-event`, leave `--calendar-id` at its default so
  writes land on the configured AI calendar. The CLI enforces this.
- **Read ONLY whitelisted WhatsApp groups.** `cal-agent wa` returns only
  whitelisted groups; others fail.
- **Gmail is read-only** — `search` / `get` only.
- **When uncertain, escalate — never write.** Conservatism: a wrong/duplicated
  event is far worse than a missed one.

## Config — do not hardcode

The AI calendar ID (`aiCalendarId`) and the input whitelist are **not** in this
file. They come from `cal-agent`, which reads
`~/.config/agent-manager/calendar-agent.json` (override via
`$CALENDAR_AGENT_CONFIG`). Discover them at runtime:

```bash
node dist/cli.js config    # prints resolved aiCalendarId + whitelist
```

Never guess the AI calendar by name. If `aiCalendarId` is `null`, do not write
any event — read for context and escalate.

## CLI reference

```bash
node dist/cli.js --help                 # all commands
node dist/cli.js calendar --help        # list/get/create/update events
node dist/cli.js gmail --help           # search / get (read-only)
node dist/cli.js wa --help              # list-chats / messages (whitelisted, read-only)
node dist/cli.js approvals --help       # add / list / answered (escalation queue)
```

See `README.md` for the one-shot escalation model and the WhatsApp bridge setup.
