import {
  rankWeekends,
  FACTOR_LABELS,
  FACTOR_DESCRIPTIONS,
  factorDisplayLabel,
  formatFriday,
  formatMoney,
  WEIGHT_KEYS,
  defaultScoringParams,
  normalizeWeights,
  getWeekendFridays,
} from "./ranking.js";

let data = null;
let rankings = [];
let allRankings = [];
let weekendFridays = [];
let rankDateRange = { start: null, end: null };
let expandedFriday = null;
let compareSlots = [null, null];
let scoringParams = null;
let hasRanked = false;

const els = {
  genre: document.getElementById("film-genre"),
  rating: document.getElementById("film-rating"),
  title: document.getElementById("film-title"),
  rankBtn: document.getElementById("rank-btn"),
  rankedList: document.getElementById("ranked-list"),
  resultsSummary: document.getElementById("results-summary"),
  paramsBtn: document.getElementById("params-btn"),
  paramsPanel: document.getElementById("params-panel"),
  weightSliders: document.getElementById("weight-sliders"),
  paramsReset: document.getElementById("params-reset"),
  holdoverSlider: document.getElementById("param-holdover"),
  wideSlider: document.getElementById("param-wide"),
  historyYearMin: document.getElementById("param-history-min"),
  historyYearMax: document.getElementById("param-history-max"),
  holdoverOut: document.getElementById("holdover-out"),
  wideOut: document.getElementById("wide-out"),
  compareMode: document.getElementById("compare-mode"),
  comparePanel: document.getElementById("compare-panel"),
  compareColumns: document.getElementById("compare-columns"),
  compareDateA: document.getElementById("compare-date-a"),
  compareDateB: document.getElementById("compare-date-b"),
  detailPanel: document.getElementById("detail-panel"),
  rankingsSplit: document.getElementById("rankings-split"),
  rangeDateStart: document.getElementById("range-date-start"),
  rangeDateEnd: document.getElementById("range-date-end"),
  rankRangePanel: document.getElementById("rank-range-panel"),
};

function nearestRankedFriday(isoDate) {
  if (!rankings.length) return null;
  const target = new Date(isoDate + "T12:00:00").getTime();
  return rankings.reduce((best, row) => {
    const bestDiff = Math.abs(new Date(best.friday + "T12:00:00").getTime() - target);
    const nextDiff = Math.abs(new Date(row.friday + "T12:00:00").getTime() - target);
    return nextDiff < bestDiff ? row : best;
  }, rankings[0]).friday;
}

function competitorCount(row) {
  return row.competition.length || row.historicalCompetition?.length || 0;
}

async function loadData() {
  const resp = await fetch("data/slate_setter.json");
  if (!resp.ok) throw new Error("Could not load dataset");
  data = await resp.json();
  scoringParams = defaultScoringParams(data);
  populateFormOptions();
  initParamsPanel();
  initDateRange();
  renderRankedList();
}

function populateFormOptions() {
  const genrePlaceholder = document.createElement("option");
  genrePlaceholder.value = "";
  genrePlaceholder.textContent = "Select genre";
  genrePlaceholder.disabled = true;
  genrePlaceholder.selected = true;
  els.genre.appendChild(genrePlaceholder);

  for (const genre of data.config.genres) {
    const opt = document.createElement("option");
    opt.value = genre;
    opt.textContent = genre;
    els.genre.appendChild(opt);
  }

  const ratingPlaceholder = document.createElement("option");
  ratingPlaceholder.value = "";
  ratingPlaceholder.textContent = "Select rating";
  ratingPlaceholder.disabled = true;
  ratingPlaceholder.selected = true;
  els.rating.appendChild(ratingPlaceholder);

  for (const rating of data.config.ratings) {
    const opt = document.createElement("option");
    opt.value = rating;
    opt.textContent = rating;
    els.rating.appendChild(opt);
  }
}

function readScoringParamsFromUI() {
  const weights = {};
  for (const key of WEIGHT_KEYS) {
    const input = document.getElementById(`weight-${key}`);
    weights[key] = input ? Number(input.value) / 100 : scoringParams.weights[key];
  }

  let historyMin = Number(els.historyYearMin.value);
  let historyMax = Number(els.historyYearMax.value);
  if (historyMin > historyMax) [historyMin, historyMax] = [historyMax, historyMin];

  return {
    weights: normalizeWeights(weights),
    holdoverWeeks: Number(els.holdoverSlider.value),
    wideThreshold: Number(els.wideSlider.value),
    historyYearMin: historyMin,
    historyYearMax: historyMax,
  };
}

function syncParamOutputs() {
  els.holdoverOut.textContent = els.holdoverSlider.value;
  els.wideOut.textContent = els.wideSlider.value;

  for (const key of WEIGHT_KEYS) {
    const input = document.getElementById(`weight-${key}`);
    const out = document.getElementById(`weight-out-${key}`);
    if (input && out) out.textContent = `${input.value}%`;
  }
}

function applyScoringParamsToUI(params) {
  scoringParams = params;
  for (const key of WEIGHT_KEYS) {
    const input = document.getElementById(`weight-${key}`);
    if (input) input.value = Math.round((params.weights[key] ?? 0) * 100);
  }
  els.holdoverSlider.value = params.holdoverWeeks;
  els.wideSlider.value = params.wideThreshold;
  els.historyYearMin.value = String(params.historyYearMin);
  els.historyYearMax.value = String(params.historyYearMax);
  syncParamOutputs();
}

function rebalanceWeights(changedKey, newValue) {
  const others = WEIGHT_KEYS.filter((key) => key !== changedKey);
  const otherSum = others.reduce((sum, key) => {
    const input = document.getElementById(`weight-${key}`);
    return sum + Number(input?.value || 0);
  }, 0);
  const remaining = Math.max(0, 100 - newValue);

  if (otherSum <= 0) {
    const even = Math.floor(remaining / others.length);
    others.forEach((key, idx) => {
      const input = document.getElementById(`weight-${key}`);
      if (input) input.value = idx === others.length - 1 ? remaining - even * (others.length - 1) : even;
    });
    return;
  }

  let allocated = 0;
  others.forEach((key, idx) => {
    const input = document.getElementById(`weight-${key}`);
    if (!input) return;
    if (idx === others.length - 1) {
      input.value = Math.max(0, remaining - allocated);
      return;
    }
    const next = Math.round((Number(input.value) / otherSum) * remaining);
    input.value = next;
    allocated += next;
  });
}

function initParamsPanel() {
  const meta = data.metadata;
  const years = meta.years_covered || [];
  const yearMin = years[0] ?? 2015;
  const yearMax = years.at(-1) ?? new Date().getFullYear();
  const yearOptions = [];

  for (let year = yearMin; year <= yearMax; year += 1) {
    yearOptions.push(`<option value="${year}">${year}</option>`);
  }

  els.historyYearMin.innerHTML = yearOptions.join("");
  els.historyYearMax.innerHTML = yearOptions.join("");

  els.weightSliders.innerHTML = WEIGHT_KEYS.map(
    (key) => `
    <label class="param-slider">
      <span class="param-slider-label">${FACTOR_LABELS[key]} <output id="weight-out-${key}">0%</output></span>
      <input type="range" id="weight-${key}" min="0" max="100" step="1" value="0" data-weight-key="${key}" />
    </label>`
  ).join("");

  applyScoringParamsToUI(defaultScoringParams(data));

  document.getElementById("param-refreshed").textContent = new Date(
    meta.generated_at
  ).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  document.getElementById("param-quality").textContent =
    `${meta.data_quality.films_with_genre_pct}% genre · ${meta.data_quality.films_with_rating_pct}% rating · ${meta.data_quality.scheduled_with_genre_pct}% upcoming genre coverage`;
}

function onHistoryYearChanged() {
  let historyMin = Number(els.historyYearMin.value);
  let historyMax = Number(els.historyYearMax.value);
  if (historyMin > historyMax) {
    if (document.activeElement === els.historyYearMin) {
      els.historyYearMax.value = String(historyMin);
    } else {
      els.historyYearMin.value = String(historyMax);
    }
  }
  onParamsChanged();
}

function onParamsChanged() {
  syncParamOutputs();
  scoringParams = readScoringParamsFromUI();
  if (hasRanked) runRanking({ preserveSelection: true });
}

function scoreClass(score) {
  if (score >= 70) return "high";
  if (score >= 45) return "mid";
  return "low";
}

function factorRingColor(value) {
  if (value >= 75) return "#22c55e";
  if (value >= 50) return "#f97316";
  return "#ef4444";
}

function formatDateRange(rows) {
  if (!rows.length) return "—";
  const sorted = [...rows].map((r) => r.friday).sort();
  const start = formatFriday(sorted[0]);
  const end = formatFriday(sorted[sorted.length - 1]);
  return `${start} – ${end}`;
}

function defaultRankDateRange() {
  const today = new Date().toISOString().slice(0, 10);
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const endCap = nextYear.toISOString().slice(0, 10);
  const start = weekendFridays.find((f) => f >= today) || weekendFridays[0];
  const end =
    [...weekendFridays].reverse().find((f) => f <= endCap) || weekendFridays.at(-1);
  return { start, end: end >= start ? end : start };
}

function syncDateRangeUI() {
  if (!weekendFridays.length) return;

  if (rankDateRange.start && rankDateRange.end && rankDateRange.start > rankDateRange.end) {
    rankDateRange.end = rankDateRange.start;
  }

  if (rankDateRange.start) {
    rankDateRange.start = nearestWeekendFriday(rankDateRange.start);
  }
  if (rankDateRange.end) {
    rankDateRange.end = nearestWeekendFriday(rankDateRange.end);
  }
  if (rankDateRange.start && rankDateRange.end && rankDateRange.start > rankDateRange.end) {
    rankDateRange.end = rankDateRange.start;
  }

  els.rangeDateStart.min = weekendFridays[0];
  els.rangeDateStart.max = weekendFridays.at(-1);
  els.rangeDateEnd.min = weekendFridays[0];
  els.rangeDateEnd.max = weekendFridays.at(-1);
  els.rangeDateStart.value = rankDateRange.start || "";
  els.rangeDateEnd.value = rankDateRange.end || "";
}

function initDateRange() {
  weekendFridays = getWeekendFridays(data);
  rankDateRange = { start: null, end: null };
}

function nearestWeekendFriday(isoDate) {
  const target = new Date(isoDate + "T12:00:00").getTime();
  return weekendFridays.reduce((best, friday) => {
    const bestDiff = Math.abs(new Date(best + "T12:00:00").getTime() - target);
    const nextDiff = Math.abs(new Date(friday + "T12:00:00").getTime() - target);
    return nextDiff < bestDiff ? friday : best;
  }, weekendFridays[0]);
}

function applyDateRangeFilter() {
  if (!allRankings.length) {
    rankings = [];
    return;
  }
  if (!rankDateRange.start || !rankDateRange.end) {
    rankings = [...allRankings];
    return;
  }
  rankings = allRankings.filter(
    (row) => row.friday >= rankDateRange.start && row.friday <= rankDateRange.end
  );
}

function onDateRangeChanged() {
  if (!hasRanked) return;

  if (els.rangeDateStart.value) {
    rankDateRange.start = nearestWeekendFriday(els.rangeDateStart.value);
  }
  if (els.rangeDateEnd.value) {
    rankDateRange.end = nearestWeekendFriday(els.rangeDateEnd.value);
  }
  syncDateRangeUI();
  applyDateRangeFilter();
  if (!rankings.some((r) => r.friday === expandedFriday)) expandedFriday = null;
  compareSlots = compareSlots.map((f) =>
    f && rankings.some((r) => r.friday === f) ? f : null
  );
  els.resultsSummary.textContent = formatDateRange(rankings);
  renderRankedList();
  renderCompare();
}

function buildFactorDetail(key, row) {
  const analog = row.historicalAnalog || {};
  let body = FACTOR_DESCRIPTIONS[key];

  switch (key) {
    case "market_strength":
      if (analog.medianMarket) {
        body = `Week ${row.week_of_year} historically averages ${formatMoney(analog.medianMarket)} in total domestic gross. The ${row.factors.market_strength} score is a percentile rank versus all 52 weeks-of-year — e.g. 88 means this slot beats ~88% of calendar weeks on total market size.`;
      }
      break;
    case "genre_strength":
      if (analog.genreMedian) {
        body = `${row.genre} wide releases in this week-of-year slot posted a median in-chart gross of ${formatMoney(analog.genreMedian)}. The ${row.factors.genre_strength} score is that genre's percentile rank within this same calendar slot.`;
      } else {
        body = `Limited historical ${row.genre} wide-release data for week ${row.week_of_year}. Score defaults toward neutral.`;
      }
      break;
    case "calendar_boost":
      body = row.events?.length
        ? "This Fri–Sun window falls on a flagged calendar event. Holiday boost: yes (100)."
        : "No major holidays or industry calendar events flagged for this weekend. Holiday boost: no (0).";
      break;
    case "crowding": {
      const count = competitorCount(row);
      const newCount = row.competition.filter((c) => c.is_new_release).length;
      body =
        count === 0
          ? "No wide releases currently scheduled; estimate uses historical slot crowding."
          : `${count} wide release${count === 1 ? "" : "s"} projected in market (${newCount} new wide opener${newCount === 1 ? "" : "s"}).`;
      break;
    }
    case "audience_overlap":
      if (row.overlapFilms.length) {
        body = `${row.overlapFilms.length} active wide release${row.overlapFilms.length === 1 ? "" : "s"} share your genre (${row.genre}) and rating (${row.rating}).`;
      } else {
        body = `No projected wide competition shares both your genre (${row.genre}) and rating (${row.rating}).`;
      }
      break;
    default:
      break;
  }

  return `<p>${body}</p>`;
}

function badgeTint(score) {
  if (score >= 75) return "badge-good";
  if (score >= 50) return "badge-mid";
  return "badge-bad";
}

function wideReleaseBadgeTint(count) {
  if (count <= 3) return "badge-good";
  if (count <= 5) return "badge-mid";
  return "badge-bad";
}

function renderRowBadges(row) {
  const badges = [];
  const push = (label, score) => {
    badges.push(`<span class="badge ${badgeTint(score)}">${label}</span>`);
  };

  if (row.events.length) {
    push("Holiday", row.factors.calendar_boost);
  }

  if (row.historicalAnalog?.medianMarket) {
    push(`~${formatMoney(row.historicalAnalog.medianMarket)} avg market`, row.factors.market_strength);
  }

  if (row.historicalAnalog?.genreMedian) {
    push(`~${formatMoney(row.historicalAnalog.genreMedian)} genre market`, row.factors.genre_strength);
  }

  if (row.usingHistoricalFallback || !row.competition.length) {
    push("Unconfirmed schedule", row.usingHistoricalFallback ? 40 : 45);
  }

  const count = competitorCount(row);
  badges.push(
    `<span class="badge ${wideReleaseBadgeTint(count)}">${count} wide release${count === 1 ? "" : "s"}</span>`
  );

  const overlapCount = row.overlapFilms.length;
  push(
    `${overlapCount} overlapping title${overlapCount === 1 ? "" : "s"}`,
    row.factors.audience_overlap
  );

  return badges.join("");
}

function renderScoreGauge(score, dateLabel, { winner = false } = {}) {
  const arc = Math.PI * 76;
  const filled = (score / 100) * arc;

  return `
    <div class="score-panel">
      <div class="score-panel-head">
      <div class="gauge-wrap">
        <svg viewBox="0 0 200 110" class="main-gauge" aria-hidden="true">
          <path class="gauge-track" d="M 24 100 A 76 76 0 0 1 176 100" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round"/>
          <path class="gauge-fill" d="M 24 100 A 76 76 0 0 1 176 100" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round"
            stroke-dasharray="${arc.toFixed(2)}" stroke-dashoffset="${(arc - filled).toFixed(2)}"/>
        </svg>
        <div class="gauge-center">
          <span class="gauge-score">${score}</span>
          <span class="gauge-label">Release Score</span>
          ${dateLabel ? `<span class="gauge-date">${dateLabel}</span>` : ""}
        </div>
      </div>
      ${winner ? '<span class="winner-badge">Winner</span>' : ""}
      </div>
    </div>`;
}

function factorRingLabel(key, value) {
  if (key === "calendar_boost") return value >= 100 ? "Yes" : "No";
  return String(value);
}

function factorRingPct(key, value) {
  if (key === "calendar_boost") return value >= 100 ? 100 : 0;
  return value;
}

function compareWinner(aVal, bVal) {
  if (aVal > bVal) return "a";
  if (bVal > aVal) return "b";
  return null;
}

function buildCompareWinners(rowA, rowB) {
  const factorWinners = {};
  for (const key of Object.keys(rowA.factors)) {
    factorWinners[key] = compareWinner(rowA.factors[key], rowB.factors[key]);
  }
  return {
    composite: compareWinner(rowA.composite, rowB.composite),
    factors: factorWinners,
  };
}

function renderFactorCards(row, { winners, side } = {}) {
  const inCompare = !!(winners && side);

  return Object.entries(row.factors)
    .map(([key, value]) => {
      const ringColor = factorRingColor(value);
      const ringLabel = factorRingLabel(key, value);
      const ringPct = factorRingPct(key, value);
      const label = factorDisplayLabel(key, value);
      const factorTag =
        key === "calendar_boost"
          ? (value >= 100 ? "HOLIDAY: YES" : "HOLIDAY: NO")
          : `${label.toUpperCase()}: ${value}%`;
      const isWinner = inCompare && winners[key] === side;

      return `
        <details class="factor-card${inCompare ? " factor-card-compare" : ""}">
          <summary>
            <div class="mini-ring ${key === "calendar_boost" ? "mini-ring-text" : ""}" style="--ring-color: ${ringColor}; --pct: ${ringPct}">
              <div class="mini-ring-inner">${ringLabel}</div>
            </div>
            <div class="factor-card-head">
              <span class="factor-card-title">${label}</span>
              <span class="factor-tag">${factorTag}</span>
            </div>
            ${inCompare ? (isWinner ? '<span class="winner-badge">Winner</span>' : "<span></span>") : ""}
            <span class="factor-chevron">▼</span>
          </summary>
          <div class="factor-detail">${buildFactorDetail(key, row)}</div>
        </details>`;
    })
    .join("");
}

function renderWeekendBreakdown(row, { winners, side } = {}) {
  const showWinner = winners && side && winners.composite === side;
  return `
    ${renderScoreGauge(row.composite, formatFriday(row.friday), { winner: showWinner })}
    <div class="factor-cards">${renderFactorCards(row, { winners: winners?.factors, side })}</div>`;
}

function renderCompareBreakdown(row, winners, side) {
  return renderWeekendBreakdown(row, { winners, side });
}

function isUsablePosterUrl(url) {
  if (!url) return false;
  if (/mojo-logo/i.test(url) || /boxofficemojo\/logo/i.test(url)) return false;
  return true;
}

function resolvePosterUrl(film) {
  const lookup = data?.poster_lookup || {};
  const url = film.poster_url || lookup[film.imdb_id] || lookup[film.title] || null;
  return isUsablePosterUrl(url) ? url : null;
}

function posterFallbackHtml(film) {
  const title = film.title || "?";
  const initial = title.charAt(0).toUpperCase();
  const shortTitle = title.length > 32 ? `${title.slice(0, 30)}…` : title;
  return `<span class="poster poster-fallback" aria-hidden="true" title="${title}"><span class="poster-fallback-letter">${initial}</span><span class="poster-fallback-title">${shortTitle}</span></span>`;
}

function posterImg(film) {
  const url = resolvePosterUrl(film);
  if (!url) {
    return posterFallbackHtml(film);
  }
  const initial = (film.title || "?").charAt(0).toUpperCase();
  return `<img class="poster" src="${url}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback-title="${film.title || "?"}" data-fallback-initial="${initial}" />`;
}

function attachPosterFallbacks(root = document) {
  root.querySelectorAll("img.poster[data-fallback-title]").forEach((img) => {
    img.onerror = () => {
      const span = document.createElement("span");
      span.className = "poster poster-fallback";
      span.setAttribute("aria-hidden", "true");
      const title = img.dataset.fallbackTitle || "?";
      span.title = title;
      span.innerHTML = `<span class="poster-fallback-letter">${img.dataset.fallbackInitial || title.charAt(0)}</span><span class="poster-fallback-title">${title.length > 32 ? `${title.slice(0, 30)}…` : title}</span>`;
      img.replaceWith(span);
    };
  });
}

function renderCompetitionList(films, overlapTitles, { historical = false } = {}) {
  if (!films.length) return "";

  const sorted = [...films].sort((a, b) => {
    const aOverlap = overlapTitles.has(a.title) ? 1 : 0;
    const bOverlap = overlapTitles.has(b.title) ? 1 : 0;
    return bOverlap - aOverlap || (b.analog_gross || 0) - (a.analog_gross || 0);
  });

  const items = sorted
    .map((c) => {
      const overlap = overlapTitles.has(c.title);
      const weekLabel = historical
        ? `Opened ${c.analog_year || "prior"}`
        : c.is_new_release
          ? "New wide release"
          : `Week ${c.week_in_release}${c.holdover_estimated ? " (est.)" : ""}`;
      const genres = (c.genres || []).join(", ") || "Genre unknown";
      const ratingText = c.mpaa_rating || "Rating unknown";
      return `
        <li class="comp-item ${overlap ? "overlap" : ""}">
          ${posterImg(c)}
          <div class="comp-item-body">
            <strong>${c.title}</strong>
            <div class="comp-meta">${weekLabel} · ${genres} · ${ratingText}</div>
          </div>
        </li>`;
    })
    .join("");

  return `<ul class="comp-list">${items}</ul>`;
}

function renderCompetition(row) {
  const overlapTitles = new Set(row.overlapFilms.map((f) => f.title));
  const sections = [];

  if (row.competition.length) {
    sections.push(`
      <h4 class="comp-subhead">Scheduled & in-market</h4>
      ${renderCompetitionList(row.competition, overlapTitles)}`);
  }

  if (row.historicalCompetition?.length) {
    sections.push(`
      <h4 class="comp-subhead">${row.competition.length ? "Historical analogs for this slot" : "Historical competition (schedule not published yet)"}</h4>
      <p class="muted comp-note">Wide releases that opened in this same week-of-year over the last decade. Overlap scores and genre tags use these when future release dates aren't available yet.</p>
      ${renderCompetitionList(row.historicalCompetition, overlapTitles, { historical: true })}`);
  }

  if (!sections.length) {
    return "<p class=\"muted\">No competition data available for this weekend.</p>";
  }

  return sections.join("");
}

function updateRankingsLayout() {
  const showDetail = !!expandedFriday && !els.compareMode.checked;
  els.rankingsSplit?.classList.toggle("has-selection", showDetail);
}

function renderDetailPanel() {
  if (!els.detailPanel) return;

  updateRankingsLayout();

  if (els.compareMode.checked) {
    els.detailPanel.innerHTML =
      `<div class="empty-state">Compare mode on — pick two weekends from the list.</div>`;
    return;
  }

  const row = rankings.find((r) => r.friday === expandedFriday);
  if (!row) {
    els.detailPanel.innerHTML =
      `<div class="empty-state">Select a weekend to view score breakdown and competition.</div>`;
    return;
  }

  els.detailPanel.innerHTML = `
    ${renderWeekendBreakdown(row)}
    <div class="competition-block">
      <h3>Competitive landscape</h3>
      ${renderCompetition(row)}
    </div>`;
  attachPosterFallbacks(els.detailPanel);
}

function updateRankCount() {
  const countEl = document.getElementById("rank-count");
  if (!countEl) return;
  if (!rankings.length) {
    countEl.textContent = "";
    countEl.classList.add("hidden");
    return;
  }
  countEl.textContent = String(rankings.length);
  countEl.classList.remove("hidden");
}

function updateRankRangeVisibility() {
  els.rankRangePanel?.classList.toggle("hidden", !hasRanked);
}

function renderRankedList() {
  updateRankRangeVisibility();
  updateRankCount();

  if (!rankings.length) {
    els.rankedList.innerHTML = `<div class="empty-state">No rankings yet.</div>`;
    renderDetailPanel();
    return;
  }

  els.rankedList.innerHTML = rankings
    .map((row, idx) => {
      const isSelected = expandedFriday === row.friday && !els.compareMode.checked;
      const isCompare = compareSlots.includes(row.friday);

      return `
        <article class="weekend-row ${isSelected ? "selected" : ""} ${isCompare ? "selected-compare" : ""}" data-friday="${row.friday}">
          <button type="button" class="weekend-summary" data-action="select" data-friday="${row.friday}">
            <span class="rank-num" aria-hidden="true">#${idx + 1}</span>
            <div class="weekend-summary-body">
              <div class="weekend-date">${formatFriday(row.friday)}</div>
              <div class="weekend-crumbs">WK ${row.week_of_year}</div>
              <div class="weekend-badges">${renderRowBadges(row)}</div>
            </div>
            <span class="score-pill ${scoreClass(row.composite)}">${row.composite}</span>
          </button>
        </article>`;
    })
    .join("");

  renderDetailPanel();
  attachPosterFallbacks(els.rankedList);
}

function syncCompareDateInputs() {
  if (!els.compareDateA || !els.compareDateB) return;

  const sorted = [...rankings].sort((a, b) => a.friday.localeCompare(b.friday));
  const min = sorted[0]?.friday || "";
  const max = sorted.at(-1)?.friday || "";
  for (const input of [els.compareDateA, els.compareDateB]) {
    input.min = min;
    input.max = max;
  }

  els.compareDateA.value = compareSlots[0] || "";
  els.compareDateB.value = compareSlots[1] || "";
}

function setCompareFromDateInput(which) {
  if (!els.compareMode.checked || !rankings.length) return;

  const idx = which === "a" ? 0 : 1;
  const input = which === "a" ? els.compareDateA : els.compareDateB;
  if (!input?.value) {
    compareSlots[idx] = null;
    renderRankedList();
    renderCompare();
    return;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.value)) return;

  const friday = nearestRankedFriday(input.value);
  if (!friday) {
    input.value = compareSlots[idx] || "";
    return;
  }

  compareSlots[idx] = friday;
  expandedFriday = null;
  renderRankedList();
  renderCompare();
}

function renderCompare() {
  if (!els.compareMode.checked) {
    els.comparePanel.classList.add("hidden");
    return;
  }

  els.comparePanel.classList.remove("hidden");
  syncCompareDateInputs();

  if (!compareSlots[0] || !compareSlots[1]) {
    els.compareColumns.innerHTML = "";
    return;
  }

  const a = rankings.find((r) => r.friday === compareSlots[0]);
  const b = rankings.find((r) => r.friday === compareSlots[1]);
  if (!a || !b) {
    els.compareColumns.innerHTML =
      `<div class="compare-empty">Those dates aren't in the current rankings. Adjust the date range or pick from the list.</div>`;
    return;
  }

  const winners = buildCompareWinners(a, b);
  els.compareColumns.innerHTML = [
    { row: a, side: "a" },
    { row: b, side: "b" },
  ]
    .map(
      ({ row, side }) => `
      <div class="compare-col">
        ${renderCompareBreakdown(row, winners, side)}
        <div class="competition-block" style="margin-top:0.75rem">
          <h3>Competition</h3>
          ${renderCompetition(row)}
        </div>
      </div>`
    )
    .join("");

  els.comparePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  attachPosterFallbacks(els.compareColumns);
}

function runRanking({ preserveSelection = false } = {}) {
  const genre = els.genre.value;
  const rating = els.rating.value;
  const title = els.title.value.trim() || "Your film";

  if (!genre || !rating) {
    els.resultsSummary.textContent = "Select a genre and rating to rank upcoming weekends.";
    return;
  }

  const prevFriday = expandedFriday;
  const prevCompare = [...compareSlots];

  scoringParams = readScoringParamsFromUI();
  allRankings = rankWeekends(data, { genre, rating, title }, scoringParams);
  hasRanked = true;

  if (!preserveSelection || !rankDateRange.start || !rankDateRange.end) {
    rankDateRange = defaultRankDateRange();
  }
  syncDateRangeUI();
  applyDateRangeFilter();

  if (preserveSelection) {
    expandedFriday = rankings.some((r) => r.friday === prevFriday) ? prevFriday : null;
    compareSlots = prevCompare.map((f) =>
      f && rankings.some((r) => r.friday === f) ? f : null
    );
  } else {
    expandedFriday = null;
    compareSlots = [null, null];
  }

  els.resultsSummary.textContent = formatDateRange(rankings);

  renderRankedList();
  renderCompare();
}

function handleSelect(friday) {
  if (els.compareMode.checked) {
    if (compareSlots.includes(friday)) {
      compareSlots = compareSlots.map((f) => (f === friday ? null : f));
    } else {
      const emptyIdx = compareSlots.findIndex((f) => !f);
      if (emptyIdx >= 0) {
        compareSlots[emptyIdx] = friday;
      } else {
        compareSlots = [compareSlots[1], friday];
      }
    }
    expandedFriday = null;
    renderRankedList();
    renderCompare();
    return;
  }

  expandedFriday = expandedFriday === friday ? null : friday;
  renderRankedList();
}

function handleListClick(event) {
  if (event.target.closest("summary, .factor-detail, details")) return;

  const btn = event.target.closest("[data-action='select']");
  if (!btn) return;

  const friday = btn.dataset.friday;
  if (!friday) return;

  event.preventDefault();
  handleSelect(friday);
}

els.rankBtn.addEventListener("click", () => runRanking());
els.rankedList.addEventListener("click", handleListClick);
els.paramsBtn.addEventListener("click", () => {
  const open = els.paramsPanel.classList.toggle("hidden");
  const expanded = !open;
  els.paramsBtn.setAttribute("aria-expanded", String(expanded));
});
els.paramsReset.addEventListener("click", () => {
  applyScoringParamsToUI(defaultScoringParams(data));
  if (hasRanked) runRanking({ preserveSelection: true });
});
els.holdoverSlider.addEventListener("input", onParamsChanged);
els.wideSlider.addEventListener("input", onParamsChanged);
els.historyYearMin.addEventListener("change", onHistoryYearChanged);
els.historyYearMax.addEventListener("change", onHistoryYearChanged);
els.weightSliders.addEventListener("input", (event) => {
  const key = event.target.dataset.weightKey;
  if (!key) return;
  rebalanceWeights(key, Number(event.target.value));
  onParamsChanged();
});
els.compareMode.addEventListener("change", () => {
  compareSlots = [null, null];
  expandedFriday = els.compareMode.checked ? null : expandedFriday;
  if (els.compareDateA) els.compareDateA.value = "";
  if (els.compareDateB) els.compareDateB.value = "";
  renderRankedList();
  renderCompare();
});
els.compareDateA?.addEventListener("change", () => setCompareFromDateInput("a"));
els.compareDateB?.addEventListener("change", () => setCompareFromDateInput("b"));
els.compareDateA?.addEventListener("input", () => setCompareFromDateInput("a"));
els.compareDateB?.addEventListener("input", () => setCompareFromDateInput("b"));
els.rangeDateStart.addEventListener("change", () => onDateRangeChanged());
els.rangeDateEnd.addEventListener("change", () => onDateRangeChanged());

loadData().catch((err) => {
  els.resultsSummary.textContent = `Failed to load data: ${err.message}`;
});
