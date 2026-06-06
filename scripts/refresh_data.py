#!/usr/bin/env python3
"""Refresh Slate Setter cached datasets (run every ~3 weeks)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_processed import build_processed  # noqa: E402
from enrich_films import enrich_films  # noqa: E402
from scrape_calendar import scrape_upcoming  # noqa: E402
from scrape_weekends import scrape_weekends  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh Slate Setter data cache")
    parser.add_argument("--start-year", type=int, default=2015)
    parser.add_argument("--end-year", type=int, default=None)
    parser.add_argument("--quick", action="store_true", help="Only scrape last 3 years")
    parser.add_argument("--skip-weekends", action="store_true")
    parser.add_argument("--max-films", type=int, default=None, help="Cap metadata enrichment")
    args = parser.parse_args()

    start_year = args.start_year
    if args.quick:
        from datetime import datetime

        start_year = datetime.now().year - 3

    print("Slate Setter — data refresh")
    if not args.skip_weekends:
        print("[1/4] Scraping historical weekends…")
        scrape_weekends(start_year=start_year, end_year=args.end_year)
    else:
        print("[1/4] Skipping weekend scrape")

    print("[2/4] Scraping upcoming wide releases…")
    scrape_upcoming(months_ahead=12)

    print("[3/4] Enriching film metadata…")
    enrich_films(max_titles=args.max_films)

    print("[4/4] Building processed bundle…")
    build_processed()
    print("Done. Commit docs/data/slate_setter.json and push for GitHub Pages.")


if __name__ == "__main__":
    main()
