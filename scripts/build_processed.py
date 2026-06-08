"""Build processed JSON bundles for the static Slate Setter app."""

from __future__ import annotations

import json
import shutil
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

from holidays import build_holiday_index

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
CACHE_DIR = ROOT / "data" / "cache"
PROCESSED_DIR = ROOT / "data" / "processed"
DOCS_DATA = ROOT / "docs" / "data"

HOLDOVER_WEEKS = 5
GENRES = [
    "Action",
    "Adventure",
    "Animation",
    "Biography",
    "Comedy",
    "Crime",
    "Documentary",
    "Drama",
    "Family",
    "Fantasy",
    "History",
    "Horror",
    "Music",
    "Musical",
    "Mystery",
    "Romance",
    "Sci-Fi",
    "Sport",
    "Thriller",
    "War",
    "Western",
]
RATINGS = ["G", "PG", "PG-13", "R", "NC-17"]


def _week_of_year(friday_iso: str) -> int:
    return date.fromisoformat(friday_iso).isocalendar()[1]


def _add_weeks(friday_iso: str, n: int) -> str:
    return (date.fromisoformat(friday_iso) + timedelta(weeks=n)).isoformat()


def build_processed() -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    DOCS_DATA.mkdir(parents=True, exist_ok=True)

    raw_weekends = json.loads((RAW_DIR / "weekends.json").read_text())
    meta_path = CACHE_DIR / "film_metadata.json"
    metadata = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    upcoming_path = RAW_DIR / "upcoming.json"
    upcoming = json.loads(upcoming_path.read_text()) if upcoming_path.exists() else []

    # Historical slot aggregates (by week-of-year)
    slot_totals: dict[int, list[int]] = defaultdict(list)
    slot_wide_counts: dict[int, list[int]] = defaultdict(list)
    slot_genre_gross: dict[int, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))

    historical_weekends = []
    for w in raw_weekends["weekends"]:
        friday = w["friday"]
        woy = _week_of_year(friday)
        slot_totals[woy].append(w["total_gross"])
        slot_wide_counts[woy].append(w["wide_release_count"])

        enriched_entries = []
        for entry in w["entries"]:
            meta = metadata.get(entry["title"], {})
            enriched = {
                **entry,
                "genres": meta.get("genres", []),
                "mpaa_rating": meta.get("mpaa_rating"),
            }
            enriched_entries.append(enriched)
            if entry["is_wide"]:
                for genre in enriched["genres"]:
                    slot_genre_gross[woy][genre].append(entry["gross"])

        historical_weekends.append(
            {
                "friday": friday,
                "year": w["year"],
                "week": w["week"],
                "label": w["label"],
                "week_of_year": woy,
                "total_gross": w["total_gross"],
                "wide_release_count": w["wide_release_count"],
                "entries": enriched_entries,
            }
        )

    # Slim export for static app (drop per-film chart rows)
    historical_weekends_slim = [
        {
            "friday": w["friday"],
            "week_of_year": w["week_of_year"],
            "total_gross": w["total_gross"],
            "wide_release_count": w["wide_release_count"],
        }
        for w in historical_weekends
    ]

    historical_slots = {}
    for woy, totals in slot_totals.items():
        totals_sorted = sorted(totals)
        median = totals_sorted[len(totals_sorted) // 2]
        genre_stats = {}
        for genre, grosses in slot_genre_gross[woy].items():
            g_sorted = sorted(grosses)
            genre_stats[genre] = {
                "median_gross": g_sorted[len(g_sorted) // 2],
                "sample_size": len(grosses),
            }
        wide_counts = sorted(slot_wide_counts[woy])
        historical_slots[str(woy)] = {
            "median_total_gross": median,
            "median_wide_count": wide_counts[len(wide_counts) // 2] if wide_counts else 0,
            "sample_weekends": len(totals),
            "genre_stats": genre_stats,
        }

    # Carry current wide holdovers forward from the most recent scraped weekend
    current_holdovers: list[dict] = []
    if historical_weekends:
        latest = max(historical_weekends, key=lambda w: w["friday"])
        for entry in latest["entries"]:
            if entry["is_wide"] and entry["weeks_in_release"] >= 1:
                open_friday = _add_weeks(latest["friday"], -(entry["weeks_in_release"] - 1))
                meta = metadata.get(entry["title"], {})
                current_holdovers.append(
                    {
                        "title": entry["title"],
                        "opening_friday": open_friday,
                        "genres": entry["genres"],
                        "mpaa_rating": entry["mpaa_rating"],
                        "imdb_id": meta.get("imdb_id"),
                        "poster_url": meta.get("poster_url"),
                        "weeks_in_release_at_anchor": entry["weeks_in_release"],
                        "anchor_friday": latest["friday"],
                    }
                )

    # Future competition with projected 5-week holdover
    today = date.today()
    horizon = today + timedelta(days=365)
    candidate_fridays: list[str] = []
    cursor = today
    while cursor <= horizon:
        friday = cursor + timedelta(days=(4 - cursor.weekday()) % 7)
        if friday not in [date.fromisoformat(f) for f in candidate_fridays]:
            candidate_fridays.append(friday.isoformat())
        cursor += timedelta(days=7)

    poster_lookup: dict[str, str] = {}
    for title, meta in metadata.items():
        url = meta.get("poster_url")
        if not url:
            continue
        poster_lookup[title] = url
        if meta.get("imdb_id"):
            poster_lookup[meta["imdb_id"]] = url

    scheduled = []
    for item in upcoming:
        film_meta = metadata.get(item["title"], {})
        scheduled.append(
            {
                **item,
                "genres": item.get("genres") or film_meta.get("genres", []),
                "mpaa_rating": item.get("mpaa_rating") or film_meta.get("mpaa_rating"),
                "poster_url": film_meta.get("poster_url"),
            }
        )

    def _film_payload(film: dict, **extra) -> dict:
        meta = metadata.get(film.get("title", ""), {})
        return {
            "title": film.get("title"),
            "genres": film.get("genres") or meta.get("genres", []),
            "mpaa_rating": film.get("mpaa_rating") or meta.get("mpaa_rating"),
            "imdb_id": film.get("imdb_id") or meta.get("imdb_id"),
            "poster_url": film.get("poster_url") or meta.get("poster_url"),
            **extra,
        }

    def historical_analog_competition(week_of_year: int) -> list[dict]:
        """Wide openers that historically landed in this week-of-year slot."""
        seen: set[str] = set()
        analogs: list[dict] = []
        for w in sorted(historical_weekends, key=lambda item: item["year"], reverse=True):
            if w["week_of_year"] != week_of_year:
                continue
            for entry in w["entries"]:
                if not entry["is_wide"] or entry["weeks_in_release"] > 1:
                    continue
                if entry["title"] in seen:
                    continue
                seen.add(entry["title"])
                analogs.append(
                    _film_payload(
                        entry,
                        week_in_release=1,
                        source="historical_analog",
                        is_new_release=True,
                        holdover_estimated=False,
                        analog_year=w["year"],
                        analog_gross=entry["gross"],
                    )
                )
            if len(analogs) >= 8:
                break
        analogs.sort(key=lambda item: item.get("analog_gross", 0), reverse=True)
        return analogs[:8]

    def active_films_for_weekend(friday_iso: str) -> list[dict]:
        active: list[dict] = []
        friday = date.fromisoformat(friday_iso)

        for film in current_holdovers:
            open_date = date.fromisoformat(film["opening_friday"])
            weeks_out = (friday - open_date).days // 7
            if 0 <= weeks_out < HOLDOVER_WEEKS:
                active.append(
                    _film_payload(
                        film,
                        week_in_release=weeks_out + 1,
                        source="current_holdover",
                        is_new_release=weeks_out == 0,
                        holdover_estimated=friday > date.fromisoformat(film["anchor_friday"]),
                    )
                )

        for film in scheduled:
            open_date = date.fromisoformat(film["opening_friday"])
            weeks_out = (friday - open_date).days // 7
            if 0 <= weeks_out < HOLDOVER_WEEKS:
                active.append(
                    _film_payload(
                        film,
                        week_in_release=weeks_out + 1,
                        source="scheduled",
                        is_new_release=weeks_out == 0,
                        holdover_estimated=weeks_out > 0,
                    )
                )
        return active

    future_weekends = []
    start_year = today.year
    end_year = today.year + 1
    holidays = build_holiday_index(start_year - 1, end_year + 1)

    for friday_iso in candidate_fridays:
        woy = _week_of_year(friday_iso)
        slot = historical_slots.get(str(woy), {})
        scheduled_comp = active_films_for_weekend(friday_iso)
        analog_comp = historical_analog_competition(woy)
        future_weekends.append(
            {
                "friday": friday_iso,
                "week_of_year": woy,
                "historical_slot": slot,
                "events": holidays.get(friday_iso, []),
                "competition": scheduled_comp,
                "historical_competition": analog_comp,
                "competition_is_estimated": len(scheduled_comp) == 0,
            }
        )

    # Data quality stats
    meta_with_genre = sum(1 for m in metadata.values() if m.get("genres"))
    meta_with_rating = sum(1 for m in metadata.values() if m.get("mpaa_rating"))
    scheduled_with_genre = sum(1 for s in scheduled if s.get("genres"))
    scheduled_with_rating = sum(1 for s in scheduled if s.get("mpaa_rating"))

    historical_wide_openers = []
    for w in historical_weekends:
        for entry in w["entries"]:
            if entry["weeks_in_release"] > 1:
                continue
            meta = metadata.get(entry["title"], {})
            historical_wide_openers.append(
                {
                    "title": entry["title"],
                    "year": w["year"],
                    "week_of_year": w["week_of_year"],
                    "genres": entry.get("genres") or meta.get("genres", []),
                    "mpaa_rating": entry.get("mpaa_rating") or meta.get("mpaa_rating"),
                    "gross": entry.get("gross", 0),
                    "theaters": entry.get("theaters", 0),
                    "imdb_id": meta.get("imdb_id"),
                    "poster_url": meta.get("poster_url"),
                }
            )

    bundle = {
        "metadata": {
            "generated_at": datetime.now().astimezone().isoformat(),
            "historical_weekends": len(historical_weekends),
            "years_covered": sorted({w["year"] for w in historical_weekends}),
            "scheduled_wide_releases": len(scheduled),
            "holdover_weeks_assumption": HOLDOVER_WEEKS,
            "wide_theater_threshold": 600,
            "data_quality": {
                "films_with_genre_pct": round(100 * meta_with_genre / max(len(metadata), 1), 1),
                "films_with_rating_pct": round(100 * meta_with_rating / max(len(metadata), 1), 1),
                "scheduled_with_genre_pct": round(100 * scheduled_with_genre / max(len(scheduled), 1), 1),
                "scheduled_with_rating_pct": round(100 * scheduled_with_rating / max(len(scheduled), 1), 1),
            },
        },
        "config": {
            "genres": GENRES,
            "ratings": RATINGS,
            "weights": {
                "market_strength": 0.25,
                "genre_strength": 0.25,
                "calendar_boost": 0.20,
                "crowding": 0.15,
                "audience_overlap": 0.25,
            },
        },
        "historical_weekends": historical_weekends_slim,
        "historical_slots": historical_slots,
        "future_weekends": future_weekends,
        "scheduled_releases": scheduled,
        "current_holdovers": current_holdovers,
        "historical_wide_openers": historical_wide_openers,
        "poster_lookup": poster_lookup,
    }

    out_path = PROCESSED_DIR / "slate_setter.json"
    out_path.write_text(json.dumps(bundle, indent=2))
    shutil.copy(out_path, DOCS_DATA / "slate_setter.json")
    print(f"  processed bundle -> {out_path} ({out_path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    build_processed()
