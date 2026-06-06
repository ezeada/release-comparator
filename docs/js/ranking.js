/** Slate Setter ranking engine — client-side, runs on GitHub Pages. */

const FACTOR_LABELS = {
  market_strength: "Successful weekend",
  genre_strength: "In-genre historical strength",
  calendar_boost: "Calendar / holiday boost",
  crowding: "Low competition (wide releases)",
  audience_overlap: "Low audience overlap",
};

const FACTOR_DESCRIPTIONS = {
  market_strength: "How strong this calendar slot has been for total domestic gross over the last decade.",
  genre_strength: "How well your genre has performed in this same week-of-year historically.",
  calendar_boost: "Boost from holidays, 3-day weekends, Oscar season, and seasonal events.",
  crowding: "Fewer wide releases means more screens and attention available.",
  audience_overlap: "Lower overlap with same-genre and same-rating films currently in market.",
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
    const sharedGenres = (comp.genres || []).filter((g) => filmGenres.includes(g));
    const genreMatch = sharedGenres.length > 0 ? 1 : 0;
    const ratingMatch = comp.mpaa_rating && filmRating && comp.mpaa_rating === filmRating ? 1 : 0;
    const weekWeight = comp.is_new_release ? 1 : 0.65;
    overlap += (genreMatch * 0.75 + ratingMatch * 0.25) * weekWeight;
  }

  const normalized = clamp((overlap / competition.length) * 100);
  return invertForDisplay ? clamp(100 - normalized) : normalized;
}

function calendarBoostScore(events) {
  if (!events?.length) return 35;
  const boost = events.reduce((sum, e) => sum + (e.boost || 0), 0);
  return clamp(Math.round(Math.min(boost, 1) * 100));
}

function crowdingScore(competition) {
  const wideNew = competition.filter((c) => c.is_new_release).length;
  const holdovers = competition.filter((c) => !c.is_new_release).length;
  const load = wideNew * 1.2 + holdovers * 0.5;
  return clamp(Math.round(100 - load * 12));
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

export function rankWeekends(data, { genre, rating, title }) {
  const weights = data.config.weights;
  const historicalWeekends = data.historical_weekends || [];
  const historicalSlots = data.historical_slots || {};

  const ranked = (data.future_weekends || []).map((weekend) => {
    const competition = weekend.competition || [];
    const factors = {
      market_strength: marketStrengthScore(
        weekend.week_of_year,
        historicalWeekends,
        weekend.friday
      ),
      genre_strength: genreStrengthScore(genre, weekend.week_of_year, historicalSlots),
      calendar_boost: calendarBoostScore(weekend.events),
      crowding: crowdingScore(competition),
      audience_overlap: genreOverlapScore([genre], rating, competition, true),
    };

    let composite = 0;
    for (const [key, weight] of Object.entries(weights)) {
      composite += (factors[key] ?? 0) * weight;
    }
    composite = Math.round(composite);

    const overlapFilms = competition.filter((c) => {
      const genreHit = (c.genres || []).includes(genre);
      const ratingHit = c.mpaa_rating && rating && c.mpaa_rating === rating;
      return genreHit || ratingHit;
    });

    const slot = historicalSlots[String(weekend.week_of_year)] || {};
    const genreStat = slot.genre_stats?.[genre];

    const rationale = buildRationale({
      composite,
      factors,
      events: weekend.events,
      competition,
      overlapFilms,
      genreStat,
      slot,
    });

    return {
      friday: weekend.friday,
      week_of_year: weekend.week_of_year,
      composite,
      factors,
      events: weekend.events || [],
      competition,
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
}) {
  const parts = [];

  if (composite >= 75) parts.push("Strong overall release window.");
  else if (composite >= 55) parts.push("Solid window with some tradeoffs.");
  else parts.push("Challenging window — weigh competition carefully.");

  if (factors.calendar_boost >= 70 && events.length) {
    parts.push(`Calendar tailwind (${events.map((e) => e.name).join(", ")}).`);
  }

  if (factors.audience_overlap >= 70) {
    parts.push("Limited direct genre/rating overlap.");
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

export {
  FACTOR_LABELS,
  FACTOR_DESCRIPTIONS,
  formatFriday,
  formatMoney,
};
