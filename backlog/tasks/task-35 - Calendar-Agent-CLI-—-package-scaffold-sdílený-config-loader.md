---
id: TASK-35
title: Calendar Agent CLI — package scaffold + sdílený config loader
status: Done
assignee: []
created_date: '2026-06-03 16:30'
updated_date: '2026-06-03 16:34'
labels:
  - calendar-agent-cli
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Nový samostatný TS balíček `calendar-agent-cli/` (SOUROZENEC `calendar-agent/`, který NESMÍ být měněn — zůstává jako referenční SDK řešení). Základ pro CLI `cal-agent`.

Referenční řešení (`calendar-agent/`) ponechat netknuté pro srovnání. Sdílet se bude jen config v `~/.config/agent-manager/` (calendar-agent.json: aiCalendarId, whitelist; google-oauth.json).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Nový balíček calendar-agent-cli/ (vlastní package.json, tsconfig, CommonJS strict, jest) se buildí
- [x] #2 bin entry cal-agent (node dist/cli.js) nastartuje a vypíše help/usage
- [x] #3 config loader čte ~/.config/agent-manager/calendar-agent.json (aiCalendarId, whitelist) — recykluje/zrcadlí logiku z calendar-agent/src/config.ts, ale nezávisle
- [x] #4 calendar-agent/ zůstává beze změny (git diff prázdný mimo nový balíček)
<!-- AC:END -->
