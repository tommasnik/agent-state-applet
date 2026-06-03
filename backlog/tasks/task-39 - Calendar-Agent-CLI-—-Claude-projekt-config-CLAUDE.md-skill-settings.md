---
id: TASK-39
title: Calendar Agent CLI — Claude projekt config (CLAUDE.md + skill + settings)
status: Done
assignee: []
created_date: '2026-06-03 16:30'
updated_date: '2026-06-03 17:08'
labels:
  - calendar-agent-cli
dependencies:
  - TASK-36
  - TASK-37
  - TASK-38
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Z calendar-agent-cli/ udělat nakonfigurovaný Claude Code projekt. Rozhodovací logika z `calendar-agent/prompt.md` se přesune do skillu + CLAUDE.md. Spouští se `claude -p "/sync-calendar"`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 .claude/skills/sync-calendar/ obsahuje návod + rozhodovací logiku (konzervativní kritéria, dedup proti AI kalendáři, embedding zdrojů, kdy eskalovat) + kroky volání cal-agent příkazů
- [x] #2 CLAUDE.md ve složce: hranice (jen AI kalendář zápis, jen whitelist skupiny), AI-cal ID a whitelist se berou z cal-agent (ne hádat), pointer na skill
- [x] #3 .claude/settings.json povolí Bash(cal-agent:*) (a potřebné read podkomandy) pro headless běh bez promptů
- [x] #4 ruční ověření připraveno (skill+config kompletní a konzistentní s reálnými cal-agent příkazy); claude -p "/sync-calendar" běh provede orchestrátor
<!-- AC:END -->
