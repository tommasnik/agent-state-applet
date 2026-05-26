---
id: TASK-12.1
title: 'TASK-12a: Fixture data — zachycení a schéma reálných scénářů'
status: Done
assignee: []
created_date: '2026-05-26 08:09'
updated_date: '2026-05-26 08:19'
labels:
  - testing
  - fixtures
dependencies: []
parent_task_id: TASK-12
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Základ celé testovací pyramidy. Ostatní subtasky závisí na těchto datech.

## Co vytvořit

Adresář `test-fixtures/scenarios/` s dvěma scénáři.

### Struktura každého scénáře

```
sc1-idea-same-name/
  README.md                        # popis scénáře, jak data vznikla
  hook-payloads/
    agent-a.json                   # SessionStart payload pro ~/work/proj1
    agent-b.json                   # SessionStart payload pro ~/work/subfolder/proj1
  server-state/
    after-both-registered.json     # expected AgentStore.snapshot() po obou upsert
  wmctrl-output.txt                # výstup `wmctrl -l` s oběma IDEA okny
  focus-calls/
    click-a.json                   # expected: { wmctrl_xid, idea_tab_name, idea_project }
    click-b.json
```

### Schéma hook-payload.json
```json
{
  "pid": 12345,
  "session_id": "abcdef1234567890",
  "state": "initialized",
  "hook_event": "SessionStart",
  "tool_name": "",
  "cwd": "/home/tom/work/proj1",
  "project_root": "/home/tom/work/proj1",
  "tty": "/dev/pts/3",
  "window_id": "0x1e00042",
  "tab_name": "cc-abcdef12",
  "terminal_type": "idea"
}
```

### Schéma focus-call.json
```json
{
  "wmctrl_xid": "0x1e00042",
  "idea_api_url_contains": "tabName=cc-abcdef12",
  "idea_api_url_contains_project": "proj1",
  "idea_api_called": true
}
```

## Jak data získat

Spustit oba scénáře reálně, zachytit:
1. Hook payload: přidat dočasný `logging` do `state-report.py`
2. wmctrl výstup: `wmctrl -l` v daný moment
3. Ověřit přes `/status` endpoint co server uložil

Data pak ručně anonymizovat (PID → fixní čísla, session_id → fixní UUID).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 test-fixtures/scenarios/sc1-idea-same-name/ existuje se všemi soubory
- [x] #2 test-fixtures/scenarios/sc2-idea-and-ghostty/ existuje se všemi soubory
- [x] #3 README.md v každém scénáři popisuje jak data vznikla
- [x] #4 JSON soubory jsou validní a splňují zdokumentované schéma
- [x] #5 wmctrl-output.txt obsahuje realistická data odpovídající scénáři
<!-- AC:END -->
