"""Scrape upcoming wide releases from Box Office Mojo calendar."""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}

GENRE_PATTERN = re.compile(
    r"^(Action|Adventure|Animation|Biography|Comedy|Crime|Documentary|Drama|"
    r"Family|Fantasy|History|Horror|Music|Musical|Mystery|Romance|Sci-Fi|"
    r"Sport|Thriller|War|Western)$"
)


def _weekend_friday(release_day: date) -> str:
    """Map release date to the Fri–Sun weekend it opens in."""
    weekday = release_day.weekday()
    if weekday == 4:  # Friday
        return release_day.isoformat()
    if weekday == 5:  # Saturday -> treat as that weekend's Friday
        return (release_day - timedelta(days=1)).isoformat()
    if weekday == 6:  # Sunday
        return (release_day - timedelta(days=2)).isoformat()
    # Mon-Thu: upcoming weekend
    days_until_friday = (4 - weekday) % 7
    return (release_day + timedelta(days=days_until_friday)).isoformat()


def _parse_release_cell(text: str) -> tuple[str, list[str]]:
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    if not lines:
        return "", []
    title = lines[0]
    genres = [ln for ln in lines[1:] if GENRE_PATTERN.match(ln)]
    return title, genres


def scrape_upcoming(months_ahead: int = 12) -> list[dict]:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    url = "https://www.boxofficemojo.com/calendar/"
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")
    table = soup.find("table")
    if not table:
        raise RuntimeError("Could not find calendar table on Box Office Mojo")

    cutoff = date.today() + timedelta(days=months_ahead * 31)
    releases: list[dict] = []
    current_date: date | None = None

    for row in table.find_all("tr"):
        header = row.find("th")
        if header:
            header_text = header.get_text(" ", strip=True)
            try:
                current_date = datetime.strptime(header_text, "%B %d, %Y").date()
            except ValueError:
                current_date = None
            continue

        cells = row.find_all("td")
        if len(cells) != 3 or current_date is None:
            continue
        if current_date > cutoff:
            continue

        title, genres = _parse_release_cell(cells[0].get_text("\n", strip=True))
        distributor = cells[1].get_text(" ", strip=True)
        scale = cells[2].get_text(" ", strip=True)
        if scale != "Wide" or not title:
            continue

        imdb_id = None
        for link in cells[0].find_all("a", href=True):
            match = re.search(r"tt\d+", link["href"])
            if match:
                imdb_id = match.group(0)
                break
        if not imdb_id:
            for link in row.find_all("a", href=True):
                match = re.search(r"tt\d+", link["href"])
                if match:
                    imdb_id = match.group(0)
                    break

        releases.append(
            {
                "title": title,
                "release_date": current_date.isoformat(),
                "opening_friday": _weekend_friday(current_date),
                "genres": genres,
                "distributor": distributor if distributor not in {"-", "–"} else None,
                "scale": scale,
                "imdb_id": imdb_id,
                "mpaa_rating": None,
            }
        )

    out = RAW_DIR / "upcoming.json"
    out.write_text(json.dumps(releases, indent=2))
    print(f"  calendar: {len(releases)} wide releases through ~{months_ahead} months")
    return releases
