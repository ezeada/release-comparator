# Tradeoffs

## Product

| Decision | Chose | Over | Why |
|----------|-------|------|-----|
| Score type | Composite + factor bars | Predicted opening gross | Honest without a forecasting model; still actionable |
| Overlap signal | Genre **and** MPAA (both required) | Comps / demos / genre-only | Matches “same audience” more tightly; e.g. Horror+R vs Horror+R, not Horror+PG-13 |
| Holdover | 5-week default (future) | Per-title ML decay | Team question #2; labeled as estimated |
| One film at a time | Yes | Slate planner | Scope for take-home |
| Studio lens | Title-level wide slate | Major-studio groupings | Prompt mentions tracking major studios; this lists all wide releases with genre/rating overlap — for example: no Universal vs. Sony |

## Data

| Decision | Chose | Over | Why |
|----------|-------|------|-----|
| Wide only (600+) | Yes | Limited releases | Clear signal; limited→wide is v2 |
| BOM for schedules | Yes | The Numbers | The Numbers returned 403 in scraping; BOM calendar has Wide/Limited |
| Cached JSON | Yes | Live scrape in app | GitHub Pages is static; scraping in browser is impossible |
| Imperfect metadata | Transparent gaps | Block until complete | 100% coverage isn’t realistic without paid APIs |

## Technical

| Decision | Chose | Over | Why |
|----------|-------|------|-----|
| Client-side ranking | Yes | Python API | Instant interaction; no server |
| Flat files | Yes | SQLite | Refresh rebuilds whole bundle; simple deploy |

## Known limitations

1. **Overlap without genre metadata** — some chart titles lack BOM genre tags; they count toward crowding but not overlap.
2. **Holdover projection is uniform** — week 4 of a blockbuster treated same as week 4 of a flop for future weekends.
3. **Calendar events are rule-based** — Oscar date approximated as 2nd Sunday in March; good enough for boost scoring, not legal scheduling.
4. **No user accounts / saved slates** — static demo; URL hash could add shareable state later.
5. **Full metadata enrichment is slow** — first full scrape may cap `--max-films`; re-run without cap overnight for better coverage.
