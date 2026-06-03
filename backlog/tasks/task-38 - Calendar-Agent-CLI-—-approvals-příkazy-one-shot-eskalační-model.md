---
id: TASK-38
title: Calendar Agent CLI — approvals příkazy + one-shot eskalační model
status: In Progress
assignee: []
created_date: '2026-06-03 16:30'
updated_date: '2026-06-03 16:50'
labels:
  - calendar-agent-cli
dependencies:
  - TASK-35
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Eskalace bez dlouhoběžící session: běh je one-shot (`claude -p`). Nejisté položky agent zapíše přes `cal-agent approvals add` do applet serveru (reuse approvals API z TASK-31). Na začátku příštího běhu přečte zodpovězené (`cal-agent approvals answered`) a aplikuje je.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 cal-agent approvals add --payload <json> zaregistruje pending položku na applet serveru (POST /api/approvals)
- [x] #2 cal-agent approvals list | answered vrací pending / zodpovězené approvals (GET /api/approvals + filtr)
- [x] #3 model zdokumentován: one-shot běh → nejisté do queue → příští běh aplikuje odpovědi (žádné blokující čekání)
- [x] #4 jest testy proti mock serveru; build + testy zelené
<!-- AC:END -->
