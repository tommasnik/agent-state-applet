# Calendar Agent: SDK řešení vs. CLI řešení

Dvě paralelní implementace téhož Calendar Agenta. Cíl je stejný: projít
předfiltrované příchozí zprávy (whitelistované WhatsApp skupiny + Gmail), poznat
reálné kalendářní závazky, zapsat je do vyhrazeného AI kalendáře, a cokoli
nejistého eskalovat člověku. Liší se **jak** to dělají.

- **`calendar-agent/`** — referenční řešení nad `@anthropic-ai/claude-agent-sdk`.
- **`calendar-agent-cli/`** — toto řešení, postavené nad nakonfigurovaným Claude
  Code CLI (`claude -p`) + samostatně spustitelným CLI `cal-agent`.

## Přehledová tabulka

| Aspekt | SDK (`calendar-agent/`) | CLI (`calendar-agent-cli/`) |
|--------|-------------------------|-----------------------------|
| **Jádro** | Vlastní host nad Agent SDK (`query()`) | Nakonfigurovaný Claude Code CLI (CLAUDE.md + skill + settings.json) |
| **Životnost** | Dlouhoběžící proces, perzistentní session | One-shot běh (`claude -p`), bez session |
| **Jak agent volá nástroje** | In-process SDK MCP tools (`calendar`, `gmail`) + stdio MCP (`whatsapp`) | `cal-agent` CLI přes Bash (`node dist/cli.js …`) |
| **Google Calendar / Gmail** | In-process MCP tools nad raw Google REST (calendar/v3, gmail/v1) | CLI příkazy nad raw Google REST (tytéž API) |
| **Enforcement AI kalendáře** | In-process write tool odmítne jiný `calendarId` | CLI (`enforceAiCalendar`) odmítne jiný `calendarId` před HTTP |
| **WhatsApp** | Python `whatsapp-mcp` server přes `uv` (stdio MCP) → bridge SQLite | `cal-agent wa` čte bridge SQLite přímo + systemd unit + liveness guard |
| **Eskalace** | Dlouhoběžící session + WS ApprovalBridge — **blokuje a čeká** na odpověď, pak resumuje | One-shot: `approvals add` a konec; odpověď se aplikuje **příští běh** přes `approvals answered` |
| **Vstup zpráv** | MessageQueue (streaming-input bridge do session) | Skill řídí pořadí CLI volání v jednom běhu |
| **Spouštění** | Driver `scripts/live-run.mjs` / `dry-run.mjs`, nebo `node dist/index.js` | `claude -p "/sync-calendar"`, nebo applet typ `calendar_agent_cli` |
| **Token handling** | `GoogleTokenManager`, access token per-call | `GoogleTokenManager`, access token per-call (nezávislá reimplementace) |
| **Konfigurace** | `~/.config/agent-manager/calendar-agent.json` + `google-oauth.json` | tytéž soubory (čte jen `aiCalendarId` + `whitelist`) |
| **Závislosti navíc** | Agent SDK, `ws`, `express`, Python whatsapp-mcp + `uv` | `better-sqlite3`; žádný Python, žádný SDK |

## Architektura

**SDK** staví vlastního *hosta* (`src/host.ts`) nad SDK funkci `query()`. Host
sestaví in-process MCP servery (Calendar + Gmail), připojí stdio MCP server pro
WhatsApp, načte system prompt (`prompt.md`) s napíchnutým ID AI kalendáře a
otevře **jednu dlouhoběžící session**. Zprávy do session tečou přes
`MessageQueue`; eskalace přes `ApprovalBridge` (WebSocket klient). Proces běží,
dokud nedostane SIGINT/SIGTERM (`src/index.ts` parkuje na nikdy neresolvující
promise).

**CLI** žádného vlastního hosta nemá. „Konfigurací" Claude Code je trojice
souborů ve složce balíčku: `CLAUDE.md` (kontext + hranice), skill
`.claude/skills/sync-calendar/SKILL.md` (rozhodovací logika a kroky) a
`.claude/settings.json` (allow-list Bash příkazů). Veškerý kontakt s okolím
obstarává deterministické CLI `cal-agent` (`src/cli.ts` → `calendar` / `gmail` /
`wa` / `approvals`). Běh je jeden průchod skillu.

## Jak agent volá nástroje

- **SDK:** model volá **MCP tooly** registrované v session (`calendar`, `gmail`,
  `whatsapp`). Strukturované, typované volání nástrojů uvnitř SDK runtime.
- **CLI:** model volá **`cal-agent` přes Bash** (`node dist/cli.js <…>`). Každý
  příkaz vrátí JSON na stdout, chyby na stderr s nenulovým exitem. Nástroj je
  samostatně spustitelný i mimo agenta (debugovatelný z ruky).

## Enforcement AI kalendáře

Obě řešení **tvrdě vynucují**, že zápis smí jít jen do nakonfigurovaného
`aiCalendarId`, a bez něj odmítnou všechny zápisy. Liší se vrstva:

- **SDK:** enforcement uvnitř in-process write toolu (`googleTools.ts`).
- **CLI:** enforcement v `GoogleClient.enforceAiCalendar` (`src/google.ts`),
  odmítnutí nastane ještě před HTTP voláním.

V obou případech to není věc promptu — i kdyby model chtěl psát jinam, vrstva
nástroje to odmítne.

## WhatsApp

- **SDK:** Python server `lharries/whatsapp-mcp` spouštěný přes `uv` jako stdio
  MCP server; ten čte bridge SQLite. Závisí na Pythonu + `uv` + konfiguraci
  `mcpServers` v `calendar-agent.json`.
- **CLI:** `cal-agent wa` čte **bridge SQLite přímo** (read-only, `better-sqlite3`),
  bez Pythonu a `uv`. Navíc:
  - **systemd user unit** (`whatsapp-bridge.service`) drží Go bridge naživu
    (`Restart=always`);
  - **liveness guard** — před každým čtením ověří TCP :8080; bridge down →
    tvrdá chyba, nikdy se neservírují stará data; zastaralá data (> max-age) →
    nefatální WARNING.

## Eskalace

Tady je největší koncepční rozdíl.

- **SDK — blokující, synchronní:** session jde do `waiting_for_approval`,
  zaregistruje approval přes `ApprovalBridge` (POST + WS), **zaparkuje na
  MessageQueue a čeká**. Když člověk odpoví (`POST /api/approvals/:id/answer`),
  server pošle WS event `approval_answer`, bridge ho podle `id` doručí zpět do
  session jako continuation prompt a session **pokračuje ve stejném běhu**.
- **CLI — neblokující, asynchronní (one-shot):** běh nejistou položku
  zaregistruje přes `approvals add` a **skončí**. Člověk ji zodpoví později.
  **Příští běh** ji přečte přes `approvals answered` a aplikuje. Žádné čekání
  uvnitř běhu.

Obě řešení míří na **stejnou approvals frontu** applet serveru (`POST
/api/approvals`, `GET /api/approvals?status=…`).

## Spouštění

- **SDK:** driver `scripts/live-run.mjs` (ostře) / `scripts/dry-run.mjs` (nasucho),
  nebo přímo `node dist/index.js`. Proces zůstává naživu kvůli dlouhoběžící
  session.
- **CLI:** `claude -p "/sync-calendar"` ve složce balíčku (ručně), nebo přes
  applet scheduler jako agent typu `calendar_agent_cli` (runner spustí tentýž
  `claude -p`). Po doběhnutí `claude` procesu je hotovo.

## Závislosti a token handling

- **SDK** táhne `@anthropic-ai/claude-agent-sdk`, `ws`, `express` a externí
  Python whatsapp-mcp + `uv`.
- **CLI** má jedinou runtime závislost `better-sqlite3` (čtení bridge DB); žádné
  Python ani SDK. K eskalaci a Google přístupu používá vestavěný `fetch`
  (Node 18+).
- **Token handling je v principu stejný:** oba mají `GoogleTokenManager`, který
  z `google-oauth.json` vyměňuje refresh token za krátkodobý access token
  **per-call** (cache + auto-refresh). CLI má vlastní nezávislou reimplementaci
  (nesdílí kód s SDK balíčkem).

## Sdílení konfigurace

Obě řešení čtou **stejné soubory** v `~/.config/agent-manager/`:

- `calendar-agent.json` — CLI bere `aiCalendarId` + `whitelist`; SDK navíc
  `model` a `mcpServers`. Klíče, které CLI nepoužívá, ignoruje.
- `google-oauth.json` — sdílené OAuth credentials (`client_id`, `client_secret`,
  `refresh_token`), získané sdíleným helperem
  `calendar-agent/scripts/get-refresh-token.py`.

Důsledek: **přepínání mezi řešeními nevyžaduje žádnou rekonfiguraci.** AI
kalendář, whitelist i refresh token jsou společné; měníš jen způsob spuštění.

## Kdy které — trade-offy

**Vyber SDK řešení, když:**

- chceš **strukturované, typované MCP tooly** a kontrolu nad session uvnitř
  jednoho hostitelského procesu;
- dává smysl **blokující eskalace** — běh počká na odpověď člověka a hned
  pokračuje ve stejné session (rychlejší smyčka pro interaktivní rozhodnutí);
- nevadí ti těžší stack (SDK, WS server, Python whatsapp-mcp + `uv`) a
  dlouhoběžící proces, který je třeba hlídat.

**Vyber CLI řešení, když:**

- chceš **jednoduchost a samostatně spustitelné CLI** — `cal-agent` lze pustit a
  debugovat z ruky bez běžícího agenta;
- vyhovuje ti **one-shot model** (cron/scheduler-friendly): každý běh je
  nezávislý, nic dlouhoběžícího se nehlídá, eskalace se vyřeší na příštím běhu;
- chceš **méně závislostí** (žádný Python/`uv`, žádný SDK) a přímé čtení bridge
  SQLite s liveness guardem;
- nevadí ti, že odpověď na eskalaci se projeví **až příští běh** (vyšší latence
  rozhodnutí výměnou za jednoduchost a robustnost).
