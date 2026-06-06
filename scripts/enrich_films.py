"""Enrich film metadata (genres, MPAA) from Box Office Mojo title pages."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
CACHE_DIR = ROOT / "data" / "cache"

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
VALID_RATINGS = {"G", "PG", "PG-13", "R", "NC-17"}
REQUEST_DELAY = 0.4


def _slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def _search_imdb_id(title: str) -> str | None:
    url = "https://www.boxofficemojo.com/search/"
    resp = requests.get(url, params={"q": title}, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")
    for link in soup.select('a[href*="/title/"]'):
        href = link.get("href", "")
        match = re.search(r"(tt\d+)", href)
        if match:
            return match.group(1)
    return None


def _fetch_title_metadata(imdb_id: str) -> dict:
    url = f"https://www.boxofficemojo.com/title/{imdb_id}/"
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")

    genres: list[str] = []
    mpaa: str | None = None
    strings = list(soup.stripped_strings)
    for idx, text in enumerate(strings):
        if text == "Genres":
            j = idx + 1
            while j < len(strings) and GENRE_PATTERN.match(strings[j]):
                genres.append(strings[j])
                j += 1
        if text == "MPAA" and idx + 1 < len(strings):
            candidate = strings[idx + 1]
            if candidate in VALID_RATINGS:
                mpaa = candidate

    return {"genres": genres, "mpaa_rating": mpaa}


def enrich_films(max_titles: int | None = None, delay: float = REQUEST_DELAY) -> dict:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    meta_path = CACHE_DIR / "film_metadata.json"
    metadata: dict = json.loads(meta_path.read_text()) if meta_path.exists() else {}

    titles: set[str] = set()
    weekends_path = RAW_DIR / "weekends.json"
    if weekends_path.exists():
        raw = json.loads(weekends_path.read_text())
        titles.update(raw.get("films_seen", {}).keys())

    upcoming_path = RAW_DIR / "upcoming.json"
    upcoming_by_title: dict[str, dict] = {}
    if upcoming_path.exists():
        for item in json.loads(upcoming_path.read_text()):
            titles.add(item["title"])
            upcoming_by_title[item["title"]] = item

    pending = [t for t in sorted(titles) if t not in metadata]
    if max_titles:
        # Prioritize upcoming slate + recently charting titles
        recent_titles: set[str] = set()
        if weekends_path.exists():
            raw = json.loads(weekends_path.read_text())
            weekends = sorted(raw.get("weekends", []), key=lambda w: w["friday"], reverse=True)
            for w in weekends[:8]:
                for entry in w.get("entries", []):
                    recent_titles.add(entry["title"])

        priority = []
        for title in upcoming_by_title:
            if title in pending:
                priority.append(title)
        for title in sorted(recent_titles):
            if title in pending and title not in priority:
                priority.append(title)
        for title in pending:
            if title not in priority:
                priority.append(title)
        pending = priority[:max_titles]

    for i, title in enumerate(pending, start=1):
        imdb_id = upcoming_by_title.get(title, {}).get("imdb_id")
        if not imdb_id:
            imdb_id = _search_imdb_id(title)
            time.sleep(delay)

        genres: list[str] = upcoming_by_title.get(title, {}).get("genres", [])
        mpaa = upcoming_by_title.get(title, {}).get("mpaa_rating")

        if imdb_id:
            try:
                fetched = _fetch_title_metadata(imdb_id)
                genres = fetched["genres"] or genres
                mpaa = fetched["mpaa_rating"] or mpaa
            except Exception as exc:  # noqa: BLE001
                print(f"  metadata fail {title}: {exc}")
            time.sleep(delay)

        metadata[title] = {
            "title": title,
            "slug": _slug(title),
            "imdb_id": imdb_id,
            "genres": genres,
            "mpaa_rating": mpaa,
        }
        if i % 20 == 0:
            meta_path.write_text(json.dumps(metadata, indent=2))
            print(f"  enriched {i}/{len(pending)} films")

    meta_path.write_text(json.dumps(metadata, indent=2))
    print(f"  film metadata cache: {len(metadata)} titles")
    return metadata
