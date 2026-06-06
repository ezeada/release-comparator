"""US domestic calendar events that affect box office weekends (Fri–Sun)."""

from __future__ import annotations

import calendar
from datetime import date, timedelta


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """Return the nth weekday (0=Mon) of a month."""
    count = 0
    for day in range(1, calendar.monthrange(year, month)[1] + 1):
        if date(year, month, day).weekday() == weekday:
            count += 1
            if count == n:
                return date(year, month, day)
    raise ValueError(f"Could not find weekday {weekday} #{n} in {year}-{month}")


def _last_weekday(year: int, month: int, weekday: int) -> date:
    for day in range(calendar.monthrange(year, month)[1], 0, -1):
        if date(year, month, day).weekday() == weekday:
            return date(year, month, day)
    raise ValueError(f"Could not find last weekday {weekday} in {year}-{month}")


def _weekend_containing(d: date) -> date:
    """Friday of the Fri–Sun weekend containing date d."""
    return d - timedelta(days=(d.weekday() - 4) % 7)


def _easter(year: int) -> date:
    """Anonymous Gregorian algorithm."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def events_for_year(year: int) -> list[dict]:
    items: list[dict] = []

    def add(when: date, name: str, boost: float, kind: str) -> None:
        items.append(
            {
                "friday": _weekend_containing(when).isoformat(),
                "name": name,
                "boost": boost,
                "kind": kind,
            }
        )

    add(date(year, 2, 14), "Valentine's Day", 0.85, "holiday")
    add(_nth_weekday(year, 1, 0, 3), "MLK Day (3-day)", 0.55, "three_day")
    add(_nth_weekday(year, 2, 0, 3), "Presidents Day (3-day)", 0.6, "three_day")
    add(_last_weekday(year, 5, 0), "Memorial Day (3-day)", 0.95, "three_day")
    add(date(year, 7, 4), "Independence Day", 0.75, "holiday")
    add(_nth_weekday(year, 9, 0, 1), "Labor Day (3-day)", 0.9, "three_day")
    add(_nth_weekday(year, 11, 3, 4), "Thanksgiving (5-day)", 1.0, "holiday")
    add(date(year, 12, 25), "Christmas", 1.0, "holiday")
    add(date(year, 12, 31), "New Year's Eve", 0.7, "holiday")

    easter = _easter(year)
    add(easter - timedelta(days=1), "Easter weekend", 0.65, "holiday")

    # Oscar night ~ early March; treat that Fri–Sun as Oscar season peak
    oscar_sunday = _nth_weekday(year, 3, 6, 2)  # 2nd Sunday in March (approx)
    add(oscar_sunday, "Oscar weekend", 0.5, "oscar")

    # Halloween
    add(date(year, 10, 31), "Halloween", 0.8, "holiday")

    return items


def build_holiday_index(start_year: int, end_year: int) -> dict[str, list[dict]]:
    by_friday: dict[str, list[dict]] = {}
    for year in range(start_year, end_year + 1):
        for event in events_for_year(year):
            by_friday.setdefault(event["friday"], []).append(
                {k: v for k, v in event.items() if k != "friday"}
            )
    return by_friday
