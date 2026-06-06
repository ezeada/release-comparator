"""Scrape historical domestic weekend charts from Box Office Mojo."""

from __future__ import annotations

import json
import re
import time
from datetime import datetime
from pathlib import Path

import requests
from boxoffice_api import BoxOffice
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = ROOT / "data" / "cache"
RAW_DIR = ROOT / "data" / "raw"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}

WIDE_THEATER_THRESHOLD = 600
REQUEST_DELAY = 0.35


def _parse_money(value: str) -> int:
    if not value or value in {"-", "–"}:
        return 0
    cleaned = re.sub(r"[^0-9]", "", value)
    return int(cleaned) if cleaned else 0


def _parse_int(value: str) -> int:
    if not value or value in {"-", "–"}:
        return 0
    cleaned = re.sub(r"[^0-9]", "", value)
    return int(cleaned) if cleaned else 0


def _parse_weekend_dates(year: int, week: int) -> tuple[str, str]:
    url = f"https://www.boxofficemojo.com/weekend/{year}W{week}/"
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")
    for text in soup.stripped_strings:
        match = re.match(r"([A-Za-z]+ \d{1,2})-\d{1,2}, (\d{4})", text)
        if match:
            start = datetime.strptime(f"{match.group(1)}, {match.group(2)}", "%B %d, %Y")
            friday = start.date().isoformat()
            return friday, text
    raise ValueError(f"Could not parse dates for {year}W{week}")


def scrape_weekends(
    start_year: int = 2015,
    end_year: int | None = None,
    delay: float = REQUEST_DELAY,
) -> dict:
    end_year = end_year or datetime.now().year
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    cache_path = RAW_DIR / "weekends.json"
    if cache_path.exists():
        cached = json.loads(cache_path.read_text())
    else:
        cached = {"weekends": [], "films_seen": {}}

    existing_keys = {(w["year"], w["week"]) for w in cached["weekends"]}
    bo = BoxOffice()

    for year in range(start_year, end_year + 1):
        max_week = 52 if year < datetime.now().year else datetime.now().isocalendar()[1]
        for week in range(1, max_week + 1):
            if (year, week) in existing_keys:
                continue
            try:
                rows = bo.get_weekend(year=year, week=week)
                if not rows:
                    continue
                friday, label = _parse_weekend_dates(year, week)
            except Exception as exc:  # noqa: BLE001
                print(f"  skip {year}W{week}: {exc}")
                time.sleep(delay)
                continue

            entries = []
            total_gross = 0
            wide_count = 0
            for row in rows:
                title = row.get("Release", "").strip()
                if not title or title == "Totals":
                    continue
                theaters = _parse_int(row.get("Theaters", ""))
                gross = _parse_money(row.get("Gross", ""))
                weeks = _parse_int(row.get("Weeks", ""))
                total_gross += gross
                is_wide = theaters >= WIDE_THEATER_THRESHOLD
                if is_wide:
                    wide_count += 1
                entries.append(
                    {
                        "title": title,
                        "gross": gross,
                        "theaters": theaters,
                        "weeks_in_release": weeks,
                        "is_wide": is_wide,
                        "is_new_wide_release": is_wide and weeks <= 1,
                    }
                )
                cached["films_seen"].setdefault(title, {"title": title, "appearances": 0})
                cached["films_seen"][title]["appearances"] += 1

            cached["weekends"].append(
                {
                    "year": year,
                    "week": week,
                    "friday": friday,
                    "label": label,
                    "total_gross": total_gross,
                    "wide_release_count": wide_count,
                    "entries": entries,
                }
            )
            existing_keys.add((year, week))
            print(f"  scraped {year}W{week} ({label}) — {wide_count} wide, ${total_gross:,}")

            if len(cached["weekends"]) % 25 == 0:
                cache_path.write_text(json.dumps(cached, indent=2))

            time.sleep(delay)

    cache_path.write_text(json.dumps(cached, indent=2))
    return cached
