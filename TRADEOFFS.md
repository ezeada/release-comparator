# Tradeoffs

Documenting what we prioritized, what we cut, and why — for a ~3–6 hour build window.

## Product

| Decision | Chose | Over | Why |
|----------|-------|------|-----|
| Primary view | Ranked list + expand | Calendar-first | Matches “narrow down dates” workflow |
| Score type | Composite + factor bars | Predicted opening gross | Honest without a forecasting model; still actionable |
| Overlap signal | Genre + MPAA | Comps / demos | Team question #1; shippable v1 |
| Holdover | 5-week default (future) | Per-title ML decay | Team question #2; labeled as estimated |
| One film at a time | Yes | Slate planner | Scope for take-home |

## Data

| Decision | Chose | Over | Why |
|----------|-------|------|-----|
| Wide only (600+) | Yes | Limited releases | Clear signal; limited→wide is v2 |
| BOM for schedules | Yes | The Numbers | The Numbers returned 403 in scraping; BOM calendar has Wide/Limited |
| 10-year history | Target | 5-year | User preference; `--quick` for dev |
| Cached JSON | Yes | Live scrape in app | GitHub Pages is static; scraping in browser is impossible |
| Imperfect metadata | Transparent gaps | Block until complete | 100% coverage isn’t realistic without paid APIs |

## Technical

| Decision | Chose | Over | Why |
|----------|-------|------|-----|
| Static site on Pages | Yes | FastAPI hosted | User asked for GitHub Pages |
| Client-side ranking | Yes | Python API | Instant interaction; no server |
| Flat files | Yes | SQLite | Refresh rebuilds whole bundle; simple deploy |
| Python scrapers | Yes | Node scrapers | pandas/BS4/boxoffice-api ecosystem |
| No frontend framework | Yes | React | Faster to ship polished CSS; smaller payload |

## UI / branding

| Decision | Chose | Over | Why |
|----------|-------|------|-----|
| Dark, minimal | Yes | Studio-branded | “Sleek and practical” without A24 marks |
| Parameters panel | Yes | Hidden magic | Reviewers asked for product thinking visibility |
| Compare mode | Yes | — | High value for release strategists, low build cost |

## Known limitations

1. **Overlap without genre metadata** — some chart titles lack BOM genre tags; they count toward crowding but not overlap.
2. **Holdover projection is uniform** — week 4 of a blockbuster treated same as week 4 of a flop for future weekends.
3. **Calendar events are rule-based** — Oscar date approximated as 2nd Sunday in March; good enough for boost scoring, not legal scheduling.
4. **No user accounts / saved slates** — static demo; URL hash could add shareable state later.
5. **Full metadata enrichment is slow** — first full scrape may cap `--max-films`; re-run without cap overnight for better coverage.

## If we had another week

1. Limited-release → wide expansion from BOM calendar deltas
2. Adjustable weights in UI with persistence
3. Export PDF / one-pager for internal meetings
4. Email digest when a high-overlap wide release moves into a candidate weekend
5. TMDB integration for audience keywords if team confirms overlap model
