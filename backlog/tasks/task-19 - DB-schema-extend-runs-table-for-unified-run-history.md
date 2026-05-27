---
id: TASK-19
title: 'DB schema: extend runs table for unified run history'
status: In Progress
assignee: []
created_date: '2026-05-27 13:38'
updated_date: '2026-05-27 14:34'
labels:
  - backend
  - db
  - tdd
milestone: m-0
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the existing `runs` SQLite table (and add migration) to support unified history for both scheduled and manual sessions.

## Schema changes

Add columns to `runs`:
- `pid INTEGER` — PID of the claude process (for lifecycle linking)
- `launch_type TEXT` — `'scheduled'` | `'manual'` | `'manual_trigger'`
- `terminal_type TEXT` — `'ghostty'` | `'idea'` | `'generic'` | NULL (only set for manual runs)
- `ai_title TEXT` — copied from AgentStore on run close
- `session_id TEXT` — claude session_id (for dedup / TTY recycle linking)

`schedule_id` stays nullable — NULL means manual run.

## Migration

Write migration that adds columns with DEFAULT NULL so existing rows are untouched. Migration runs on server startup if columns are missing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Migration runs idempotently — no error if columns already exist
- [x] #2 All new columns present after migration on a fresh DB
- [x] #3 All new columns present after migration on an existing DB with old schema
- [x] #4 Existing runs rows unaffected by migration (NULLs filled in for new columns)
- [x] #5 Tests: migration on fresh DB, migration on existing DB, idempotency (run twice)
- [x] #6 Tests: inserting and querying each new column
<!-- AC:END -->
