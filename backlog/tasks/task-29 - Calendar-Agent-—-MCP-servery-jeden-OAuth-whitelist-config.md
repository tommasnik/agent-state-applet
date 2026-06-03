---
id: TASK-29
title: Calendar Agent — MCP servery + jeden OAuth + whitelist config
status: To Do
assignee: []
created_date: '2026-06-03 08:42'
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

## Implementation notes

AC#1 a AC#2 vyžadují **živou interaktivní autentizaci** (naskenování WhatsApp QR
telefonem, vytvoření Google Cloud projektu + OAuth consent v prohlížeči), kterou
musí provést uživatel. Implementace + MCP wiring + přesný step-by-step návod jsou
hotové a čekají na tyto auth kroky:

- MCP wiring pro všechny 3 servery (whatsapp-mcp, Gmail, Google Calendar) je
  připraven v `calendar-agent/calendar-agent.config.example.json` a načítá se přes
  `config.ts` (`loadConfig`).
- Návod krok-za-krokem: `calendar-agent/docs/SETUP.md` (sekce „→ RETURN THIS TO ME“
  označují, co přesně uživatel musí vrátit pro dokončení AC#1/#2).
- Re-auth WhatsApp (AC#4): `calendar-agent/docs/WHATSAPP-REAUTH.md`.
- Whitelist filtr (AC#3): `calendar-agent/src/whitelist.ts` + integrace v
  `config.ts`/`host.ts`, testy v `src/__tests__/whitelist.test.ts`.

Po dodání auth hodnot ze SETUP.md se AC#1/#2 uzavřou bez další implementace.

Ověřené balíčky: Gmail = `@gongrzhe/server-gmail-autoauth-mcp`
(GongRzhe/Gmail-MCP-Server), Calendar = `@cocal/google-calendar-mcp`
(nspady/google-calendar-mcp), WhatsApp = lharries/whatsapp-mcp.
