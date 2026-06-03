---
id: TASK-29
title: Calendar Agent — MCP servery + jeden OAuth + whitelist config
status: In Progress
assignee: []
created_date: '2026-06-03 08:42'
updated_date: '2026-06-03 10:10'
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
- [ ] #1 whatsapp-mcp bridge je přihlášený a MCP vrací zprávy z whitelistovaných skupin
- [ ] #2 Gmail i Calendar MCP jsou autorizované jedním OAuth grantem a funkční
- [x] #3 Whitelist config soubor řídí které skupiny/odesílatele agent čte
- [x] #4 Zdokumentovaný postup re-autentizace WhatsApp (~20 dní)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**ZMĚNA návrhu (schváleno uživatelem):** Gmail + Calendar přepnuty z third-party
lokálních MCP serverů na **oficiální Google remote-hosted MCP servery**
(Developer Preview). WhatsApp zůstává lokální (oficiální MCP pro něj neexistuje).

AC#1 a AC#2 stále vyžadují **živou interaktivní autentizaci** (naskenování
WhatsApp QR telefonem; u Google: enrollment do Developer Preview, zapnutí API,
OAuth consent + získání refresh_tokenu v prohlížeči), kterou musí provést
uživatel. Implementace + MCP wiring + token manager + step-by-step návod jsou
hotové a čekají na tyto auth kroky:

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
<!-- SECTION:NOTES:END -->
