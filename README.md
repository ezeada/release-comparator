# Slate Setter

Release weekend intelligence for theatrical distribution teams. Enter your film’s genre and MPAA rating, get a ranked list of domestic Fri–Sun weekends for the next 12 months, and drill into competition, historical analogs, and factor-level scores.

**Live demo:** enable GitHub Pages on this repo (Settings → Pages → Source: GitHub Actions). The app ships from `/docs`.

## What it does

1. **Configure your film** — primary genre + MPAA rating (title optional).
2. **Ranked weekends** — composite score with plain-language rationale.
3. **Expand a weekend** — five factor progress bars, competitive landscape (wide releases + projected holdovers), historical analogs.
4. **Compare mode** — select two weekends for side-by-side factor comparison.
5. **Calendar view** — 12-month heatmap by score.

## Quick start (local)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Serve the static app (after data exists)
python -m http.server 8080 --directory docs
# Open http://localhost:8080
```

## Refresh data (~every 3 weeks)

Data is scraped from [Box Office Mojo](https://www.boxofficemojo.com) (historical weekends + upcoming wide calendar) and cached as JSON. No database.

```bash
source .venv/bin/activate

# Full refresh (10 years historical — ~30–60 min first run)
python scripts/refresh_data.py

# Faster dev refresh (last 3 years, capped metadata)
python scripts/refresh_data.py --quick --max-films 300
```

This writes `docs/data/slate_setter.json`. Commit and push to update the live site.

## GitHub Pages setup

1. Push repo to GitHub.
2. **Settings → Pages → Build and deployment → Source:** GitHub Actions.
3. Push to `main` — the workflow in `.github/workflows/pages.yml` deploys `/docs`.

## Scoring (v1)

| Factor | Weight | Display |
|--------|--------|---------|
| Successful weekend | 25% | Historical total market strength for this week-of-year |
| In-genre strength | 25% | How your genre performed in this slot historically |
| Calendar boost | 20% | Holidays, 3-day weekends, Oscar week, etc. |
| Low competition | 15% | Inverse of wide release crowding |
| Low audience overlap | 25% | Genre (75%) + MPAA rating (25%) vs active films |

Holdovers: **5-week projection** for scheduled titles; **actual weekly data** for historical analysis. Wide threshold: **600+ theaters**.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [TRADEOFFS.md](TRADEOFFS.md) for design decisions.

## Project structure

```
docs/                 # GitHub Pages static app
scripts/              # Python scrape + build pipeline
data/raw/             # Scrape cache (gitignored; regenerated)
data/processed/       # Built JSON bundle (gitignored; copied to docs/)
```

## Questions for the distribution team

We’re validating these assumptions:

1. Is **genre + MPAA rating** sufficient for “audience overlap,” or do you use comps / target demos?
2. Is a **~5-week holdover** reasonable for projecting competition, or genre-specific decay curves?
3. How stale can scheduled release dates get before the tool misleads planning?

## License

Take-home project — not affiliated with any studio.
