# calendar-agent-cli

Alternativní implementace **Calendar Agenta** postavená nad nakonfigurovaným
Claude Code CLI (sourozenec `calendar-agent/`, referenčního řešení na Agent SDK,
které zůstává nedotčené).

Srovnání obou řešení (architektura, enforcement, eskalace, spouštění,
trade-offy) najdeš v [`docs/COMPARISON.md`](docs/COMPARISON.md).

## Co to je a jak to funguje

Agent na každém běhu projde předfiltrované příchozí zprávy (whitelistované
WhatsApp skupiny + Gmail), rozhodne, zda některá popisuje reálný kalendářní
závazek, a buď ho zapíše do vyhrazeného **AI kalendáře**, nebo ho eskaluje do
fronty ke schválení. **Nikdy nevolá Google / WhatsApp API přímo** — řídí CLI
`cal-agent` přes Bash.

Tři kusy do sebe zapadají takto:

```
nakonfigurovaný Claude   →   cal-agent CLI   →   Google REST / bridge SQLite / approvals API
(CLAUDE.md + skill              (node dist/cli.js)
 /sync-calendar
 + .claude/settings.json)
```

- **Nakonfigurovaný Claude** — `CLAUDE.md` (kontext a hranice), skill
  `.claude/skills/sync-calendar/SKILL.md` (rozhodovací logika + konkrétní kroky)
  a `.claude/settings.json` (whitelist Bash příkazů, které smí agent volat).
- **`cal-agent` CLI** — deterministické rozhraní k okolnímu světu: Google
  Calendar (čtení + zápis **jen** do AI kalendáře, vynuceno), Gmail (read-only),
  WhatsApp (read-only, jen whitelistované skupiny), approvals fronta (eskalace).
- **Spouštění** — `claude -p "/sync-calendar"` ve složce balíčku (ručně nebo
  přes applet scheduler jako agent typu „Calendar Agent CLI").

Běh je **one-shot**: žádná dlouhoběžící session, žádné blokující čekání na
člověka. Nejistota odtéká ven přes `approvals add`, rozhodnutí se vracejí zpět
na *příštím* běhu přes `approvals answered`.

## Předpoklady / setup

1. **Go WhatsApp bridge běží** (systemd user service, viz sekce
   [Bridge jako systemd user service](#bridge-jako-systemd-user-service)):

   ```bash
   systemctl --user enable --now whatsapp-bridge
   ```

   Bridge zapisuje příchozí WhatsApp zprávy do SQLite v reálném čase; `cal-agent
   wa` z ní čte přímo (read-only) a před každým čtením ověřuje, že bridge žije
   (liveness guard).

2. **Sdílená konfigurace** v `~/.config/agent-manager/` — **stejné soubory jako
   referenční řešení** `calendar-agent/`, takže přepnutí mezi oběma řešeními
   nevyžaduje žádnou rekonfiguraci (viz [Sdílení konfigurace](#sdílení-konfigurace)):

   - `calendar-agent.json` — `aiCalendarId` (ID AI kalendáře) + `whitelist`
     (WhatsApp `groups`, Gmail `senders` / `labels`). Cestu lze přepsat přes
     `$CALENDAR_AGENT_CONFIG`. CLI čte z tohoto souboru jen `aiCalendarId` a
     `whitelist`; ostatní klíče (`model`, `mcpServers`, …), které používá jen
     SDK řešení, ignoruje.
   - `google-oauth.json` — `client_id`, `client_secret`, `refresh_token` pro
     Google REST API. Cestu lze přepsat přes `$GOOGLE_OAUTH_CREDENTIALS`.
     `GoogleTokenManager` z nich za běhu vyměňuje krátkodobé access tokeny
     (per-call). Soubor drž privátní (`chmod 600`).

3. **AI kalendář v Google Calendar** — vytvoř vyhrazený kalendář a jeho ID zapiš
   do `calendar-agent.json` jako `aiCalendarId` (Settings → vybraný kalendář →
   Integrate calendar → Calendar ID, končí na `@group.calendar.google.com`).
   **Jediný kalendář, do kterého agent smí zapisovat** — vynuceno CLI. Pokud
   `aiCalendarId` chybí (`null`), CLI **odmítne všechny zápisy** a agent jen čte
   a eskaluje.

4. **Refresh token** — pokud ho ještě nemáš, získej ho sdíleným helperem z
   referenčního balíčku:

   ```bash
   python3 ../calendar-agent/scripts/get-refresh-token.py
   ```

   Zapíše `client_id` + `client_secret` + `refresh_token` do
   `~/.config/agent-manager/google-oauth.json` (ten samý soubor, který čte CLI).
   **Pozn.:** je-li OAuth client v Google Cloud Console v režimu **Testing**,
   refresh token expiruje po **7 dnech** — po expiraci helper spusť znovu.

5. **Applet server běží** (kvůli approvals frontě) — `cal-agent approvals`
   míří na `http://127.0.0.1:7855` (přepiš `$AGENT_MANAGER_URL`):

   ```bash
   systemctl --user status claude-state-server
   ```

## Build

```bash
npm install
npm run build      # tsc → dist/
npm test           # jest
node dist/cli.js --help
```

## Ruční použití CLI

Binárka se jmenuje `cal-agent`, ale nemusí být na `PATH` — funkční forma je vždy
`node dist/cli.js …` (z kořene balíčku). Každý příkaz tiskne JSON na stdout;
chyby (včetně non-2xx HTTP) jdou na stderr s nenulovým exit kódem, takže
plánovaný běh selže nahlas, místo aby tiše pokračoval.

```bash
node dist/cli.js --help                 # přehled všech příkazů
node dist/cli.js config                 # vypíše resolved aiCalendarId + whitelist
```

### `calendar` — Google Calendar (čtení + zápis jen do AI kalendáře)

```bash
# seznam kalendářů (read-only kontext, detekce konfliktů)
node dist/cli.js calendar list-calendars

# události v okně (default kalendář = primary; pro AI kalendář předej --calendar-id)
node dist/cli.js calendar list-events \
  --calendar-id <aiCalendarId> --from 2026-05-20T00:00:00Z --to 2026-06-03T00:00:00Z

# detail události
node dist/cli.js calendar get-event --calendar-id <aiCalendarId> --event-id <id>

# vytvoření události — --calendar-id nech default, zápis dopadne do AI kalendáře
node dist/cli.js calendar create-event \
  --summary "Školní výlet" \
  --start 2026-06-14T07:30:00+02:00 --end 2026-06-14T16:00:00+02:00 \
  --description "Zdroj: WA skupina Třída 3.B, zpráva z 1.6. …"

# all-day událost: holé datum YYYY-MM-DD se uloží jako celodenní
node dist/cli.js calendar create-event \
  --summary "Odevzdat omluvenku" --start 2026-05-05 --end 2026-05-06

# update existující události (dedup → zpřesnění + doplnění zdrojů)
node dist/cli.js calendar update-event \
  --event-id <id> --start 2026-06-14T07:30:00+02:00 --end 2026-06-14T16:00:00+02:00 \
  --description "<naakumulované zdroje + poznámka>"
```

Enforcement: `create-event` / `update-event` přijmou zápis **jen** do
nakonfigurovaného `aiCalendarId`. Předáš-li `--calendar-id` jiného kalendáře,
CLI zápis odmítne ještě před HTTP voláním. Když `aiCalendarId` není
nakonfigurováno, **odmítne všechny zápisy**.

### `gmail` — Gmail (read-only)

```bash
# vyhledání podle labelu / dotazu / relativního okna (Gmail tvar, např. 14d)
node dist/cli.js gmail search --label "Important" --newer-than 14d
node dist/cli.js gmail search --label "Meetings" --query "schůzka" --newer-than 7d

# plný obsah zprávy
node dist/cli.js gmail get --id <messageId>
```

`search` vyžaduje aspoň jedno z `--label` / `--query` / `--newer-than`. Gmail je
striktně read-only — žádné odesílání ani úpravy.

### `wa` — WhatsApp (read-only, jen whitelistované skupiny)

```bash
# vrátí JEN whitelistované skupiny
node dist/cli.js wa list-chats

# zprávy z whitelistované skupiny (jméno přesně z list-chats)
node dist/cli.js wa messages "Třída 3.B" --since 2026-05-20T00:00:00Z --limit 100

# přepis cesty k bridge DB a prahu zastaralosti
node dist/cli.js wa messages "Třída 3.B" --db /cesta/messages.db --max-age-hours 12
```

Default cesta k bridge DB:
`~/work/external/whatsapp-mcp/whatsapp-bridge/store/messages.db` (přepiš
`--db` nebo `$WHATSAPP_BRIDGE_DB`). `messages` pro skupinu **mimo** whitelist
selže (nenulový exit, žádná data).

#### Liveness guard

Před každým čtením `cal-agent wa` ověří, že Go bridge **naslouchá na TCP
:8080** (bridge zapisuje příchozí zprávy do DB v reálném čase → živý port ==
živá data). Pokud bridge neběží → tvrdá chyba + nenulový exit, takže plánovaný
běh nikdy tiše neservíruje stará data. Je-li nejnovější uložená zpráva starší
než `--max-age-hours` (default 24h), vypíše se nefatální `WARNING` na stderr.

### `approvals` — fronta eskalací (one-shot model)

```bash
# registrace nejisté položky (z volných polí) — vypíše id
node dist/cli.js approvals add \
  --summary "Možná schůzka tým X příští týden" \
  --reason "Datum je vágní ('někdy příští týden'), nelze určit den" \
  --source "WA Tým X 1.6." --source "Email od šéfa, subj. Sync"

# nebo hotový payload jako JSON
node dist/cli.js approvals add --payload '{"summary":"...","reason":"...","sources":["..."]}'

# korelace s během / session
node dist/cli.js approvals add --summary "…" --run-id 42 --session-id abc123

# čekající položky
node dist/cli.js approvals list

# zodpovězené položky (aplikuj na začátku příštího běhu)
node dist/cli.js approvals answered

# jiný server
node dist/cli.js approvals list --base-url http://127.0.0.1:7855
```

`add` bere buď hotový `--payload <json>`, nebo si payload poskládá z `--summary`
(povinné) + volitelného `--reason` a opakovatelného `--source`. Cílí na approvals
API applet serveru (`POST /api/approvals`, `GET /api/approvals?status=…`) —
stejnou frontu, jakou používá SDK řešení.

## Spuštění agenta

### Ručně přes `claude -p`

Ve složce balíčku:

```bash
npm run build               # jednou, nebo po změně src/
claude -p "/sync-calendar"  # headless one-shot běh
```

Skill `/sync-calendar` (`.claude/skills/sync-calendar/SKILL.md`) řídí jeden běh,
v tomto pořadí:

0. `config` — zjistí `aiCalendarId` + whitelist (nikdy nehádá kalendář podle jména).
1. `approvals answered` — aplikuje rozhodnutí člověka z předchozích běhů.
2. `calendar list-events` na AI kalendáři — podklad pro sémantický dedup.
3. `wa list-chats` + `wa messages` — whitelistované WhatsApp skupiny.
4. `gmail search` + `gmail get` — whitelistovaný Gmail.
5. Pro jasné závazky: sémantický dedup → `create-event` / `update-event` (do AI
   kalendáře, se zdroji v `--description`).
6. Pro cokoli nejistého: `approvals add` — eskaluj, **nezapisuj**.
7. Shrnutí: created / updated / escalated (prázdná dávka je validní výsledek).

### Přes applet

V applet scheduleru jde agenta založit jako typ **„Calendar Agent CLI"** (interně
`calendar_agent_cli`). Run Now / naplánovaný běh spustí runner
`claude -p "/sync-calendar"` s `cwd` nastaveným do složky balíčku, kde
`.claude/settings.json` whitelistuje potřebné Bash příkazy. Běh se sleduje jako
„running", dokud `claude` proces neskončí; během eskalací se v appletu objeví
stav `waiting_for_approval`.

## Hranice / bezpečnost

- **Zápis jen do AI kalendáře** — vynuceno CLI (`enforceAiCalendar`): jakýkoli
  jiný `calendarId` je odmítnut před HTTP voláním; bez `aiCalendarId` jsou
  odmítnuty všechny zápisy.
- **Čtení jen whitelistovaných WhatsApp skupin** — vynuceno CLI: `wa` vrací jen
  skupiny z `whitelist.whatsapp.groups`; ostatní selžou.
- **Gmail read-only** — jen `search` / `get`.
- **Liveness guard u WhatsApp** — bridge musí naslouchat na :8080, jinak tvrdá
  chyba (žádná stará data).
- **Konzervativismus** — když si agent není jistý, eskaluje a nezapisuje. Chybná
  / duplicitní událost je horší než zmeškaná.

## Konfigurace — co se kde mění

| Co | Kde |
|----|-----|
| Whitelist (WA skupiny, Gmail senders/labels) | `~/.config/agent-manager/calendar-agent.json` → `whitelist` |
| ID AI kalendáře | tamtéž → `aiCalendarId` |
| Rozhodovací logika (co je „jasný závazek", jak dedup, kdy eskalovat) | skill `.claude/skills/sync-calendar/SKILL.md` |
| Časové okno (default 14 dní) | tamtéž (sekce „Time window") |
| Cesta k bridge DB | `--db` / `$WHATSAPP_BRIDGE_DB` (default `~/work/external/whatsapp-mcp/whatsapp-bridge/store/messages.db`) |
| Applet server pro approvals | `--base-url` / `$AGENT_MANAGER_URL` (default `http://127.0.0.1:7855`) |
| Povolené Bash příkazy pro agenta | `.claude/settings.json` |

## Sdílení konfigurace

Obě řešení — `calendar-agent/` (SDK) i `calendar-agent-cli/` (CLI) — čtou
**stejné soubory** v `~/.config/agent-manager/`:

- `calendar-agent.json` — CLI z něj bere `aiCalendarId` + `whitelist`; SDK navíc
  `model` a `mcpServers`. Klíče, které CLI nepoužívá, prostě ignoruje.
- `google-oauth.json` — oba čtou stejné OAuth credentials a oba mají vlastní
  (per-call) `GoogleTokenManager`.

Důsledek: **přepínání mezi oběma řešeními nevyžaduje rekonfiguraci** — refresh
token, AI kalendář i whitelist jsou sdílené. (CLI má vlastní, nezávislou
reimplementaci config loaderu — nesdílí kód s SDK balíčkem — ale čte tytéž
soubory.)

## Approvals & one-shot model eskalace

Běh je **one-shot** (`claude -p`) — žádná dlouhoběžící session, žádné blokující
čekání na člověka. Eskalace funguje asynchronně přes approvals frontu applet
serveru (totéž API, jaké používá SDK řešení):

1. **Během běhu**, když si agent není jistý nějakou akcí (např. nejednoznačné
   přeplánování), **nejedná** a **nečeká**. Zaregistruje navrhovanou akci jako
   *pending* položku přes `approvals add` a běh normálně dokončí.
2. **Člověk položku zodpoví** později — v applet UI nebo přes serverový endpoint
   `POST /api/approvals/:id/answer`. Položka se stane *answered*.
3. **Příští běh začne** přečtením zodpovězených položek přes `approvals answered`
   a jejich aplikací, pak pokračuje normální prací.

Žádný běh nikdy neblokuje na člověku: nejistota odtéká ven přes `add`, rozhodnutí
se vracejí zpět na následujícím běhu přes `answered`.

Serverový `GET /api/approvals` defaultně vrací *pending* (zpětně kompatibilní) a
přijímá `?status=pending|answered|dismissed|all`; `answered` je to, co CLI čte na
začátku běhu.

## Bridge jako systemd user service

Data jsou živá jen dokud Go bridge běží, takže ho provozuj jako systemd
**user** službu s auto-restartem/reconnectem. Unit je v repu na
`systemd/whatsapp-bridge.service`.

```bash
# z kořene balíčku
mkdir -p ~/.config/systemd/user
cp systemd/whatsapp-bridge.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now whatsapp-bridge

# ověření
systemctl --user status whatsapp-bridge
node dist/cli.js wa list-chats
```

Unit pouští `go run main.go` v
`~/work/external/whatsapp-mcp/whatsapp-bridge` s `Restart=always`. Máš-li
zkompilovanou binárku, nasměruj `ExecStart` na ni (viz komentář v unit souboru).
První přihlášení může vyžadovat naskenování WhatsApp QR kódu — bridge spusť
jednou v terminálu, než zapneš službu.
