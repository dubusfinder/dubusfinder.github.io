
/* =========================================
   DU BUS FINDER
   Smart Search + Online/Offline + Theme
   Favorites + Recent Searches + PWA
========================================= */

"use strict";

/* ---------- CONFIGURATION ---------- */

const API_URL = "https://script.google.com/macros/s/AKfycbzxpN2M7gA9tz2ZIz4V9zxU18MDxH1A9DUndLrAIqoRaXCeLPa9rHng9dXL5Q2XD4pyQA/exec";

const DB_CACHE_KEY = "duBusFinderDatabaseV1";
const THEME_KEY = "duBusFinderTheme";
const FAVORITES_KEY = "duBusFinderFavorites";
const RECENT_KEY = "duBusFinderRecent";

let scheduleRows = [];
let busRows = [];
let stopRows = [];
let serviceDayRows = [];

let databaseLoading = false;
let databaseLoaded = false;
let deferredPrompt = null;

let suggestionPanels = {};

const $ = id => document.getElementById(id);
const results = $("results");

/* =========================================
   LOCAL STORAGE
========================================= */

function readLocalArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveLocalArray(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn("Local storage error:", error);
    return false;
  }
}

/* =========================================
   THEME SYSTEM
========================================= */

function applyTheme(theme) {
  const selected = theme === "dark" ? "dark" : "light";

  document.documentElement.dataset.theme = selected;

  try {
    localStorage.setItem(THEME_KEY, selected);
  } catch (error) {
    console.warn("Theme save failed:", error);
  }

  const icon = document.querySelector(".theme-icon");
  const button = $("themeToggle");

  if (icon) {
    icon.textContent = selected === "dark" ? "☀" : "☾";
  }

  if (button) {
    button.setAttribute(
      "aria-label",
      selected === "dark" ? "Switch to light mode" : "Switch to dark mode"
    );
  }
}

function initializeTheme() {
  let saved = null;

  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch (error) {
    console.warn("Theme read failed:", error);
  }

  if (!saved) {
    saved = window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  applyTheme(saved);
}

initializeTheme();

$("themeToggle")?.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme || "light";
  applyTheme(current === "dark" ? "light" : "dark");
});

/* =========================================
   BASIC HELPERS
========================================= */

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function setStatus(message, success = false) {
  const status = $("dataStatus");
  if (!status) return;

  status.textContent = message;
  status.classList.toggle("success", success);

  if (success) {
    status.style.background = "";
    status.style.color = "";
  } else {
    status.style.background = "";
    status.style.color = "";
  }
}

function showEmpty(title, message) {
  const titleElement = $("resultTitle");
  if (titleElement) titleElement.textContent = title;

  if (!results) return;

  results.className = "results empty";
  results.innerHTML = `
    <div class="empty-icon">🚌</div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(message)}</p>
  `;
}

function showConnectionError(title, message) {
  const titleElement = $("resultTitle");
  if (titleElement) titleElement.textContent = title;

  if (!results) return;

  results.className = "results empty";
  results.innerHTML = `
    <div class="empty-icon">⚠️</div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(message)}</p>
    <button type="button" id="retryConnection" class="retry-button">
      Try Again
    </button>
  `;

  $("retryConnection")?.addEventListener("click", loadDatabase);
}

/* =========================================
   BANGLA TRANSLITERATION
========================================= */

const banglaMap = {
  "অ":"o","আ":"a","ই":"i","ঈ":"i",
  "উ":"u","ঊ":"u","ঋ":"ri",
  "এ":"e","ঐ":"oi","ও":"o","ঔ":"ou",
  "ক":"k","খ":"kh","গ":"g","ঘ":"gh",
  "ঙ":"ng","চ":"ch","ছ":"chh",
  "জ":"j","ঝ":"jh","ঞ":"n",
  "ট":"t","ঠ":"th","ড":"d","ঢ":"dh",
  "ণ":"n","ত":"t","থ":"th","দ":"d",
  "ধ":"dh","ন":"n",
  "প":"p","ফ":"ph","ব":"b","ভ":"bh",
  "ম":"m","য":"j","র":"r","ল":"l",
  "শ":"sh","ষ":"sh","স":"s","হ":"h",
  "ড়":"r","ঢ়":"rh","য়":"y",
  "ং":"ng","ঃ":"h","ঁ":"n","ৎ":"t","্":""
};

function transliterateBangla(value) {
  return [...String(value ?? "")]
    .map(char => banglaMap[char] ?? char)
    .join("");
}

function searchNormalize(value) {
  let text = normalize(value);

  text = transliterateBangla(text);
  text = text.replace(/[^a-z0-9]/g, "");

  return text
    .replace(/sh/g, "s")
    .replace(/chh/g, "ch")
    .replace(/ch/g, "c")
    .replace(/ph/g, "f")
    .replace(/bh/g, "b")
    .replace(/[vw]/g, "b")
    .replace(/z/g, "j")
    .replace(/y/g, "i")
    .replace(/ou/g, "o")
    .replace(/oo/g, "u")
    .replace(/ee/g, "i")
    .replace(/aa/g, "a")
    .replace(/kh/g, "k")
    .replace(/gh/g, "g")
    .replace(/th/g, "t")
    .replace(/dh/g, "d");
}

/* =========================================
   FUZZY MATCHING
========================================= */

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from(
    { length: b.length + 1 },
    (_, index) => index
  );

  for (let i = 1; i <= a.length; i++) {
    const current = [i];

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }

    previous = current;
  }

  return previous[b.length];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) /
      Math.max(a.length, b.length);
  }

  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function getMatchScore(query, target) {
  const q = searchNormalize(query);
  const t = searchNormalize(target);

  if (!q || !t) return 0;
  if (q === t) return 100;
  if (t.startsWith(q)) return 95;
  if (t.includes(q)) return 90;
  if (q.includes(t)) return 85;

  const score = similarity(q, t);
  const threshold = q.length <= 3 ? 0.75 : 0.55;

  return score >= threshold ? Math.round(score * 80) : 0;
}

/* =========================================
   OFFLINE DATABASE
========================================= */

function saveDatabaseLocally(data) {
  try {
    const backup = {
      buses: data.buses,
      stops: data.stops,
      schedules: data.schedules,
      serviceDays: data.serviceDays || [],
      savedAt: new Date().toISOString()
    };

    localStorage.setItem(DB_CACHE_KEY, JSON.stringify(backup));
    return true;
  } catch (error) {
    console.error("Database cache save failed:", error);
    return false;
  }
}

function getLocalDatabase() {
  try {
    const saved = localStorage.getItem(DB_CACHE_KEY);
    if (!saved) return null;

    const data = JSON.parse(saved);

    if (
      !data ||
      !Array.isArray(data.buses) ||
      !Array.isArray(data.stops) ||
      !Array.isArray(data.schedules)
    ) {
      return null;
    }

    return data;
  } catch (error) {
    console.error("Offline database read failed:", error);
    return null;
  }
}

function applyDatabase(data, source) {
  if (
    !data ||
    !Array.isArray(data.buses) ||
    !Array.isArray(data.stops) ||
    !Array.isArray(data.schedules)
  ) {
    return false;
  }

  busRows = data.buses;
  stopRows = data.stops;
  scheduleRows = data.schedules;

  serviceDayRows = Array.isArray(data.serviceDays)
    ? data.serviceDays
    : [];

  databaseLoaded = scheduleRows.length > 0;

  if (!databaseLoaded) return false;

  if (source === "online") {
    setStatus(
      `${scheduleRows.length} schedules connected`,
      true
    );
  } else {
    setStatus(
      `Offline mode · ${scheduleRows.length} saved schedules`,
      true
    );
  }

  renderFavoriteSection();
  renderRecentSection();

  return true;
}

/* =========================================
   ONLINE + OFFLINE CONNECTION
========================================= */

function loadDatabase() {
  if (databaseLoading) return;

  const cachedData = getLocalDatabase();

  if (cachedData) {
    applyDatabase(cachedData, "offline");
  }

  if (!navigator.onLine) {
    if (!cachedData) {
      databaseLoaded = false;
      setStatus("No internet connection");
      showConnectionError(
        "You are offline",
        "Connect to the internet once to download the bus database."
      );
    } else {
      setStatus(
        `Offline mode · ${scheduleRows.length} saved schedules`,
        true
      );
    }
    return;
  }

  if (!API_URL) {
    if (!cachedData) {
      setStatus("API URL not configured");
      showConnectionError(
        "API URL missing",
        "Please check the Google Apps Script API URL."
      );
    }
    return;
  }

  databaseLoading = true;
  setStatus("Connecting to database...");

  const callbackName =
    "duBusCallback_" + Date.now() + "_" +
    Math.floor(Math.random() * 10000);

  const script = document.createElement("script");
  let completed = false;

  const timeout = setTimeout(() => {
    fail(
      "Connection timed out",
      "The database did not respond in time. Please try again.",
      "Connection timed out"
    );
  }, 20000);

  function cleanup() {
    delete window[callbackName];
    script.remove();
    clearTimeout(timeout);
    databaseLoading = false;
  }

  function fail(title, message, statusMessage) {
    if (completed) return;

    completed = true;
    cleanup();

    if (cachedData && databaseLoaded) {
      setStatus(
        `Offline database active · ${scheduleRows.length} schedules`,
        true
      );
      return;
    }

    databaseLoaded = false;
    setStatus(statusMessage);
    showConnectionError(title, message);
  }

  window[callbackName] = function(data) {
    if (completed) return;

    if (
      !data ||
      data.success !== true ||
      !Array.isArray(data.buses) ||
      !Array.isArray(data.stops) ||
      !Array.isArray(data.schedules)
    ) {
      fail(
        "Database error",
        data?.error || "The database returned an invalid response.",
        "Database error"
      );
      return;
    }

    completed = true;
    cleanup();

    const saved = saveDatabaseLocally(data);
    const applied = applyDatabase(data, "online");

    if (!applied) {
      fail(
        "Invalid database",
        "No schedule information was found.",
        "Invalid database"
      );
      return;
    }

    if (!saved) {
      setStatus(
        "Online database connected · Offline saving failed",
        true
      );
    }

    showEmpty(
      "Database connected!",
      `${busRows.length} buses, ${stopRows.length} stopages and ${scheduleRows.length} schedules loaded.`
    );
  };

  script.onerror = () => {
    fail(
      "Connection failed",
      "Could not connect to the database. Check your internet and try again.",
      "API connection failed"
    );
  };

  script.src = API_URL +
    "?action=all&callback=" +
    encodeURIComponent(callbackName);

  document.body.appendChild(script);
}

/* Refresh when internet returns */
window.addEventListener("online", () => {
  loadDatabase();
});

/* Keep cached data active when internet disconnects */
window.addEventListener("offline", () => {
  const cached = getLocalDatabase();

  if (cached) {
    applyDatabase(cached, "offline");
  } else {
    databaseLoaded = false;
    setStatus("You are offline");
  }
});

/* =========================================
   BUS AND STOP NAMES
========================================= */

function getBusNames() {
  const names = new Set();

  scheduleRows.forEach(row => {
    if (row.bus_name) {
      names.add(String(row.bus_name).trim());
    }
  });

  busRows.forEach(row => {
    const name = row.bus_name || row.name;
    if (name) names.add(String(name).trim());
  });

  return [...names].filter(Boolean);
}

function getStopNames() {
  const names = new Set();

  scheduleRows.forEach(row => {
    const name = row.stopage || row.stopage_name;
    if (name) names.add(String(name).trim());
  });

  stopRows.forEach(row => {
    const name =
      row.stopage ||
      row.stopage_name ||
      row.stop_name ||
      row.name;

    if (name) names.add(String(name).trim());
  });

  return [...names].filter(Boolean);
}

/* =========================================
   LIVE SUGGESTIONS
========================================= */

function smartMatches(query, names) {
  if (!query.trim()) return [];

  return names
    .map(name => ({
      name,
      score: getMatchScore(query, name)
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function createSuggestionPanel(inputId) {
  const input = $(inputId);
  if (!input) return null;

  const panel = document.createElement("div");
  panel.className = "suggestion-panel";

  panel.style.cssText = `
    display:none;
    position:fixed;
    z-index:99999;
    background:var(--card, #ffffff);
    border:1px solid var(--border, #ddd);
    border-radius:10px;
    box-shadow:0 5px 18px rgba(0,0,0,0.15);
    max-height:260px;
    overflow-y:auto;
    padding:5px;
  `;

  document.body.appendChild(panel);
  suggestionPanels[inputId] = panel;

  return panel;
}

function positionPanel(input, panel) {
  if (!input || !panel) return;

  const rect = input.getBoundingClientRect();

  panel.style.left = rect.left + "px";
  panel.style.top = rect.bottom + 5 + "px";
  panel.style.width = rect.width + "px";
}

function hideSuggestions(inputId) {
  if (suggestionPanels[inputId]) {
    suggestionPanels[inputId].style.display = "none";
  }
}

function showSuggestions(inputId, matches) {
  const input = $(inputId);
  const panel = suggestionPanels[inputId];

  if (!input || !panel) return;

  if (!matches.length) {
    hideSuggestions(inputId);
    return;
  }

  panel.innerHTML = matches.map(item => `
    <button
      type="button"
      data-value="${escapeHtml(item.name)}"
      style="
        display:block;
        width:100%;
        padding:11px 12px;
        border:0;
        border-bottom:1px solid var(--border, #eee);
        background:transparent;
        text-align:left;
        cursor:pointer;
        color:var(--text, #222);
        font-size:14px;
      "
    >
      🚌 ${escapeHtml(item.name)}
    </button>
  `).join("");

  positionPanel(input, panel);
  panel.style.display = "block";

  panel.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      input.value = button.dataset.value;
      hideSuggestions(inputId);
      runSearch();
    });
  });
}

function setupSuggestions(inputId, getNames) {
  const input = $(inputId);
  if (!input) return;

  createSuggestionPanel(inputId);

  input.addEventListener("input", () => {
    const query = input.value.trim();

    if (!query || !databaseLoaded) {
      hideSuggestions(inputId);
      return;
    }

    showSuggestions(
      inputId,
      smartMatches(query, getNames())
    );
  });

  input.addEventListener("focus", () => {
    const query = input.value.trim();

    if (!query || !databaseLoaded) return;

    showSuggestions(
      inputId,
      smartMatches(query, getNames())
    );
  });

  input.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      hideSuggestions(inputId);
    }
  });
}

document.addEventListener("click", event => {
  Object.keys(suggestionPanels).forEach(id => {
    const panel = suggestionPanels[id];
    const input = $(id);

    if (
      panel &&
      input &&
      !panel.contains(event.target) &&
      !input.contains(event.target)
    ) {
      hideSuggestions(id);
    }
  });
});

function repositionSuggestions() {
  Object.keys(suggestionPanels).forEach(id => {
    const panel = suggestionPanels[id];
    const input = $(id);

    if (panel && input && panel.style.display !== "none") {
      positionPanel(input, panel);
    }
  });
}

window.addEventListener("resize", repositionSuggestions);
window.addEventListener("scroll", repositionSuggestions, true);

/* =========================================
   FAVORITE BUSES
========================================= */

function getFavorites() {
  return readLocalArray(FAVORITES_KEY);
}

function isFavorite(busName) {
  return getFavorites().includes(busName);
}

function toggleFavorite(busName) {
  if (!busName) return;

  let favorites = getFavorites();

  if (favorites.includes(busName)) {
    favorites = favorites.filter(name => name !== busName);
  } else {
    favorites.push(busName);
  }

  saveLocalArray(FAVORITES_KEY, favorites);
  renderFavoriteSection();

  if (databaseLoaded) runSearch();
}

function renderFavoriteSection() {
  const section = $("favoriteSection");
  if (!section) return;

  const favorites = getFavorites();

  if (!favorites.length) {
    section.innerHTML = "";
    return;
  }

  section.innerHTML = `
    <div class="personal-section-heading">
      <div>
        <div class="eyebrow">YOUR COLLECTION</div>
        <h3>Favourite buses</h3>
      </div>
    </div>

    <div class="personal-chip-list">
      ${favorites.map(name => `
        <button
          type="button"
          class="personal-chip"
          data-favorite-bus="${escapeHtml(name)}"
        >
          <span>★</span> ${escapeHtml(name)}
        </button>
      `).join("")}
    </div>
  `;

  section.querySelectorAll("[data-favorite-bus]").forEach(button => {
    button.addEventListener("click", () => {
      $("busSearch").value = button.dataset.favoriteBus;
      runSearch();

      $("search-section")?.scrollIntoView({
        behavior: "smooth"
      });
    });
  });
}

/* =========================================
   RECENT SEARCHES
========================================= */

function getRecentSearches() {
  return readLocalArray(RECENT_KEY);
}

function saveRecentSearch(bus, stop, direction, time, timeWindow) {
  const item = {
    bus,
    stop,
    direction,
    time,
    timeWindow: timeWindow || 0,
    label: [bus, stop, direction, time, time ? (timeWindow ? "±" + timeWindow + " min" : "Exact time") : ""]
      .filter(Boolean)
      .join(" · ")
  };

  if (!item.label) return;

  let recent = getRecentSearches();

  recent = recent.filter(old => old.label !== item.label);
  recent.unshift(item);
  recent = recent.slice(0, 5);

  saveLocalArray(RECENT_KEY, recent);
  renderRecentSection();
}

function renderRecentSection() {
  const section = $("recentSection");
  if (!section) return;

  const recent = getRecentSearches();

  if (!recent.length) {
    section.innerHTML = "";
    return;
  }

  section.innerHTML = `
    <div class="personal-section-heading">
      <div>
        <div class="eyebrow">SEARCH HISTORY</div>
        <h3>Recent searches</h3>
      </div>

      <button type="button" class="clear-recent">
        Clear history
      </button>
    </div>

    <div class="personal-chip-list">
      ${recent.map((item, index) => `
        <button
          type="button"
          class="personal-chip recent-chip"
          data-recent-index="${index}"
        >
          <span>◷</span> ${escapeHtml(item.label)}
        </button>
      `).join("")}
    </div>
  `;

  section.querySelectorAll("[data-recent-index]").forEach(button => {
    button.addEventListener("click", () => {
      const item = recent[Number(button.dataset.recentIndex)];
      if (!item) return;

      $("busSearch").value = item.bus || "";
      $("stopSearch").value = item.stop || "";
      setDirection(item.direction || "UP");
      syncTimePickerFromValue(item.time || "");
      setTimeWindow(item.timeWindow || 0);

      runSearch();

      $("search-section")?.scrollIntoView({
        behavior: "smooth"
      });
    });
  });

  section.querySelector(".clear-recent")?.addEventListener("click", () => {
    saveLocalArray(RECENT_KEY, []);
    renderRecentSection();
  });
}

/* =========================================
   TIME CONVERSION
========================================= */

/* CUSTOM 12-HOUR TIME PICKER */
let selectedTimePeriod = "AM";
function updateTimeSearchValue() {
  const hour = Number($("timeHour")?.value);
  const minuteValue = $("timeMinute")?.value;
  if (!hour || minuteValue === "" || minuteValue == null) {
    $("timeSearch").value = "";
    updateSearchWindowRange();
    return;
  }
  let hour24 = hour % 12;
  if (selectedTimePeriod === "PM") hour24 += 12;
  $("timeSearch").value = String(hour24).padStart(2, "0") + ":" + minuteValue;
  updateSearchWindowRange();
}
function setTimePeriod(period) {
  selectedTimePeriod = period === "PM" ? "PM" : "AM";
  document.querySelectorAll(".period-btn").forEach(button => {
    const active = button.dataset.period === selectedTimePeriod;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  updateTimeSearchValue();
}
function syncTimePickerFromValue(value) {
  if (!value) {
    $("timeHour").value = ""; $("timeMinute").value = ""; $("timeSearch").value = "";
    setTimePeriod("AM"); return;
  }
  const match = String(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return;
  const hour24 = Number(match[1]);
  $("timeHour").value = String(hour24 % 12 || 12);
  $("timeMinute").value = match[2];
  setTimePeriod(hour24 >= 12 ? "PM" : "AM");
  updateTimeSearchValue();
  syncClockPickerFromValue(value);
}
for (let hour = 1; hour <= 12; hour++) {
  const option = document.createElement("option");
  option.value = String(hour); option.textContent = String(hour).padStart(2, "0");
  $("timeHour")?.appendChild(option);
}
for (let minute = 0; minute < 60; minute++) {
  const option = document.createElement("option");
  option.value = String(minute).padStart(2, "0");
  option.textContent = String(minute).padStart(2, "0");
  $("timeMinute")?.appendChild(option);
}
$("timeHour")?.addEventListener("change", updateTimeSearchValue);
$("timeMinute")?.addEventListener("change", updateTimeSearchValue);
document.querySelectorAll(".period-btn").forEach(button => button.addEventListener("click", () => setTimePeriod(button.dataset.period)));
setTimePeriod("AM");

/* MOBILE ANALOG CLOCK PICKER */
const clockPicker = $("clockPicker");
const clockTrigger = $("clockTrigger");
const clockTriggerText = $("clockTriggerText");
const clockPopover = $("clockPopover");
const clockFace = $("clockFace");
const clockStepLabel = $("clockStepLabel");
const clockHourDisplay = $("clockHourDisplay");
const clockMinuteDisplay = $("clockMinuteDisplay");
const clockPeriodButtons = clockPopover?.querySelectorAll("[data-period]");
let selectedClockHour = "";
let selectedClockMinute = "";
let selectedClockPeriod = "AM";
let clockStep = "hour";
let savedClockValue = "";

function clockDisplayText() {
  if (!selectedClockHour || selectedClockMinute === "") return "Select time";
  return selectedClockHour + ":" + selectedClockMinute + " " + selectedClockPeriod;
}
function renderClockFace() {
  if (!clockFace) return;
  const values = clockStep === "hour"
    ? Array.from({length:12}, (_,i) => String(i + 1))
    : Array.from({length:12}, (_,i) => String(i * 5).padStart(2,"0"));
  clockFace.innerHTML = values.map((value,index) => {
    const active = clockStep === "hour"
      ? Number(selectedClockHour) === Number(value)
      : Number(selectedClockMinute) === Number(value);
    return `<button type="button" class="clock-number ${active ? "selected" : ""}" data-clock-value="${value}" style="--clock-angle:${index * 30}deg">${value}</button>`;
  }).join("");
  clockFace.querySelectorAll("[data-clock-value]").forEach(button => {
    button.addEventListener("click", () => {
      if (clockStep === "hour") {
        selectedClockHour = button.dataset.clockValue.padStart(2,"0");
        clockStep = "minute";
      } else {
        selectedClockMinute = button.dataset.clockValue;
      }
      syncClockDisplay();
    });
  });
}
function syncClockDisplay() {
  if (clockHourDisplay) clockHourDisplay.textContent = selectedClockHour || "--";
  if (clockMinuteDisplay) clockMinuteDisplay.textContent = selectedClockMinute === "" ? "--" : selectedClockMinute;
  clockHourDisplay?.classList.toggle("active", clockStep === "hour");
  clockMinuteDisplay?.classList.toggle("active", clockStep === "minute");
  if (clockStepLabel) clockStepLabel.textContent = clockStep === "hour" ? "Select hour" : "Select minute";
  clockPeriodButtons?.forEach(button => {
    const active = button.dataset.period === selectedClockPeriod;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderClockFace();
}
function syncClockPickerFromValue(value) {
  if (!clockPicker) return;
  if (!value) {
    selectedClockHour = "";
    selectedClockMinute = "";
    selectedClockPeriod = "AM";
  } else {
    const match = String(value).match(/^(\\d{2}):(\\d{2})$/);
    if (!match) return;
    const hour24 = Number(match[1]);
    selectedClockHour = String(hour24 % 12 || 12).padStart(2,"0");
    selectedClockMinute = match[2];
    selectedClockPeriod = hour24 >= 12 ? "PM" : "AM";
  }
  if (clockTriggerText) clockTriggerText.textContent = clockDisplayText();
  syncClockDisplay();
}
function closeClockPicker() {
  if (clockPopover) clockPopover.hidden = true;
  clockTrigger?.setAttribute("aria-expanded","false");
}
function openClockPicker() {
  savedClockValue = $("timeSearch")?.value || "";
  syncClockPickerFromValue(savedClockValue);
  clockStep = selectedClockHour ? "minute" : "hour";
  if (clockPopover) clockPopover.hidden = false;
  clockTrigger?.setAttribute("aria-expanded","true");
  syncClockDisplay();
}
clockTrigger?.addEventListener("click", () => {
  if (clockPopover?.hidden) openClockPicker();
  else closeClockPicker();
});
clockHourDisplay?.addEventListener("click", () => { clockStep = "hour"; syncClockDisplay(); });
clockMinuteDisplay?.addEventListener("click", () => { clockStep = "minute"; syncClockDisplay(); });
clockPeriodButtons?.forEach(button => button.addEventListener("click", () => {
  selectedClockPeriod = button.dataset.period;
  syncClockDisplay();
}));
$("clockClear")?.addEventListener("click", () => {
  selectedClockHour = "";
  selectedClockMinute = "";
  selectedClockPeriod = "AM";
  clockStep = "hour";
  syncClockDisplay();
});
$("clockCancel")?.addEventListener("click", () => {
  syncClockPickerFromValue(savedClockValue);
  closeClockPicker();
});
$("clockDone")?.addEventListener("click", () => {
  if (!selectedClockHour || selectedClockMinute === "") {
    clockStep = selectedClockHour ? "minute" : "hour";
    syncClockDisplay();
    return;
  }
  let hour24 = Number(selectedClockHour) % 12;
  if (selectedClockPeriod === "PM") hour24 += 12;
  $("timeSearch").value = String(hour24).padStart(2,"0") + ":" + selectedClockMinute;
  selectedTimePeriod = selectedClockPeriod;
  if ($("timeHour")) $("timeHour").value = String(Number(selectedClockHour));
  if ($("timeMinute")) $("timeMinute").value = selectedClockMinute;
  updateSearchWindowRange();
  if (clockTriggerText) clockTriggerText.textContent = clockDisplayText();
  closeClockPicker();
});
document.addEventListener("click", event => {
  if (clockPicker && !clockPicker.contains(event.target)) closeClockPicker();
});
function updateSearchWindowRange() {
  const output = $("searchWindowRange");
  if (!output) return;
  const target = toMinutes($("timeSearch")?.value || "");
  const selectedWindow = Number($("timeWindowOptions")?.querySelector('[aria-pressed="true"]')?.dataset.window || 0);
  if (target === null || !selectedWindow) {
    output.textContent = "";
    output.hidden = true;
    return;
  }
  output.textContent = formatClockTime(target - selectedWindow) + " - " + formatClockTime(target + selectedWindow);
  output.hidden = false;
}

function formatClockTime(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60), minute = normalized % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  return (hour24 % 12 || 12) + ":" + String(minute).padStart(2, "0") + " " + period;
}
function formatSearchTimeTitle(time, windowMinutes) {
  const target = toMinutes(time);
  if (target === null) return "Bus time results";
  if (!windowMinutes) return "Buses at " + formatClockTime(target);
  return "Buses between " + formatClockTime(target - windowMinutes) + " and " + formatClockTime(target + windowMinutes);
}

function toMinutes(value) {
  if (!value) return null;

  const text = String(value).trim().toUpperCase();
  if (text === "UNKNOWN") return null;

  const match = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3];

  if (minutes > 59) return null;

  if (period) {
    if (hours < 1 || hours > 12) return null;
    if (period === "PM" && hours < 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;
  } else if (hours > 23) {
    return null;
  }

  return hours * 60 + minutes;
}

function timeDifference(a, b) {
  const difference = Math.abs(a - b);
  return Math.min(difference, 1440 - difference);
}

/* =========================================
   DIRECTION MATCHING
========================================= */

function directionMatches(rowDirection, selectedDirection) {
  if (!selectedDirection) return true;

  const direction = normalize(rowDirection).toUpperCase();

  if (selectedDirection === "UP") {
    return direction.includes("UP") &&
      !direction.includes("DOWN");
  }

  if (selectedDirection === "DOWN") {
    return direction.includes("DOWN");
  }

  return true;
}

/* =========================================
   RENDER RESULTS
========================================= */

function renderRows(rows, title) {
  const titleElement = $("resultTitle");
  if (titleElement) titleElement.textContent = title;

  if (!rows.length) {
    showEmpty(
      title,
      "No matching schedule was found. Try another bus name, stopage, time or direction."
    );
    return;
  }

  if (!results) return;

  results.className = "results";

  results.innerHTML = rows.map(row => {
    const bus = row.bus_name || "Bus name unavailable";
    const stop = row.stopage || row.stopage_name || "Stopage unavailable";
    const direction = row.direction || "Direction unavailable";
    const time = row.trip_time || "Time unavailable";
    const favorite = isFavorite(bus);

    return `
      <div class="result-row">
        <div>
          <strong>${escapeHtml(bus)}</strong>
          <small>${escapeHtml(stop)} · ${escapeHtml(direction)}</small>
        </div>

        <div class="result-actions">
          <div class="time">${escapeHtml(time)}</div>

          <button
            type="button"
            class="favorite-button ${favorite ? "active" : ""}"
            data-bus="${escapeHtml(bus)}"
            aria-label="${favorite ? "Remove favorite" : "Add favorite"}"
            title="${favorite ? "Remove favourite" : "Add favourite"}"
          >
            ${favorite ? "★" : "☆"}
          </button>
        </div>
      </div>
    `;
  }).join("");

  results.querySelectorAll(".favorite-button").forEach(button => {
    button.addEventListener("click", () => {
      toggleFavorite(button.dataset.bus);
    });
  });
}

/* =========================================
   TIME WINDOW SELECTOR
========================================= */

function setTimeWindow(value) {
  const selected = Number(value) || 0;
  const container = $("timeWindowOptions");
  if (!container) return;

  container.querySelectorAll(".time-window-btn").forEach(button => {
    const active = Number(button.dataset.window) === selected && selected !== 0;
    button.setAttribute("aria-pressed", String(active));
    button.classList.toggle("active", active);
  });
  updateSearchWindowRange();
}

$("timeWindowOptions")?.addEventListener("click", event => {
  const button = event.target.closest(".time-window-btn");
  if (!button) return;

  const current = Number($("timeWindowOptions").querySelector('[aria-pressed="true"]')?.dataset.window || 0);
  const next = Number(button.dataset.window);
  setTimeWindow(current === next ? 0 : next);
});

// Start with ±15 minutes selected; users can deselect it or choose another range.
setTimeWindow(15);

/* =========================================
   MAIN SEARCH
========================================= */

function runSearch() {
  if (!databaseLoaded || !scheduleRows.length) {
    showEmpty(
      "Database not loaded",
      "Please wait for the database connection or try again."
    );
    return;
  }

  hideSuggestions("busSearch");
  hideSuggestions("stopSearch");

  const bus = $("busSearch")?.value.trim() || "";
  const stop = $("stopSearch")?.value.trim() || "";
  const direction = $("direction")?.value || "";
  const time = $("timeSearch")?.value || "";
  const timeWindow = Number($("timeWindowOptions")?.querySelector('[aria-pressed="true"]')?.dataset.window || 0);

  // Direction is only a filter; it cannot be used as the sole search query.
  if (!bus && !stop && !time) {
    showEmpty(
      "Add a search detail",
      "Select a bus name, enter a stopage/location or choose a time. UP/DOWN direction alone is not enough to show results."
    );
    return;
  }

  let rows = scheduleRows.filter(row => {
    const busName = row.bus_name || "";
    const stopName = row.stopage || row.stopage_name || "";

    const busMatch = !bus || getMatchScore(bus, busName) > 0;
    const stopCandidates = [
      row.stopage,
      row.stopage_name,
      row.stop_name,
      row.stop
    ].filter(Boolean);
    const stopMatch = !stop || stopCandidates.some(name =>
      getMatchScore(stop, name) > 0 ||
      searchNormalize(name).includes(searchNormalize(stop))
    );
    const directionMatch = directionMatches(row.direction, direction);

    return busMatch && stopMatch && directionMatch;
  });

  if (time) {
    const target = toMinutes(time);

    if (target === null) {
      showEmpty("Invalid time", "Please enter a valid time.");
      return;
    }

    rows = rows.filter(row => {
      const rowTime = toMinutes(row.trip_time);

      return rowTime !== null &&
        timeDifference(rowTime, target) <= timeWindow;
    });

    rows.sort((a, b) => {
      return timeDifference(toMinutes(a.trip_time), target) -
        timeDifference(toMinutes(b.trip_time), target);
    });
  }

  let title = "Matching buses";

  if (time) {
    title = formatSearchTimeTitle(time, timeWindow);
  } else if (bus && stop) {
    title = "Bus and stopage results";
  } else if (bus) {
    title = "Bus name results";
  } else if (stop) {
    title = "Stopage results";
  } else if (direction) {
    title = direction === "UP" ? "Up Trip Buses" : "Down Trip Buses";
  }

  saveRecentSearch(bus, stop, direction, time, timeWindow);
  renderRows(rows, title);

  $("results-section")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

/* =========================================
   QUICK SEARCH CARDS
========================================= */

document.querySelectorAll(".quick-card").forEach(button => {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode;

    if (mode === "near") {
      $("timeHour")?.focus();

      if ($("resultTitle")) {
        $("resultTitle").textContent = "Buses within ±30 minutes";
      }
    } else if (mode === "direction") {
      $("direction")?.focus();
    } else if (mode === "where") {
      $("search-section")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });

      window.setTimeout(() => {
        $("busSearch")?.focus();
      }, 350);
      return;
    } else {
      $("stopSearch")?.focus();
    }

    $("search-section")?.scrollIntoView({
      behavior: "smooth"
    });
  });
});

/* =========================================
   PWA INSTALLATION
========================================= */

const installButton = $("installBtn");

function isAppInstalled() {
  return (
    (window.matchMedia &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true
  );
}

function updateInstallButton() {
  if (!installButton) return;

  installButton.hidden = isAppInstalled() ? true : false;
}

updateInstallButton();

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredPrompt = event;
  updateInstallButton();
});

installButton?.addEventListener("click", async () => {
  if (isAppInstalled()) {
    installButton.hidden = true;
    return;
  }

  if (!deferredPrompt) {
    alert(
      "To install DU BUS FINDER:\n\n" +
      "Open your browser menu and select 'Install app' or 'Add to Home Screen'."
    );
    return;
  }

  try {
    await deferredPrompt.prompt();

    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;

    if (choice?.outcome === "accepted") {
      installButton.hidden = true;
    }
  } catch (error) {
    console.error("PWA installation error:", error);
  }
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;

  if (installButton) {
    installButton.hidden = true;
  }
});

/* =========================================
   SERVICE WORKER
========================================= */

if (
  "serviceWorker" in navigator &&
  location.protocol.startsWith("http")
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .catch(error => {
        console.warn("Service Worker registration failed:", error);
      });
  });
}

/* =========================================
   ERROR HANDLING
========================================= */

window.addEventListener("error", event => {
  console.error("JavaScript error:", event.message);
});

window.addEventListener("unhandledrejection", event => {
  console.error("Unhandled promise rejection:", event.reason);
});

/* =========================================
   SEARCH + DIRECTION CONTROL EVENTS
========================================= */

function setDirection(value) {
  const selected = value === "DOWN" ? "DOWN" : "UP";
  const nativeSelect = $("direction");
  const currentButton = $("directionCurrent");
  const options = $("directionOptions");

  if (nativeSelect) nativeSelect.value = selected;
  if (currentButton) {
    currentButton.textContent = selected;
    currentButton.setAttribute("aria-expanded", "false");
  }
  if (options) options.hidden = true;
}

function toggleDirectionOptions(forceOpen) {
  const options = $("directionOptions");
  const currentButton = $("directionCurrent");
  if (!options || !currentButton) return;

  const shouldOpen = typeof forceOpen === "boolean"
    ? forceOpen
    : options.hidden;

  options.hidden = !shouldOpen;
  currentButton.setAttribute("aria-expanded", String(shouldOpen));
}

$("directionCurrent")?.addEventListener("click", event => {
  event.preventDefault();
  event.stopPropagation();
  toggleDirectionOptions();
});

$("directionOptions")?.querySelectorAll("[data-direction]").forEach(button => {
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    setDirection(button.dataset.direction);
  });
});

$("directionSwitch")?.addEventListener("click", event => {
  event.preventDefault();
  event.stopPropagation();

  const current = $("direction")?.value || "UP";
  setDirection(current === "UP" ? "DOWN" : "UP");
});

$("direction")?.addEventListener("change", event => {
  setDirection(event.target.value);
});

document.addEventListener("click", event => {
  const picker = $("directionPicker");
  if (picker && !picker.contains(event.target)) {
    toggleDirectionOptions(false);
  }
});

$("searchBtn")?.addEventListener("click", runSearch);

["busSearch", "stopSearch", "timeHour", "timeMinute"].forEach(id => {
  $(id)?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      runSearch();
    }
  });
});

/* =========================================
   INITIALIZATION
========================================= */

setDirection($("direction")?.value || "UP");

setupSuggestions("busSearch", getBusNames);
setupSuggestions("stopSearch", getStopNames);

renderFavoriteSection();
renderRecentSection();

loadDatabase();
