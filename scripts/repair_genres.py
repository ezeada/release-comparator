#!/usr/bin/env python3
"""Re-fetch genres for cached titles where BOM layout was misparsed."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from enrich_films import _fetch_title_metadata, collect_analog_titles  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
META_PATH = ROOT / "data" / "cache" / "film_metadata.json"


def main() -> None:
    metadata = json.loads(META_PATH.read_text())
    targets = [
        t
        for t in collect_analog_titles()
        if t in metadata and metadata[t].get("imdb_id") and not metadata[t].get("genres")
    ]
    print(f"repairing genres for {len(targets)} titles")
    for i, title in enumerate(targets, start=1):
        imdb_id = metadata[title]["imdb_id"]
        try:
            fetched = _fetch_title_metadata(imdb_id)
            if fetched["genres"]:
                metadata[title]["genres"] = fetched["genres"]
                metadata[title]["mpaa_rating"] = fetched["mpaa_rating"] or metadata[title].get("mpaa_rating")
                metadata[title]["poster_url"] = fetched.get("poster_url") or metadata[title].get("poster_url")
        except Exception as exc:  # noqa: BLE001
            print(f"  fail {title}: {exc}")
        if i % 25 == 0:
            META_PATH.write_text(json.dumps(metadata, indent=2))
            print(f"  repaired {i}/{len(targets)}")
        time.sleep(0.2)
    META_PATH.write_text(json.dumps(metadata, indent=2))
    print("done")


if __name__ == "__main__":
    main()
