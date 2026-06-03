---
id: TASK-32
title: Calendar Agent — streaming input bridge (server → živá SDK session)
status: Done
assignee: []
created_date: '2026-06-03 08:43'
updated_date: '2026-06-03 10:29'
labels: []
dependencies:
  - TASK-28
  - TASK-31
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Novel infra: kanál, kterým se uživatelova odpověď z approval queue dostane jako pokračovací prompt do BĚŽÍCÍ Agent SDK session. Stávající headless runner (TASK-8) je fire-and-forget `claude --print` bez injekce vstupu — tohle je nová schopnost.

## Princip
- Agent SDK host běží se streamovaným vstupem (async generator / vstupní fronta)
- Když agent eskaluje, zaregistruje approval (TASK-31) a BLOKUJE na vstup pro dané approval id
- POST /api/approvals/:id/answer → server doručí text do vstupního streamu té session
- Session pokračuje: zpracuje odpověď jako pokračovací prompt → zapíše/upraví event

## Mechanika doručení
- Server↔agent kanál: HTTP long-poll / WebSocket / lokální IPC (rozhodnout v implementaci; preferovat WS, který už server má)
- Korelace přes approval id ↔ session

## Edge cases
- Restart serveru/stroje během čekání → jak se session zotaví nebo zruší (zdokumentovat, MVP může jen zalogovat ztrátu)
- Timeout čekání
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Agent SDK session blokuje na vstup po eskalaci místo ukončení
- [x] #2 POST .../answer doručí text do správné běžící session a ta pokračuje
- [x] #3 Session po doručení odpovědi zapíše/upraví event v AI kalendáři
  > Ověřeno na úrovni mechaniky (mock SDK/MCP): po doručení odpovědi host přejde zpět do `running`, vloží odpověď jako pokračovací prompt do MessageQueue a reasoning smyčka vydá tool_use volání pro zápis do kalendáře (`mcp__google-calendar__create_event`). End-to-end zápis do reálného Google kalendáře čeká na živý OAuth (TASK-29) — v testech se reálné API NEVOLÁ.
- [x] #4 Chování při ztrátě session (restart/timeout) je definované a zalogované
<!-- AC:END -->



## Implementation notes (TASK-32)

Mechanika doručení (server → živá SDK session):
- **server** `POST /api/approvals/:id/answer` po uložení odpovědi pushne přes existující `broadcast()` WS event `{ event: "approval_answer", id, run_id, session_id, answer }` (korelace přes approval `id`).
- **calendar-agent** `src/bridge.ts` (`ApprovalBridge`) je WS klient: `registerAndWait()` zaregistruje approval (POST /api/approvals), zapamatuje si vrácené `id`, a blokuje dokud nepřijde `approval_answer` event s tímtéž `id`. Eventy pro cizí id filtruje.
- **host** `escalate()` → `markWaitingForApproval()` (session parkuje na MessageQueue, neukončí se) → po doručení odpovědi přejde do `running` a `submit()` vloží text jako pokračovací prompt.

Edge cases (AC#4):
- **Timeout**: každý approval má konfigurovatelný `answerTimeoutMs` (default 5 min). Po vypršení bridge odmítne čekatele `ApprovalTimeoutError`, zaloguje, host se odblokuje zpět do `running` (session zůstává živá, eskalace se zruší).
- **Ztráta WS spojení**: bridge loguje a zkouší bounded reconnect (`maxReconnects`, default 5). Po vyčerpání pokusů odmítne pending approvaly `BridgeConnectionLostError` a zaloguje ztrátu. Host se odblokuje do `running`.
- **Restart serveru/stroje**: MVP — ztráta čekajícího approvalu se zaloguje (přes WS close → reconnect/fail výše). Persistentní obnova čekající session není v MVP řešena.
