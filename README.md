# Release Ranking

Enter your film's genre and MPAA rating, get a ranked list of domestic Fri–Sun weekends for the next 12 months, and drill into competition, historical analogs, and factor-level scores.

## What it does

1. Enter film information — primary genre + MPAA rating (title optional).
2. Rank weekends — composite release score with badges for market size, holidays, crowding, and audience overlap.
3. Weekend detail — factor breakdown, competitive landscape (scheduled wide releases + projected holdovers), and historical analogs when the schedule is thin.
4. Compare mode — pick two weekends (from the list or date fields) for side-by-side scores with winner tags per factor.
5. Filter & tune — date-range pickers after ranking; adjustable scoring weights, holdover weeks, wide threshold, and history window in Scoring parameters.

## Data sources

There aren't reliable public APIs for this — the pipeline uses web scraping and caches results as JSON.

| Source | What we pull | Notes |
|--------|----------------|-------|
| [Box Office Mojo](https://www.boxofficemojo.com) | Historical Fri–Sun weekends, wide chart entries, upcoming wide calendar | Primary source for grosses, schedules, genres, ratings, posters |
| [The Numbers](https://www.the-numbers.com) | Wide release schedules (prompt suggestion) | Attempted; site returned 403 during scraping, so wide schedules come from BOM's calendar instead (documented in [TRADEOFFS.md](TRADEOFFS.md)) |

We track individual wide-release titles, not studio-level rollups. Major-studio grouping is out of scope for v1 — see [TRADEOFFS.md](TRADEOFFS.md).

## Scoring (v1)

Each weekend gets five factor scores from 0–100. The release score is their weighted average. Weights and assumptions are adjustable in the app (Scoring parameters); defaults below.

| Factor | Default weight | What it measures |
|--------|----------------|------------------|
| Successful weekend | 25% | Total market size for this week-of-year (percentile) |
| In-genre strength | 25% | Your genre's performance in this slot (percentile) |
| Calendar / holiday boost | 20% | Yes (100) if a flagged holiday/event applies; no (0) otherwise |
| Competition (wide releases) | 15% | Inverse of wide-release crowding; factor label shows low / moderate / high competition by score (list badges use raw count: ≤3 / 4–5 / 6+) |
| Low audience overlap | 25% | Inverse of films in market sharing both your genre and MPAA rating |

### Percentile factors (Successful weekend & in-genre strength)

Successful weekend and in-genre strength are percentile ranks, not dollar predictions.

For Successful weekend:

1. Take every Fri–Sun in your historical window that falls in the same week-of-year as the weekend you're evaluating (e.g. week 24).
2. Compute the median total domestic gross for that slot.
3. Do the same for all 52 weeks-of-year to get 52 slot medians.
4. The factor score is the percentile rank of this slot's median among those 52 values.

So a score of 88 means that week-of-year's historical median total market is larger than ~88% of all calendar weeks — it's a strong market slot, not "$88M" or an opening forecast.

In-genre strength uses the same percentile logic, but the comparison set is different: within that same week-of-year, we take the median in-chart gross for wide releases in your genre and rank it against the medians for other genres in that slot.

Calendar / holiday boost is binary: 100 = yes, 0 = no.

Audience overlap — a competitor counts toward overlap only if it matches both your selected genre and rating (e.g. Horror + R vs. another Horror + R wide release). Matching titles are highlighted in the competition grid.

Other non-percentile factors (crowding, overlap) are direct 0–100 scores. All factor scores are rounded to whole numbers.

### Defaults & assumptions

- Holdover projection: 5 weeks for scheduled and in-market titles (adjustable 1–8 in the app)
- Wide release threshold: 600+ theaters for historical analogs (adjustable)
- Historical window: years covered in the cached dataset (adjustable via year dropdowns)

## Design tradeoffs

Product and engineering choices (composite vs. forecast, genre+rated overlap, BOM vs. The Numbers, cached JSON, client-side ranking, etc.) are documented in [TRADEOFFS.md](TRADEOFFS.md). Pipeline and scoring implementation details are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Project structure

```
docs/                 # GitHub Pages static app (Release Ranking UI)
scripts/              # Python scrape + build pipeline
data/raw/             # Scrape cache (gitignored; regenerated)
data/processed/       # Built JSON bundle (gitignored; copied to docs/)
```
