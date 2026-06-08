"""Scrape upcoming wide releases from Box Office Mojo calendar."""

from __future__ import annotations

import json
import re
import time
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

REQUEST_DELAY = 0.3


def _weekend_friday(release_day: date) -> str:
    """Map release date to the Fri–Sun weekend it opens in."""
    weekday = release_day.weekday()
    if weekday == 4:  # Fri
        return release_day.isoformat()
    if weekday == 5:  # Sat
        return (release_day - timedelta(days=1)).isoformat()
    if weekday == 6:  # Sun
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


def _month_start_dates(start: date, months: int) -> list[date]:
    """First day of each month from start month through `months` total."""
    dates: list[date] = []
    year, month = start.year, start.month
    for _ in range(months):
        dates.append(date(year, month, 1))
        month += 1
        if month > 12:
            month = 1
            year += 1
    return dates


def _calendar_url(month_start: date) -> str:
    return f"https://www.boxofficemojo.com/calendar/{month_start.year}-{month_start.month:02d}-01/"


def _extract_imdb_id(row) -> str | None:
    for link in row.find_all("a", href=True):
        match = re.search(r"(tt\d+)", link["href"])
        if match:
            return match.group(1)
    return None


def _parse_calendar_page(soup: BeautifulSoup, cutoff: date) -> list[dict]:
    table = soup.find("table")
    if not table:
        return []

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
        if current_date > cutoff or current_date < date.today() - timedelta(days=7):
            continue

        title, genres = _parse_release_cell(cells[0].get_text("\n", strip=True))
        distributor = cells[1].get_text(" ", strip=True)
        scale = cells[2].get_text(" ", strip=True)
        if scale != "Wide" or not title:
            continue

        imdb_id = _extract_imdb_id(row)

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
    return releases


def scrape_upcoming(months_ahead: int = 12) -> list[dict]:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    today = date.today()
    cutoff = today + timedelta(days=months_ahead * 31)
    month_dates = _month_start_dates(today.replace(day=1), months_ahead + 1)

    seen: set[tuple[str, str]] = set()
    releases: list[dict] = []

    for month_start in month_dates:
        url = _calendar_url(month_start)
        try:
            resp = requests.get(url, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            page_releases = _parse_calendar_page(BeautifulSoup(resp.text, "lxml"), cutoff)
            added = 0
            for item in page_releases:
                key = (item["title"], item["release_date"])
                if key in seen:
                    continue
                seen.add(key)
                releases.append(item)
                added += 1
            print(f"  calendar {month_start.strftime('%Y-%m')}: +{added} wide (total {len(releases)})")
        except Exception as exc:  # noqa: BLE001
            print(f"  calendar {month_start.strftime('%Y-%m')}: skip ({exc})")
        time.sleep(REQUEST_DELAY)

    releases.sort(key=lambda item: item["release_date"])
    out = RAW_DIR / "upcoming.json"
    out.write_text(json.dumps(releases, indent=2))
    print(f"  calendar: {len(releases)} wide releases through ~{months_ahead} months")
    return releases
