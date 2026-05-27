---
id: TASK-26
title: 'Frontend: project detail — add Runs tab with per-project history'
status: Done
assignee: []
created_date: '2026-05-27 13:40'
updated_date: '2026-05-27 15:11'
labels:
  - frontend
  - ui
  - tdd
milestone: m-0
dependencies:
  - TASK-24
  - TASK-25
priority: medium
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a "Runs" tab to the existing project detail view (wherever the current project page is).

## Tab layout

```
[ Overview ]  [ Runs ]  [ Schedules ]
```

Runs tab content is identical to the global `/runs` page but pre-filtered to this project and without the Project filter dropdown (it's implicit).

## Behaviour
- Default sort: started_at DESC
- Shows all run types (scheduled + manual) for this project
- Type filter still available (filter within project)
- Status filter available
- Clicking TYPE badge for scheduled → navigates to `/schedules/:id`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Runs tab appears in project detail navigation
- [x] #2 Runs tab pre-filters by project_root of current project
- [x] #3 Project filter dropdown absent (project is implicit)
- [x] #4 All run types shown for this project
- [x] #5 Type and status filters work within project scope
- [x] #6 Clicking scheduled badge navigates to schedule detail
- [x] #7 Tests: tab renders with correct project filter applied to API call
- [x] #8 Tests: type/status filter interactions
- [x] #9 Tests: empty state for project with no runs
<!-- AC:END -->
