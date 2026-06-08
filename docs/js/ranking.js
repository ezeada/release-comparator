/** Slate Setter ranking engine — client-side, runs on GitHub Pages. */

const FACTOR_LABELS = {
  market_strength: "Successful weekend",
  genre_strength: "In-genre historical strength",
  calendar_boost: "Calendar / holiday boost",
  crowding: "Competition (wide releases)",
  audience_overlap: "Low audience overlap",
};

const FACTOR_DESCRIPTIONS = {
  market_strength: "How strong this calendar slot has been for total domestic gross over the last decade.",
  genre_strength: "How well your genre has performed in this same week-of-year historically.",
  calendar_boost: "Boost from holidays, 3-day weekends, Oscar season, and seasonal events.",
  crowding: "Fewer wide releases means more screens and attention available.",
  audience_overlap: "Lower overlap with films sharing both your genre and MPAA rating in market.",
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function percentileRank(value, samples) {
  if (!samples.length) return 50;
  const sorted = [...samples].sort((a, b) => a - b);
  let below = 0;
  for (const s of sorted) {
    if (s < value) below += 1;
  }
  return clamp(Math.round((below / sorted.length) * 100));
}

function genreOverlapScore(filmGenres, filmRating, competition, invertForDisplay = false) {
  if (!competition.length) return invertForDisplay ? 100 : 0;

  let overlap = 0;
  for (const comp of competition) {
    const genreMatch = (comp.genres || []).some((g) => filmGenres.includes(g));
    const ratingMatch = comp.mpaa_rating && filmRating && comp.mpaa_rating === filmRating;
    if (!genreMatch || !ratingMatch) continue;

    const weekWeight = comp.is_new_release ? 1 : 0.65;
    overlap += weekWeight;
  }

  const normalized = clamp(Math.round((overlap / competition.length) * 100));
  return invertForDisplay ? clamp(100 - normalized) : normalized;
}

function calendarBoostScore(events) {
  return events?.length ? 100 : 0;
}

function crowdingScore(competition, historicalSlot, usingHistoricalFallback) {
  if (competition.length) {
    const wideNew = competition.filter((c) => c.is_new_release).length;
    const holdovers = competition.filter((c) => !c.is_new_release).length;
    const load = wideNew * 1.2 + holdovers * 0.5;
    return clamp(Math.round(100 - load * 12));
  }
  const typical = historicalSlot?.median_wide_count ?? 0;
  if (typical) {
    return clamp(Math.round(100 - typical * 12));
  }
  return usingHistoricalFallback ? 55 : 70;
}

function marketStrengthScore(weekOfYear, historicalWeekends, friday) {
  const samples = historicalWeekends
    .filter((w) => w.week_of_year === weekOfYear)
    .map((w) => w.total_gross);

  if (!samples.length) return 50;

  const slotMedian = samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  const allMedians = Object.values(
    historicalWeekends.reduce((acc, w) => {
      acc[w.week_of_year] = acc[w.week_of_year] || [];
      acc[w.week_of_year].push(w.total_gross);
      return acc;
    }, {})
  ).map((arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)]);

  return percentileRank(slotMedian, allMedians);
}

function genreStrengthScore(genre, weekOfYear, historicalSlots) {
  const slot = historicalSlots[String(weekOfYear)];
  if (!slot?.genre_stats?.[genre]) return 50;

  const genreMedians = Object.values(slot.genre_stats).map((g) => g.median_gross);
  const mine = slot.genre_stats[genre].median_gross;
  return percentileRank(mine, genreMedians.length ? genreMedians : [mine]);
}

function formatFriday(friday) {
  const d = new Date(friday + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatMoney(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

const WEIGHT_KEYS = [
  "market_strength",
  "genre_strength",
  "calendar_boost",
  "crowding",
  "audience_overlap",
];

function yearFromFriday(friday) {
  return parseInt(friday.slice(0, 4), 10);
}

function weeksBetween(openFriday, targetFriday) {
  const open = new Date(openFriday + "T12:00:00");
  const target = new Date(targetFriday + "T12:00:00");
  return Math.round((target - open) / (7 * 24 * 60 * 60 * 1000));
}

function normalizeWeights(weights) {
  const total = WEIGHT_KEYS.reduce((sum, key) => sum + (weights[key] ?? 0), 0);
  if (!total) return { ...weights };
  const normalized = {};
  for (const key of WEIGHT_KEYS) {
    normalized[key] = (weights[key] ?? 0) / total;
  }
  return normalized;
}

export function defaultScoringParams(data) {
  const years = data.metadata.years_covered || [];
  return {
    weights: { ...data.config.weights },
    holdoverWeeks: data.metadata.holdover_weeks_assumption ?? 5,
    wideThreshold: data.metadata.wide_theater_threshold ?? 600,
    historyYearMin: years[0] ?? 2015,
    historyYearMax: years.at(-1) ?? new Date().getFullYear(),
  };
}

function filterByHistoryYear(items, params, { yearField = "year", dateField = "friday" } = {}) {
  return items.filter((item) => {
    const year = item[yearField] ?? yearFromFriday(item[dateField]);
    return year >= params.historyYearMin && year <= params.historyYearMax;
  });
}

function buildHistoricalSlots(historicalWeekends, wideOpeners) {
  const slotTotals = {};
  const slotWideCounts = {};
  const slotGenreGross = {};

  for (const weekend of historicalWeekends) {
    const woy = weekend.week_of_year;
    slotTotals[woy] = slotTotals[woy] || [];
    slotTotals[woy].push(weekend.total_gross);
    slotWideCounts[woy] = slotWideCounts[woy] || [];
    slotWideCounts[woy].push(weekend.wide_release_count);
  }

  for (const entry of wideOpeners) {
    const woy = entry.week_of_year;
    for (const genre of entry.genres || []) {
      slotGenreGross[woy] = slotGenreGross[woy] || {};
      slotGenreGross[woy][genre] = slotGenreGross[woy][genre] || [];
      slotGenreGross[woy][genre].push(entry.gross);
    }
  }

  const slots = {};
  for (const [woy, totals] of Object.entries(slotTotals)) {
    const totalsSorted = [...totals].sort((a, b) => a - b);
    const median = totalsSorted[Math.floor(totalsSorted.length / 2)];
    const genreStats = {};
    for (const [genre, grosses] of Object.entries(slotGenreGross[woy] || {})) {
      const gSorted = [...grosses].sort((a, b) => a - b);
      genreStats[genre] = {
        median_gross: gSorted[Math.floor(gSorted.length / 2)],
        sample_size: grosses.length,
      };
    }
    const wideCounts = [...(slotWideCounts[woy] || [])].sort((a, b) => a - b);
    slots[woy] = {
      median_total_gross: median,
      median_wide_count: wideCounts.length ? wideCounts[Math.floor(wideCounts.length / 2)] : 0,
      sample_weekends: totals.length,
      genre_stats: genreStats,
    };
  }
  return slots;
}

function resolvePosterUrl(film, posterLookup = {}) {
  return film.poster_url || posterLookup[film.imdb_id] || posterLookup[film.title] || null;
}

function filmPayload(film, extra = {}, posterLookup = {}) {
  return {
    title: film.title,
    genres: film.genres || [],
    mpaa_rating: film.mpaa_rating,
    imdb_id: film.imdb_id,
    poster_url: resolvePosterUrl(film, posterLookup),
    ...extra,
  };
}

function activeFilmsForWeekend(friday, scheduled, holdovers, holdoverWeeks, posterLookup = {}) {
  const active = [];

  for (const film of holdovers || []) {
    const weeksOut = weeksBetween(film.opening_friday, friday);
    if (weeksOut >= 0 && weeksOut < holdoverWeeks) {
      active.push(
        filmPayload(
          film,
          {
            week_in_release: weeksOut + 1,
            source: "current_holdover",
            is_new_release: weeksOut === 0,
            holdover_estimated: friday > film.anchor_friday,
          },
          posterLookup
        )
      );
    }
  }

  for (const film of scheduled || []) {
    const weeksOut = weeksBetween(film.opening_friday, friday);
    if (weeksOut >= 0 && weeksOut < holdoverWeeks) {
      active.push(
        filmPayload(
          film,
          {
            week_in_release: weeksOut + 1,
            source: "scheduled",
            is_new_release: weeksOut === 0,
            holdover_estimated: weeksOut > 0,
          },
          posterLookup
        )
      );
    }
  }

  return active;
}

function historicalAnalogCompetition(weekOfYear, wideOpeners, posterLookup = {}) {
  const seen = new Set();
  const analogs = [];

  const sorted = [...wideOpeners].sort((a, b) => b.year - a.year);
  for (const entry of sorted) {
    if (entry.week_of_year !== weekOfYear) continue;
    if (seen.has(entry.title)) continue;
    seen.add(entry.title);
    analogs.push(
      filmPayload(
        entry,
        {
          week_in_release: 1,
          source: "historical_analog",
          is_new_release: true,
          holdover_estimated: false,
          analog_year: entry.year,
          analog_gross: entry.gross,
        },
        posterLookup
      )
    );
    if (analogs.length >= 8) break;
  }

  analogs.sort((a, b) => (b.analog_gross || 0) - (a.analog_gross || 0));
  return analogs.slice(0, 8);
}

function hasScoringSources(data) {
  return Array.isArray(data.historical_wide_openers) && data.historical_wide_openers.length > 0;
}

function prepareScoringData(data, scoringParams) {
  const params = scoringParams;
  const filteredWeekends = filterByHistoryYear(data.historical_weekends || [], params);

  if (!hasScoringSources(data)) {
    return {
      historicalWeekends: filteredWeekends,
      historicalSlots: data.historical_slots || {},
      futureWeekends: data.future_weekends || [],
      weights: normalizeWeights(params.weights),
    };
  }

  const filteredOpeners = filterByHistoryYear(data.historical_wide_openers || [], params).filter(
    (entry) => (entry.theaters || 0) >= params.wideThreshold
  );
  const historicalSlots = buildHistoricalSlots(filteredWeekends, filteredOpeners);
  const scheduled = data.scheduled_releases || [];
  const holdovers = data.current_holdovers || [];
  const posterLookup = data.poster_lookup || {};

  const futureWeekends = (data.future_weekends || []).map((weekend) => {
    const scheduledCompetition = activeFilmsForWeekend(
      weekend.friday,
      scheduled,
      holdovers,
      params.holdoverWeeks,
      posterLookup
    );
    const historicalCompetition = historicalAnalogCompetition(
      weekend.week_of_year,
      filteredOpeners,
      posterLookup
    );
    return {
      ...weekend,
      competition: scheduledCompetition,
      historical_competition: historicalCompetition,
      competition_is_estimated: scheduledCompetition.length === 0,
    };
  });

  return {
    historicalWeekends: filteredWeekends,
    historicalSlots,
    futureWeekends,
    weights: normalizeWeights(params.weights),
  };
}

export function rankWeekends(data, { genre, rating, title }, scoringParams = null) {
  const params = scoringParams || defaultScoringParams(data);
  const prepared = prepareScoringData(data, params);
  const weights = prepared.weights;
  const historicalWeekends = prepared.historicalWeekends;
  const historicalSlots = prepared.historicalSlots;

  const ranked = prepared.futureWeekends.map((weekend) => {
    const scheduledCompetition = weekend.competition || [];
    const historicalCompetition = weekend.historical_competition || [];
    const allCompetition = [...scheduledCompetition, ...historicalCompetition];
    const competition =
      scheduledCompetition.length > 0 ? scheduledCompetition : historicalCompetition;
    const usingHistoricalFallback =
      scheduledCompetition.length === 0 && historicalCompetition.length > 0;
    const slot = historicalSlots[String(weekend.week_of_year)] || {};

    const factors = {
      market_strength: Math.round(
        marketStrengthScore(weekend.week_of_year, historicalWeekends, weekend.friday)
      ),
      genre_strength: Math.round(genreStrengthScore(genre, weekend.week_of_year, historicalSlots)),
      calendar_boost: calendarBoostScore(weekend.events),
      crowding: Math.round(crowdingScore(competition, slot, usingHistoricalFallback)),
      audience_overlap: Math.round(genreOverlapScore([genre], rating, competition, true)),
    };

    let composite = 0;
    for (const [key, weight] of Object.entries(weights)) {
      composite += (factors[key] ?? 0) * weight;
    }
    composite = Math.round(composite);

    const overlapFilms = allCompetition.filter((c) => {
      const genreHit = (c.genres || []).includes(genre);
      const ratingHit = c.mpaa_rating && rating && c.mpaa_rating === rating;
      return genreHit && ratingHit;
    });

    const genreStat = slot.genre_stats?.[genre];

    const rationale = buildRationale({
      composite,
      factors,
      events: weekend.events,
      competition,
      overlapFilms,
      genreStat,
      slot,
      usingHistoricalFallback,
      scheduledCount: scheduledCompetition.length,
    });

    return {
      friday: weekend.friday,
      week_of_year: weekend.week_of_year,
      composite,
      factors,
      events: weekend.events || [],
      competition: scheduledCompetition,
      historicalCompetition,
      usingHistoricalFallback,
      overlapFilms,
      historicalAnalog: {
        medianMarket: slot.median_total_gross,
        sampleWeekends: slot.sample_weekends,
        genreMedian: genreStat?.median_gross,
        genreSamples: genreStat?.sample_size,
      },
      rationale,
      title,
      genre,
      rating,
    };
  });

  ranked.sort((a, b) => b.composite - a.composite);
  return ranked;
}

function buildRationale({
  composite,
  factors,
  events,
  competition,
  overlapFilms,
  genreStat,
  slot,
  usingHistoricalFallback,
  scheduledCount,
}) {
  const parts = [];

  if (composite >= 75) parts.push("Strong overall release window.");
  else if (composite >= 55) parts.push("Solid window with some tradeoffs.");
  else parts.push("Challenging window — weigh competition carefully.");

  if (usingHistoricalFallback) {
    parts.push(
      "No scheduled wide releases yet — showing historical analog titles for this calendar slot."
    );
  } else if (scheduledCount === 0) {
    parts.push("Release schedule data is sparse for this weekend.");
  }

  if (factors.calendar_boost >= 100 && events.length) {
    parts.push("Calendar holiday boost applies to this weekend.");
  }

  if (factors.audience_overlap >= 70) {
    parts.push("Limited direct genre-and-rating overlap.");
  } else if (overlapFilms.length) {
    parts.push(
      `Audience overlap with ${overlapFilms.slice(0, 2).map((f) => f.title).join(", ")}${overlapFilms.length > 2 ? "…" : ""}.`
    );
  }

  if (factors.crowding < 40 && competition.length >= 4) {
    parts.push("Crowded weekend — multiple wide releases.");
  }

  if (slot.median_total_gross) {
    parts.push(`Historically ~${formatMoney(slot.median_total_gross)} total domestic market.`);
  }

  if (genreStat?.median_gross) {
    parts.push(
      `${genreStat.sample_size} prior wide ${genreStat.sample_size === 1 ? "title" : "titles"} in this slot averaged ~${formatMoney(genreStat.median_gross)} opening-level gross in-chart.`
    );
  }

  return parts.join(" ");
}

export function getWeekendFridays(data) {
  return [...new Set((data.future_weekends || []).map((w) => w.friday))].sort();
}

function crowdingFactorLabel(score) {
  if (score >= 75) return "Low competition (wide releases)";
  if (score >= 50) return "Moderate competition (wide releases)";
  return "High competition (wide releases)";
}

export function factorDisplayLabel(key, value) {
  if (key === "crowding") return crowdingFactorLabel(value);
  return FACTOR_LABELS[key];
}

export {
  FACTOR_LABELS,
  FACTOR_DESCRIPTIONS,
  formatFriday,
  formatMoney,
  WEIGHT_KEYS,
  normalizeWeights,
};
