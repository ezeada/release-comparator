# Architecture

## Overview

Release Ranking is a **static-first** web app: all ranking runs in the browser against a pre-built JSON bundle. Python handles data acquisition and refresh; there is no runtime server in production.

```
┌─────────────────────┐     refresh (local/CI)      ┌──────────────────┐
│ Box Office Mojo     │ ──────────────────────────► │ scripts/*.py     │
│ (weekends, calendar)│                               │                  │
└─────────────────────┘                               └────────┬─────────┘
                                                               │
                                                               ▼
                                                    docs/data/slate_setter.json
                                                               │
                                                               ▼
┌─────────────────────┐                               ┌──────────────────┐
│ GitHub Pages        │ ◄── deploy /docs ────────────│ Static UI        │
│ (CDN)               │                               │ ranking.js       │
└─────────────────────┘                               └──────────────────┘
```

## Technical choices

See [TRADEOFFS.md](TRADEOFFS.md) for the full decision log. At a high level:

| Choice | Rationale |
|--------|-----------|
| Client-side ranking | Instant re-rank when genre/rating or parameters change; no API to maintain |
| Flat JSON bundle | Simple to inspect, diff, and refresh on a ~3-week cadence |
| No frontend framework | Faster to ship polished CSS; smaller payload on Pages |

Data acquisition runs offline via `scripts/*.py` (not shipped to the browser). The live app is static HTML/JS/CSS deployed from `/docs`.

## Data pipeline

### 1. Historical weekends (`scrape_weekends.py`)

- Source: Box Office Mojo via `boxoffice-api` + date labels from weekend pages.
- Range: 2015 → present (configurable).
- Each weekend stores wide entries (600+ theaters), gross, and **actual** `weeks_in_release`.

### 2. Upcoming wide releases (`scrape_calendar.py`)

- Source: BOM `/calendar/` table.
- Filters: `Scale == Wide` only.
- Maps release dates → opening Fri–Sun weekend.

### 3. Film metadata (`enrich_films.py`)

- Source: BOM title pages (genres, MPAA).
- Cached in `data/cache/film_metadata.json` to avoid repeat fetches.
- Prioritizes upcoming slate + recent chart titles when capped.

### 4. Processed bundle (`build_processed.py`)

Builds:

- **`historical_weekends`** — enriched chart rows for analog lookups.
- **`historical_slots`** — aggregated by ISO week-of-year (median market + per-genre stats).
- **`future_weekends`** — next 12 months with:
  - **Scheduled** wide releases (5-week holdover projection).
  - **Current holdovers** carried from the latest scraped weekend.
- **`config`** — genres, ratings, scoring weights.

Output: `docs/data/slate_setter.json` (committed for Pages).

## Ranking engine (`docs/js/ranking.js`)

Pure functions, no dependencies. For each candidate weekend:

1. **market_strength** — percentile of slot median total gross vs all slots.
2. **genre_strength** — percentile of genre median gross in that slot.
3. **calendar_boost** — mapped from holiday/event table (`scripts/holidays.py`).
4. **crowding** — decreases as wide active count rises; UI label reads low / moderate / high competition by score band.
5. **audience_overlap** — inverted overlap score; counts films matching **both** user genre and MPAA rating.

Composite = weighted sum (weights in JSON config, surfaced in UI).

## UI (`docs/`)

- Single page, CSS custom properties, no framework (fast load on Pages).
- **Ranked list** — primary workflow; select a weekend for detail.
- **Compare mode** — two weekends, side-by-side factors with winner tags.
- **Scoring parameters** — adjustable weights and assumptions; re-ranks in browser.

## Refresh cadence

Designed for ~3-week manual refresh:

```bash
python scripts/refresh_data.py
git add docs/data/slate_setter.json
git commit -m "chore: refresh box office data"
git push
```

GitHub Actions redeploys Pages automatically.

## Failure modes

| Issue | Mitigation |
|-------|------------|
| BOM HTML changes | Scrape scripts fail loudly; last good JSON remains live |
| Missing genre/rating | Film still listed; overlap scoring degrades gracefully |

## v2 directions

- Limited → wide expansion tracking
- Persisted scoring-parameter presets
- Genre-specific holdover decay curves
- International territories
- Studio / distributor filters on the competitive slate
- Shareable compare links via URL hash
