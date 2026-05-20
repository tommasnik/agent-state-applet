---
id: TASK-9
title: Schedules UI — správa plánovaných agentů
status: Done
assignee: []
created_date: '2026-05-20 05:23'
updated_date: '2026-05-20 06:00'
labels: []
milestone: 'M3: Scheduling'
dependencies:
  - TASK-8
  - TASK-4
references:
  - /home/tom/code/demo-pages/sites/agent-dashboard-demo/src/App.jsx
  - /home/tom/code/demo-pages/sites/agent-dashboard-demo/src/data.js
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implementovat SchedulesPage v React UI — vytváření, prohlížení a monitoring plánovaných agentů.

## Referenční prototyp

`/home/tom/code/demo-pages/sites/agent-dashboard-demo` — viz `src/App.jsx` funkce `ScheduledView`, `RunDetailModal`, `SchedulerModal` a data model v `src/data.js` (`initialScheduled`).

## ScheduledView — accordion list

Stránka má nadpis "Scheduled agents" + podtitulek + tlačítko "+ New schedule" (primary, vpravo).

Každý schedule = rozbalovací sekce (`<section>`):

**Card header** (klikatelný, toggle expand):
- Levý barevný proužek (barva projektu)
- Meta blok:
  - Řádek 1: název schedule + badge s recurrence (`daily` / `weekly` / `once`)
  - Řádek 2 (muted): název projektu (v barvě) · "next {datum} (in Xh)" · model
- Pravý blok: status posledního runu (barevná tečka + label + "last Xh ago") nebo "No runs yet"
- Chevron ikona (rotuje při expandu)

**Card body** (visible při expand):

1. **Prompt sekce**: label "Prompt" + `<pre>` s textem promptu

2. **Run history sekce**: nadpis "Run history" + počet
   - Tabulka runů: sloupce When | Status | Duration | Cost · tokens | Output (první řádek)
   - Klik na řádek → RunDetailModal
   - Prázdný stav: "No runs yet — this job is waiting for its first scheduled time."

## RunDetailModal

Modal s detailem jednoho runu:

**Meta grid**:
```
Project     název (v barvě projektu)
Status      Success / Failed / Needs input / Running (barevně)
Ran at      {absolutní datum}
Duration    Xm Xs
Model       sonnet-4.6
Cost        $X.XX · Xk→Xk tok
```

**Input sekce**: label + `<pre class="run-io-box input">` s promptem

**Output sekce**: label + `<pre class="run-io-box output {status}">` s výstupem (barevně dle statusu)

**Patička**: Close + "Re-run now" → POST /api/schedules/{id}/run

## SchedulerModal — nový schedule

**Formulář**:
- Project (dropdown ze scaneru projektů)
- Title (optional text input, placeholder "e.g. Nightly type-check sweep")
- Prompt (textarea, placeholder s popisem)
- Date + Time (dva side-by-side inputy: `type="date"` + `type="time"`)
- Recurrence (select): Once | Daily | Weekly
- Model (select): opus-4.7 | sonnet-4.6 | haiku-4.5

**Poznámka k cron výrazu**: prototyp používá date+time+recurrence místo raw cron — implementovat stejně (žádný cron input field). Cron expression generovat na serveru z těchto tří hodnot.

**Submit**: disabled pokud prompt prázdný nebo datum nevalidní. Po úspěchu zavřít modal.

## Data model schedule

```typescript
{
  id: string
  projectId: string
  title: string
  prompt: string
  runAt: number        // timestamp příštího runu
  recurrence: 'once' | 'daily' | 'weekly'
  model: string
  enabled: boolean
  history: RunRecord[]
}

type RunRecord = {
  id: string
  ranAt: number
  durationMs: number
  status: 'success' | 'failed' | 'needs-input' | 'running'
  tokensIn: number
  tokensOut: number
  cost: number
  input: string        // použitý prompt
  output: string       // výstup agenta
}
```
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Schedules se zobrazují jako accordion karty s recurrence badge a barvou projektu
- [x] #2 Klik na header rozbalí/sbalí run history a prompt
- [x] #3 Run history tabulka zobrazuje When/Status/Duration/Cost/Output sloupy
- [x] #4 Klik na řádek runu otevře RunDetailModal s plným inputem a outputem
- [x] #5 'Re-run now' v RunDetailModal volá POST /api/schedules/{id}/run
- [x] #6 SchedulerModal má pole: Project/Title/Prompt/Date/Time/Recurrence/Model (bez raw cron)
- [x] #7 Submit je disabled pokud prompt prázdný nebo datum nevalidní
- [x] #8 Po vytvoření se schedule okamžitě objeví v seznamu
- [x] #9 enable/disable schedule funguje bez smazání (toggle v header nebo detail)
<!-- AC:END -->
