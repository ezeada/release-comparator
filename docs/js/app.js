import {
  rankWeekends,
  FACTOR_LABELS,
  FACTOR_DESCRIPTIONS,
  formatFriday,
  formatMoney,
} from "./ranking.js";

let data = null;
let rankings = [];
let expandedFriday = null;
let compareSelection = [];

const els = {
  genre: document.getElementById("film-genre"),
  rating: document.getElementById("film-rating"),
  title: document.getElementById("film-title"),
  rankBtn: document.getElementById("rank-btn"),
  rankedList: document.getElementById("ranked-list"),
  resultsSummary: document.getElementById("results-summary"),
  paramsBtn: document.getElementById("params-btn"),
  paramsPanel: document.getElementById("params-panel"),
  weightList: document.getElementById("weight-list"),
  compareMode: document.getElementById("compare-mode"),
  comparePanel: document.getElementById("compare-panel"),
  compareColumns: document.getElementById("compare-columns"),
  calendarGrid: document.getElementById("calendar-grid"),
  tabs: document.querySelectorAll(".tab"),
  rankedView: document.getElementById("ranked-view"),
  calendarView: document.getElementById("calendar-view"),
};

async function loadData() {
  const resp = await fetch("data/slate_setter.json");
  if (!resp.ok) throw new Error("Could not load dataset");
  data = await resp.json();
  populateFormOptions();
  populateParamsPanel();
}

function populateFormOptions() {
  for (const genre of data.config.genres) {
    const opt = document.createElement("option");
    opt.value = genre;
    opt.textContent = genre;
    els.genre.appendChild(opt);
  }
  els.genre.value = "Horror";

  for (const rating of data.config.ratings) {
    const opt = document.createElement("option");
    opt.value = rating;
    opt.textContent = rating;
    els.rating.appendChild(opt);
  }
  els.rating.value = "R";
}

function populateParamsPanel() {
  const meta = data.metadata;
  const weights = data.config.weights;

  els.weightList.innerHTML = Object.entries(weights)
    .map(
      ([key, w]) => `
      <li>
        <span>${FACTOR_LABELS[key]}</span>
        <span>${Math.round(w * 100)}%</span>
      </li>`
    )
    .join("");

  document.getElementById("param-holdover").textContent =
    `${meta.holdover_weeks_assumption} weeks (projected for scheduled titles)`;
  document.getElementById("param-wide").textContent =
    `${meta.wide_theater_threshold}+ theaters`;
  document.getElementById("param-history").textContent =
    `${meta.years_covered[0]}–${meta.years_covered.at(-1)} (${meta.historical_weekends} weekends)`;
  document.getElementById("param-refreshed").textContent = new Date(
    meta.generated_at
  ).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  document.getElementById("param-quality").textContent =
    `${meta.data_quality.films_with_genre_pct}% genre · ${meta.data_quality.films_with_rating_pct}% rating · ${meta.data_quality.scheduled_with_genre_pct}% upcoming genre coverage`;
}

function scoreClass(score) {
  if (score >= 70) return "high";
  if (score >= 45) return "mid";
  return "low";
}

function renderFactorBars(factors) {
  return Object.entries(factors)
    .map(([key, value]) => {
      const invertNote =
        key === "audience_overlap" || key === "crowding"
          ? " (higher is better)"
          : "";
      return `
        <div class="factor">
          <div class="factor-header">
            <span class="factor-label">${FACTOR_LABELS[key]}${invertNote}</span>
            <span class="factor-value">${value}%</span>
          </div>
          <div class="bar-track" role="presentation">
            <div class="bar-fill" style="width: ${value}%"></div>
          </div>
          <p class="muted" style="margin:0;font-size:0.75rem">${FACTOR_DESCRIPTIONS[key]}</p>
        </div>`;
    })
    .join("");
}

function renderCompetition(competition, overlapFilms, genre, rating) {
  if (!competition.length) {
    return "<p class=\"muted\">No wide competition projected this weekend.</p>";
  }

  const overlapTitles = new Set(overlapFilms.map((f) => f.title));
  const items = competition
    .map((c) => {
      const overlap = overlapTitles.has(c.title);
      const weekLabel = c.is_new_release
        ? "New wide release"
        : `Week ${c.week_in_release}${c.holdover_estimated ? " (est.)" : ""}`;
      const genres = (c.genres || []).join(", ") || "Genre unknown";
      const ratingText = c.mpaa_rating || "Rating unknown";
      return `
        <li class="comp-item ${overlap ? "overlap" : ""}">
          <div>
            <strong>${c.title}</strong>
            <div class="comp-meta">${weekLabel} · ${genres} · ${ratingText}</div>
          </div>
        </li>`;
    })
    .join("");

  return `<ul class="comp-list">${items}</ul>`;
}

function renderAnalog(analog, genre) {
  const parts = [];
  if (analog.medianMarket) {
    parts.push(
      `Over the last decade, this week-of-year averaged <strong>${formatMoney(analog.medianMarket)}</strong> total domestic gross across ${analog.sampleWeekends || "—"} sampled weekends.`
    );
  }
  if (analog.genreMedian) {
    parts.push(
      `<strong>${genre}</strong> wide releases in this slot posted a median in-chart gross around <strong>${formatMoney(analog.genreMedian)}</strong> (${analog.genreSamples} samples).`
    );
  }
  if (!parts.length) return "";
  return `<div class="analog-block">${parts.join(" ")}</div>`;
}

function renderRankedList() {
  if (!rankings.length) {
    els.rankedList.innerHTML = `<div class="empty-state">No rankings yet.</div>`;
    return;
  }

  els.rankedList.innerHTML = rankings
    .map((row, idx) => {
      const isExpanded = expandedFriday === row.friday;
      const isCompare = compareSelection.includes(row.friday);
      const eventBadges = row.events
        .map((e) => `<span class="badge event">${e.name}</span>`)
        .join("");

      return `
        <article class="weekend-row ${isCompare ? "selected-compare" : ""}" data-friday="${row.friday}">
          <button type="button" class="weekend-summary" data-action="toggle" data-friday="${row.friday}">
            <span class="rank-badge">#${idx + 1}</span>
            <div>
              <div class="weekend-date">${formatFriday(row.friday)}</div>
              <div class="weekend-badges">
                ${eventBadges}
                <span class="badge">${row.competition.length} wide active</span>
                ${row.overlapFilms.length ? `<span class="badge">${row.overlapFilms.length} overlap</span>` : ""}
              </div>
            </div>
            <span class="score-pill ${scoreClass(row.composite)}">${row.composite}</span>
            <span class="expand-icon">${isExpanded ? "▲" : "▼"}</span>
          </button>
          ${
            isExpanded
              ? `<div class="weekend-detail">
                  <p class="rationale">${row.rationale}</p>
                  <div class="factor-grid">${renderFactorBars(row.factors)}</div>
                  <div class="competition-block">
                    <h3>Competitive landscape</h3>
                    ${renderCompetition(row.competition, row.overlapFilms, row.genre, row.rating)}
                  </div>
                  ${renderAnalog(row.historicalAnalog, row.genre)}
                </div>`
              : ""
          }
        </article>`;
    })
    .join("");
}

function renderCalendar() {
  if (!rankings.length) {
    els.calendarGrid.innerHTML = `<div class="empty-state">Rank weekends to see the calendar.</div>`;
    return;
  }

  const byMonth = {};
  for (const row of rankings) {
    const d = new Date(row.friday + "T12:00:00");
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth[key] = byMonth[key] || {
      label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      weeks: [],
    };
    byMonth[key].weeks.push(row);
  }

  els.calendarGrid.innerHTML = Object.values(byMonth)
    .map((month) => {
      const weeks = month.weeks
        .sort((a, b) => a.friday.localeCompare(b.friday))
        .map((row) => {
          const intensity = row.composite / 100;
          const bg = `rgba(196, 163, 90, ${0.08 + intensity * 0.45})`;
          return `
            <button type="button" class="cal-week" data-friday="${row.friday}" style="background:${bg}">
              <span>${formatFriday(row.friday).replace(/, \d{4}/, "")}</span>
              <span class="score-pill ${scoreClass(row.composite)}">${row.composite}</span>
            </button>`;
        })
        .join("");
      return `
        <div class="cal-month">
          <h3>${month.label}</h3>
          <div class="cal-weeks">${weeks}</div>
        </div>`;
    })
    .join("");
}

function renderCompare() {
  if (compareSelection.length !== 2) {
    els.comparePanel.classList.add("hidden");
    return;
  }

  const [a, b] = compareSelection.map((f) => rankings.find((r) => r.friday === f)).filter(Boolean);
  if (!a || !b) return;

  els.comparePanel.classList.remove("hidden");
  els.compareColumns.innerHTML = [a, b]
    .map(
      (row) => `
      <div class="compare-col">
        <h3>${formatFriday(row.friday)}</h3>
        <p class="score-pill ${scoreClass(row.composite)}" style="font-size:1.5rem;margin:0 0 0.5rem">${row.composite}</p>
        <p class="muted">${row.rationale}</p>
        <div class="factor-grid" style="margin-top:0.75rem">${renderFactorBars(row.factors)}</div>
      </div>`
    )
    .join("");
}

function runRanking() {
  const genre = els.genre.value;
  const rating = els.rating.value;
  const title = els.title.value.trim() || "Your film";

  rankings = rankWeekends(data, { genre, rating, title });
  expandedFriday = rankings[0]?.friday ?? null;
  compareSelection = [];

  const quality = data.metadata.data_quality;
  els.resultsSummary.textContent =
    `${rankings.length} weekends ranked for ${title} (${genre}, ${rating}). Data: ${quality.scheduled_with_genre_pct}% upcoming titles have genre metadata.`;

  renderRankedList();
  renderCalendar();
  renderCompare();
}

function handleListClick(event) {
  const btn = event.target.closest("[data-action], .cal-week");
  if (!btn) return;

  const friday = btn.dataset.friday;
  if (!friday) return;

  if (els.compareMode.checked) {
    if (!compareSelection.includes(friday)) {
      compareSelection.push(friday);
      if (compareSelection.length > 2) compareSelection.shift();
    } else {
      compareSelection = compareSelection.filter((f) => f !== friday);
    }
    renderRankedList();
    renderCompare();
    return;
  }

  expandedFriday = expandedFriday === friday ? null : friday;
  renderRankedList();

  document.querySelector(`[data-friday="${friday}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setupTabs() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      els.tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const view = tab.dataset.view;
      els.rankedView.classList.toggle("hidden", view !== "ranked");
      els.calendarView.classList.toggle("hidden", view !== "calendar");
    });
  });
}

els.rankBtn.addEventListener("click", runRanking);
els.rankedList.addEventListener("click", handleListClick);
els.calendarGrid.addEventListener("click", handleListClick);
els.paramsBtn.addEventListener("click", () => {
  const open = els.paramsPanel.classList.toggle("hidden");
  els.paramsBtn.setAttribute("aria-expanded", String(!open));
});
els.compareMode.addEventListener("change", () => {
  compareSelection = [];
  renderRankedList();
  renderCompare();
});

setupTabs();
loadData()
  .then(runRanking)
  .catch((err) => {
    els.resultsSummary.textContent = `Failed to load data: ${err.message}`;
  });
