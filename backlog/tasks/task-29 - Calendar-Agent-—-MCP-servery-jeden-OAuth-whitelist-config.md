---
id: TASK-29
title: Calendar Agent — MCP servery + jeden OAuth + whitelist config
status: Done
assignee: []
created_date: '2026-06-03 08:42'
updated_date: '2026-06-03 12:23'
labels: []
dependencies:
  - TASK-28
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Zprovoznit a nakonfigurovat 3 MCP servery, které host připojuje, a whitelist vstupů.

## WhatsApp — lharries/whatsapp-mcp
- whatsmeow Go bridge + Python MCP server, lokální SQLite store
- QR auth, session ~20 dní → nutná periodická re-autentizace (zdokumentovat postup)
- Bridge musí běžet a být přihlášený PŘED startem agenta
- GOTCHA: neoficiální, porušuje WA ToS (riziko banu účtu)

## Gmail + Google Calendar
- Jeden Google Cloud OAuth projekt (scopes: gmail.readonly + calendar), hotové open-source MCP servery
- Refresh token uložený lokálně
- POZOR: OAuth scope NENÍ per-kalendář → agent má technicky write na všechny kalendáře. Hranice "read-only ostré / write jen AI kalendář" je jen v promptu (přijaté riziko, viz prompt task)

## Whitelist config
- Soubor s konfigurací: seznam WA skupin (jmenovitě), Gmail odesílatelé/labely
- Filtruje vstup DŘÍV než agent reasonuje (úspora tokenů, méně šumu)

## Mimo rozsah
- Vytvoření samotného AI kalendáře (jednorázový ruční setup)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 whatsapp-mcp bridge je přihlášený a MCP vrací zprávy z whitelistovaných skupin
- [x] #2 Gmail i Calendar MCP jsou autorizované jedním OAuth grantem a funkční
- [x] #3 Whitelist config soubor řídí které skupiny/odesílatele agent čte
- [x] #4 Zdokumentovaný postup re-autentizace WhatsApp (~20 dní)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**ZMĚNA návrhu (schváleno uživatelem):** Gmail + Calendar přepnuty z third-party
lokálních MCP serverů na **oficiální Google remote-hosted MCP servery**
(Developer Preview). WhatsApp zůstává lokální (oficiální MCP pro něj neexistuje).

**AC#1 a AC#2 ŽIVĚ OVĚŘENO (2026-06-03):** WhatsApp bridge přihlášený, MCP
vrací data z whitelistovaných skupin (ověřeno `list_chats`/`list_messages` na
„Rodiče 67S"). Oba oficiální Google MCP endpointy vrací HTTP 200 na MCP
`initialize` s bearer tokenem z našeho `GoogleTokenManager` (refresh→access
ověřeno přes náš TS kód), calendar nabízí `create_event`/`update_event` (write).
Reálný config: `~/.config/agent-manager/calendar-agent.json` (4 WA skupiny +
Gmail label „Škola Slunovrat"), creds: `~/.config/agent-manager/google-oauth.json`.
Refresh token získán loopback skriptem `calendar-agent/scripts/get-refresh-token.py`
(OAuth Playground dával `unauthorized_client` — refresh token svázán s cizím
clientem; loopback flow s vlastním clientem to řeší). GOTCHA: OAuth consent screen
v Testing mode → refresh token vyprší za 7 dní; pro trvalý běh publish app do
Production. Implementace (auth proběhla takto):

- MCP wiring: `calendar-agent.config.example.json` — Calendar + Gmail jako
  `type: "http"` na oficiální endpointy
  (`https://calendarmcp.googleapis.com/mcp/v1`,
  `https://gmailmcp.googleapis.com/mcp/v1`) s `google: true` + `scopes`;
  WhatsApp lokální stdio (reálné cesty: `/home/tom/.local/bin/uv`,
  `/home/tom/work/external/whatsapp-mcp/...`). Načítá se přes `config.ts`.
- Google OAuth token manager: `src/googleAuth.ts` — čte
  `~/.config/agent-manager/google-oauth.json`
  (`{client_id, client_secret, refresh_token}`, override `$GOOGLE_OAUTH_CREDENTIALS`),
  vyměňuje refresh_token → access_token přes `https://oauth2.googleapis.com/token`,
  cachuje s expirací (refresh 60 s před vypršením), injektovatelný transport pro
  testy. Host (`host.ts`) si token vyzvedne PŘED `query()` a vloží
  `Authorization: Bearer <token>` do hlaviček Google serverů
  (`injectGoogleBearer`), nastaví `allowedTools` wildcardy
  (`mcp__<server>__*`) a loguje MCP connection status z init zprávy.
  Limit: access token se získává jednou při startu (Google tokeny ~1 h); plný
  re-inject za běhu MCP spojení je mimo MVP (zdokumentováno v SETUP.md).
- Návod krok-za-krokem: `calendar-agent/docs/SETUP.md` (sekce „→ RETURN THIS TO ME“
  označují, co přesně uživatel musí vrátit pro dokončení AC#1/#2). Příklad
  Google creds: `calendar-agent/google-oauth.example.json`.
- Re-auth WhatsApp (AC#4): `calendar-agent/docs/WHATSAPP-REAUTH.md`.
- Whitelist filtr (AC#3): `calendar-agent/src/whitelist.ts` + integrace v
  `config.ts`/`host.ts`, testy v `src/__tests__/whitelist.test.ts`.

Po dodání auth hodnot ze SETUP.md se AC#1/#2 uzavřou bez další implementace.

Oficiální endpointy: Calendar = `https://calendarmcp.googleapis.com/mcp/v1`,
Gmail = `https://gmailmcp.googleapis.com/mcp/v1`. WhatsApp = lharries/whatsapp-mcp
(lokální). Third-party `@gongrzhe/server-gmail-autoauth-mcp` a
`@cocal/google-calendar-mcp` byly odstraněny.

---

**ZMĚNA #2 (schváleno uživatelem, 2026-06-03) — odchod od oficiálních Google
remote MCP serverů k vlastním in-process SDK tools nad Google REST API:**

ŽIVĚ OVĚŘENO, že oficiální Google remote MCP servery (`calendarmcp` /
`gmailmcp.googleapis.com`) jsou pod **Google Workspace Developer Preview
Programem**, který **vyžaduje Workspace účet — osobní @gmail.com je nezpůsobilý**.
MCP `initialize` projde, ale každé reálné volání nástroje vrací „The caller does
not have permission". Naproti tomu **raw Google REST API** (calendar/v3, gmail/v1)
s naším OAuth tokenem fungují perfektně (HTTP 200 ověřeno).

Řešení: Calendar + Gmail nově jako **vlastní in-process SDK MCP tools** (`tool()`
+ `createSdkMcpServer()` z Agent SDK) nad raw Google REST API — `src/googleTools.ts`.
Žádné remote MCP. Token se bere z `GoogleTokenManager` (beze změny), a to
**per-call uvnitř každého handleru** (cache + auto-refresh) → řeší i token expiry
v dlouhoběžící session, žádný startup-only bearer ani restart po ~1 h.

- `src/googleTools.ts`: `buildGoogleMcpServers()` staví dva servery `calendar`
  (list_calendars/list_events/get_event + create/update/delete_event) a `gmail`
  (list_messages/get_message/list_labels, read-only). Read tools mají
  `readOnlyHint:true`. Write tools vyžadují explicitní `calendarId` (agent ho
  zjistí z list_calendars; hranice „jen AI kalendář" je v promptu — TASK-30,
  nehardcoduje se). Handlery NIKDY nethrowují — chyba se vrací jako
  `{content, isError:true}`. fetch + tokenManager injektovatelné pro testy.
- `host.ts`: `resolveMcpServers()` slučuje native in-process Google servery se
  stdio servery z configu (`{calendar, gmail, whatsapp}`). `allowedTools()` +
  `configuredMcpServers()` pokrývají i native Google servery, i když už nejsou
  v config JSON. Odstraněna mrtvá remote-google logika (`injectGoogleBearer`,
  `googleServerNames`, `isGoogleHttpServer`, `GOOGLE_*_MCP_URL`, marker pole
  `google`/`scopes`) z `config.ts`. `GoogleTokenManager` zachován.
- Config: z `calendar-agent.config.example.json` i z reálného
  `~/.config/agent-manager/calendar-agent.json` odebrány http calendar/gmail
  entries (zůstal whatsapp stdio + whitelist beze změny). Calendar+Gmail
  potřebují už jen `~/.config/agent-manager/google-oauth.json`.
- `docs/SETUP.md` (Part 2) přepsán: žádný Developer Preview / MCP API / Workspace.
  Stačí zapnout Google Calendar API + Gmail API, OAuth client, refresh_token →
  funguje s osobním @gmail. Přidán krok: ručně vytvořit vyhrazený „AI" kalendář
  (scope calendar.events neumí vytvořit kalendář), agent ho najde přes
  list_calendars dle jména.
- `scripts/dry-run.mjs` přestaven na in-process tools (read-only allowlist:
  calendar list/get + gmail list/get + whatsapp list/get).
- Testy: nový `src/__tests__/googleTools.test.ts` (mock fetch + tokenManager,
  ověřuje URL/metodu/body/Authorization každého toolu, isError na non-2xx bez
  throwu, readOnlyHint). Upraveny `host.test.ts` + `config.test.ts`. `npm run
  build` + `npm test` zelené (66 testů). Přidána dependency `zod`.
<!-- SECTION:NOTES:END -->
