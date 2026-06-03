---
id: TASK-30
title: Calendar Agent — prompt.md (rozhodovací logika)
status: Done
assignee: []
created_date: '2026-06-03 08:42'
updated_date: '2026-06-03 10:14'
labels: []
dependencies:
  - TASK-28
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Master prompt = soubor `prompt.md` v packagi `calendar-agent/`, verzovaný s kódem (NE editovaný přes UI). Definuje veškerou rozhodovací logiku agenta.

## Co prompt musí pokrýt

### Vstup
- Číst jen whitelistované WA skupiny a Gmail odesílatele/labely (config z MCP tasku)
- Okno: zatím od posledního běhu / ruční rozsah

### Rozhodnutí co je událost
- Konzervativní: vytvářet event jen když je jasné datum/čas/termín
- Nejednoznačné náznaky → NEpsat do kalendáře, ale eskalovat (viz queue)

### Zápis do AI kalendáře
- HRANICE: psát VÝHRADNĚ do vyhrazeného AI kalendáře, ostatní kalendáře jen číst pro kontext (kolize). Tato hranice je jen instrukce — OAuth ji nevynucuje
- Každý event nese v popisu KONKRÉTNÍ ZDROJE: linky na maily + přílohy, texty relevantních WA zpráv

### Sémantický dedup
- Před zápisem přečíst AI kalendář
- Nový mail "školní výjezd" → najít existující event o stejném tématu a UPRAVIT ho (zdroje vždy ponechat); nenajde-li → vytvořit nový

### Eskalace
- Když si není jistý → zapsat do approval queue appletu (samostatný task), session čeká na odpověď

## Mimo rozsah
- Mechanika queue/streaming (samostatné tasky) — prompt jen popisuje KDY eskalovat
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 prompt.md existuje v packagi a je načítaný jako systémový prompt
- [x] #2 Prompt definuje konzervativní kritéria události, sémantický dedup a embedding zdrojů do eventu
- [x] #3 Prompt instruuje psát jen do AI kalendáře a eskalovat při nejistotě
<!-- AC:END -->
