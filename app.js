
/* =========================================
   DU BUS FINDER
   Smart Search + Offline + Theme + Favorites
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

let deferredPrompt;
let databaseLoading = false;
let databaseLoaded = false;

let suggestionPanels = {};

const $ = id => document.getElementById(id);
const results = $("results");


/* =========================================
   THEME SYSTEM
========================================= */

function applyTheme(theme) {
  const selectedTheme =
    theme === "dark" ? "dark" : "light";

  document.documentElement.dataset.theme = selectedTheme;

  try {
    localStorage.setItem(THEME_KEY, selectedTheme);
  } catch (error) {
    console.warn("Theme preference could not be saved.", error);
  }

  const themeIcon = document.querySelector(".theme-icon");
  const themeButton = $("themeToggle");

  if (themeIcon) {
    themeIcon.textContent =
      selectedTheme === "dark" ? "☀" : "☾";
  }

  if (themeButton) {
    themeButton.setAttribute(
      "aria-label",
      selectedTheme === "dark"
        ? "Switch to light mode"
        : "Switch to dark mode"
    );
  }
}

function initializeTheme() {
  let savedTheme = null;

  try {
    savedTheme = localStorage.getItem(THEME_KEY);
  } catch (error) {
    console.warn("Could not read saved theme.", error);
  }

  if (!savedTheme) {
    savedTheme = window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  applyTheme(savedTheme);
}

const themeToggle = $("themeToggle");

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const current =
      document.documentElement.dataset.theme || "light";

    applyTheme(current === "dark" ? "light" : "dark");
  });
}

initializeTheme();


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
}

function showEmpty(title, message) {
  const titleElement = $("resultTitle");

  if (titleElement) {
    titleElement.textContent = title;
  }

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

  if (titleElement) {
    titleElement.textContent = title;
  }

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
   LOCAL STORAGE HELPERS
========================================= */

function readLocalArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function saveLocalArray(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error("Could not save local preference:", error);
    return false;
  }
}


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

  if (databaseLoaded) {
    const busInput = $("busSearch");

    if (busInput && busInput.value.trim() === busName) {
      runSearch();
    }
  }
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
          <span>★</span>
          ${escapeHtml(name)}
        </button>
      `).join("")}
    </div>
  `;

  section.querySelectorAll("[data-favorite-bus]").forEach(button => {
    button.addEventListener("click", () => {
      $("busSearch").value = button.dataset.favoriteBus;
      runSearch();
      $("search-section")?.scrollIntoView({ behavior: "smooth" });
    });
  });
}


/* =========================================
   RECENT SEARCHES
========================================= */

function getRecentSearches() {
  return readLocalArray(RECENT_KEY);
}

function saveRecentSearch(bus, stop, direction, time) {
  const item = {
    bus,
    stop,
    direction,
    time,
    label: [
      bus,
      stop,
      direction,
      time
    ].filter(Boolean).join(" · ")
  };

  if (!item.label) return;

  let recent = getRecentSearches();

  recent = recent.filter(old =>
    old.label !== item.label
  );

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
          <span>◷</span>
          ${escapeHtml(item.label)}
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
      $("direction").value = item.direction || "";
      $("timeSearch").value = item.time || "";

      runSearch();

      $("search-section")?.scrollIntoView({ behavior: "smooth" });
    });
  });

  section.querySelector(".clear-recent")?.addEventListener("click", () => {
    saveLocalArray(RECENT_KEY, []);
    renderRecentSection();
  });
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
  "ং":"ng","ঃ":"h","ঁ":"n",
  "ৎ":"t","্":""
};

function transliterateBangla(value) {
  return [...String(value ?? "")]
    .map(char => banglaMap[char] ?? char)
    .join("");
}


/* =========================================
   SEARCH NORMALIZATION
========================================= */

function searchNormalize(value) {
  let text = normalize(value);

  text = transliterateBangla(text);
  text = text.replace(/[^a-z0-9]/g, "");

  text = text
    .replace(/sh/g, "s")
    .replace(/chh/g, "ch")
    .replace(/ch/g, "c")
    .replace(/ph/g, "f")
    .replace(/bh/g, "b")
    .replace(/v/g, "b")
    .replace(/w/g, "b")
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

  return text;
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
    let current = [i];

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

  const distance = levenshtein(a, b);

  return 1 - distance / Math.max(a.length, b.length);
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
      serviceDays: Array.isArray(data.serviceDays)
        ? data.serviceDays
        : [],
      savedAt: Date.now()
    };

    localStorage.setItem(
      DB_CACHE_KEY,
      JSON.stringify(backup)
    );

    return true;

  } catch (error) {
    console.error("Local database save failed:", error);
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
      !Array.isArray(data.schedules) ||
      data.schedules.length === 0
    ) {
      return null;
    }

    return data;

  } catch (error) {
    console.error("Local database read failed:", error);
    return null;
  }
}


/* =========================================
   APPLY DATABASE
========================================= */

function applyDatabase(data, source) {
  busRows = data.buses;
  stopRows = data.stops;
  scheduleRows = data.schedules;

  serviceDayRows = Array.isArray(data.serviceDays)
    ? data.serviceDays
    : [];

  databaseLoaded = true;

  const total =
    `${busRows.length} buses, ` +
    `${stopRows.length} stopages and ` +
    `${scheduleRows.length} schedule entries`;

  if (source === "online") {
    setStatus(
      `${scheduleRows.length} schedule rows loaded`,
      true
    );

    showEmpty(
      "Database connected!",
      `${total} loaded successfully. Search for a bus or stopage.`
    );

  } else {
    setStatus(
      `Offline database ready · ${scheduleRows.length} schedules`,
      true
    );

    showEmpty(
      "Offline mode active",
      `${total} available from your saved database. You can search without internet.`
    );
  }

  renderFavoriteSection();
  renderRecentSection();
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

      setStatus("No saved offline database");

      showConnectionError(
        "Offline database unavailable",
        "Connect to the internet once to download the complete bus database."
      );
    }

    return;
  }

  if (!API_URL || API_URL.includes("PASTE_YOUR")) {
    if (!cachedData) {
      databaseLoaded = false;

      setStatus("API URL not configured");

      showConnectionError(
        "API URL missing",
        "Please configure your Google Apps Script API URL."
      );
    }

    return;
  }

  databaseLoading = true;

  if (!cachedData) {
    databaseLoaded = false;
    setStatus("Connecting to database...");
  } else {
    setStatus(
      "Saved database active · Checking for updates...",
      true
    );
  }

  const callbackName =
    "duBusCallback_" + Date.now() + "_" +
    Math.floor(Math.random() * 10000);

  const script = document.createElement("script");

  let completed = false;
  let timeout;

  function cleanup() {
    delete window[callbackName];

    script.remove();

    if (timeout) clearTimeout(timeout);

    databaseLoading = false;
  }

  function fail(title, message, statusMessage) {
    if (completed) return;

    completed = true;
    cleanup();

    if (cachedData) {
      applyDatabase(cachedData, "offline");

      setStatus(
        "Saved database active · Online update unavailable",
        true
      );

    } else {
      databaseLoaded = false;

      setStatus(statusMessage);

      showConnectionError(title, message);
    }
  }

  timeout = setTimeout(() => {
    fail(
      "Connection timed out",
      "The online database did not respond. Saved database will be used if available.",
      "Connection timed out"
    );
  }, 20000);

  window[callbackName] = function(data) {
    if (completed) return;

    if (
      !data ||
      data.success !== true ||
      !Array.isArray(data.buses) ||
      !Array.isArray(data.stops) ||
      !Array.isArray(data.schedules) ||
      data.schedules.length === 0
    ) {
      fail(
        "Database error",
        data?.error || "The online database returned invalid data.",
        "Database error"
      );

      return;
    }

    completed = true;
    cleanup();

    const saved = saveDatabaseLocally(data);

    applyDatabase(data, "online");

    if (!saved) {
      setStatus(
        "Online database connected · Offline saving failed"
      );
    }
  };

  script.onerror = () => {
    fail(
      "Connection failed",
      "Could not connect to the online database. Saved database will be used if available.",
      "API connection failed"
    );
  };

  script.src = API_URL +
    "?action=all&callback=" +
    encodeURIComponent(callbackName);

  document.body.appendChild(script);
}

window.addEventListener("online", loadDatabase);

window.addEventListener("offline", () => {
  const saved = getLocalDatabase();

  if (saved) {
    applyDatabase(saved, "offline");
  } else {
    databaseLoaded = false;

    setStatus("No saved offline database");

    showConnectionError(
      "Offline database unavailable",
      "Connect to the internet once to save the bus database."
    );
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
   SMART MATCH
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


/* =========================================
   LIVE SUGGESTIONS
========================================= */

function createSuggestionPanel(inputId) {
  const input = $(inputId);

  if (!input) return null;

  const panel = document.createElement("div");

  panel.className = "suggestion-panel";

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
   TIME CONVERSION
========================================= */

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
  } else {
    if (hours > 23) return null;
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
  if ($("resultTitle")) {
    $("resultTitle").textContent = title;
  }

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

  let rows = scheduleRows.filter(row => {
    const busName = row.bus_name || "";
    const stopName = row.stopage || row.stopage_name || "";

    const busMatch =
      !bus || getMatchScore(bus, busName) > 0;

    const stopMatch =
      !stop || getMatchScore(stop, stopName) > 0;

    const directionMatch =
      directionMatches(row.direction, direction);

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
        timeDifference(rowTime, target) <= 30;
    });

    rows.sort((a, b) => {
      const timeA = toMinutes(a.trip_time);
      const timeB = toMinutes(b.trip_time);

      return timeDifference(timeA, target) -
        timeDifference(timeB, target);
    });
  }

  let title = "Matching buses";

  if (bus && stop) {
    title = "Bus and stopage results";
  } else if (bus) {
    title = "Bus name results";
  } else if (stop) {
    title = "Stopage results";
  } else if (time) {
    title = "Buses within ±30 minutes";
  } else if (direction) {
    title = direction === "UP"
      ? "Up Trip Buses"
      : "Down Trip Buses";
  }

  saveRecentSearch(bus, stop, direction, time);

  renderRows(rows, title);

  $("results-section")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}


/* =========================================
   SEARCH EVENTS
========================================= */

$("searchBtn")?.addEventListener("click", runSearch);

["busSearch", "stopSearch"].forEach(id => {
  $(id)?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      hideSuggestions(id);
      runSearch();
    }
  });
});

$("timeSearch")?.addEventListener("keydown", event => {
  if (event.key === "Enter") runSearch();
});


/* =========================================
   QUICK SEARCH CARDS
========================================= */

document.querySelectorAll(".quick-card").forEach(button => {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode;

    if (mode === "near") {
      $("timeSearch")?.focus();

      if ($("resultTitle")) {
        $("resultTitle").textContent =
          "Buses within ±30 minutes";
      }

    } else if (mode === "direction") {
      $("direction")?.focus();

    } else if (mode === "where") {
      showEmpty(
        "Scheduled bus position",
        "This feature needs reliable stop-wise times. It will show an estimate, never live GPS."
      );

      $("results-section")?.scrollIntoView({
        behavior: "smooth"
      });

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

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();

  deferredPrompt = event;

  const installButton = $("installBtn");

  if (installButton) {
    installButton.hidden = false;
  }
});

$("installBtn")?.addEventListener("click", async () => {
  if (!deferredPrompt) return;

  try {
    await deferredPrompt.prompt();
    deferredPrompt = null;

    $("installBtn").hidden = true;

  } catch (error) {
    console.error("PWA installation error:", error);
  }
});


/* =========================================
   SERVICE WORKER
========================================= */

if (
  "serviceWorker" in navigator &&
  location.protocol.startsWith("http")
) {
  navigator.serviceWorker.register("./sw.js")
    .catch(error => {
      console.warn(
        "Service Worker registration failed:",
        error
      );
    });
}


/* =========================================
   GLOBAL ERROR HANDLING
========================================= */

window.addEventListener("error", event => {
  console.error("JavaScript error:", event.message);
});

window.addEventListener("unhandledrejection", event => {
  console.error("Unhandled promise rejection:", event.reason);
});


/* =========================================
   INITIALIZATION
========================================= */

setupSuggestions("busSearch", getBusNames);
setupSuggestions("stopSearch", getStopNames);

renderFavoriteSection();
renderRecentSection();

loadDatabase();
