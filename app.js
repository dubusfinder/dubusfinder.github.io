
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
  renderBusDirectory();

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
   BUS DIRECTORY + BUS DETAILS
========================================= */

function getBusScheduleRows(busName) {
  const target = normalize(busName);
  return scheduleRows.filter(row =>
    normalize(row.bus_name) === target
  );
}

function getBusTripGroups(busName) {
  const rows = getBusScheduleRows(busName);
  const groups = new Map();

  rows.forEach(row => {
    const tripId = String(row.trip_id || "").trim();
    const fallbackKey = [
      normalize(row.direction),
      normalize(row.trip_time)
    ].join("|");
    const key = tripId || fallbackKey;

    if (!groups.has(key)) {
      groups.set(key, {
        trip_id: tripId,
        direction: row.direction || "Direction unavailable",
        trip_time: row.trip_time || "Time unavailable",
        stops: []
      });
    }

    groups.get(key).stops.push(row);
  });

  return [...groups.values()]
    .map(group => {
      const sequenceNumbers = group.stops.map(row =>
        Number(String(row.sequence ?? "").trim())
      );
      const sequenceVerified =
        group.stops.every(row => {
          const value = String(row.sequence ?? "").trim();
          return value !== "" && Number.isInteger(Number(value)) && Number(value) > 0;
        }) &&
        new Set(sequenceNumbers).size === sequenceNumbers.length;

      // Keep source row order when any sequence is unknown; never infer a route order.
      const stops = sequenceVerified
        ? group.stops.slice().sort((a, b) => Number(a.sequence) - Number(b.sequence))
        : group.stops.slice();

      return { ...group, stops, sequenceVerified };
    })
    .sort((a, b) => {
      const directionOrder = normalize(a.direction).localeCompare(normalize(b.direction));
      if (directionOrder) return directionOrder;
      return toMinutes(a.trip_time) - toMinutes(b.trip_time);
    });
}

function safeBusImageUrl(value) {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

function renderBusDirectory(filterText = "") {
  const grid = $("busDirectoryGrid");
  const count = $("busDirectoryCount");
  if (!grid) return;

  if (!databaseLoaded) {
    grid.innerHTML = '<div class="bus-directory-empty">Connecting to bus database...</div>';
    if (count) count.textContent = "Loading buses...";
    return;
  }

  const directory = busRows
    .map(bus => ({
      ...bus,
      bus_name: String(bus.bus_name || bus.name || "").trim()
    }))
    .filter(bus => bus.bus_name)
    .filter((bus, index, all) =>
      all.findIndex(item => normalize(item.bus_name) === normalize(bus.bus_name)) === index
    );

  const filtered = directory.filter(bus =>
    !filterText || getMatchScore(filterText, bus.bus_name) > 0
  );

  if (count) {
    count.textContent = filterText
      ? filtered.length + " of " + directory.length + " buses"
      : directory.length + " buses";
  }

  if (!filtered.length) {
    grid.innerHTML = '<div class="bus-directory-empty">No bus found. Try another name.</div>';
    return;
  }

  grid.innerHTML = filtered.map(bus => {
    const trips = getBusTripGroups(bus.bus_name);
    const stopCount = new Set(
      getBusScheduleRows(bus.bus_name).map(row =>
        normalize(row.stopage || row.stopage_name)
      ).filter(Boolean)
    ).size;
    const imageUrl = safeBusImageUrl(bus.bus_image_url);

    return `
      <button type="button" class="bus-directory-card" data-directory-bus="${escapeHtml(bus.bus_name)}">
        <span class="bus-directory-image">
          <span class="bus-directory-image-fallback">🚌</span>
          ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(bus.bus_name)}" loading="lazy">` : ""}
        </span>
        <span class="bus-directory-card-body">
          <strong>${escapeHtml(bus.bus_name)}</strong>
          <small>${trips.length} trips · ${stopCount} stopages</small>
          <span class="bus-directory-open">View routes <span aria-hidden="true">→</span></span>
        </span>
      </button>
    `;
  }).join("");

  grid.querySelectorAll("[data-directory-bus]").forEach(button => {
    button.addEventListener("click", () => {
      openBusDetails(button.dataset.directoryBus);
    });
  });
}

function renderBusDirectorySuggestions(filterText = "") {
  const dropdown = $("busDirectorySuggestions");
  const input = $("busDirectorySearch");
  if (!dropdown || !input) return;

  const query = String(filterText || "").trim();
  if (!query || !databaseLoaded) {
    dropdown.hidden = true;
    input.setAttribute("aria-expanded", "false");
    return;
  }

  const directory = busRows
    .map(bus => String(bus.bus_name || bus.name || "").trim())
    .filter(Boolean)
    .filter((name, index, all) =>
      all.findIndex(item => normalize(item) === normalize(name)) === index
    );

  const matches = directory
    .map(name => ({ name, score: getMatchScore(query, name) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 8);

  dropdown.innerHTML = matches.length
    ? matches.map(item => `
        <button type="button" data-bus-suggestion="${escapeHtml(item.name)}">
          <strong>${escapeHtml(item.name)}</strong>
          <small>Open bus details →</small>
        </button>
      `).join("")
    : '<div class="bus-directory-empty">No matching bus found.</div>';

  dropdown.hidden = false;
  input.setAttribute("aria-expanded", "true");

  dropdown.querySelectorAll("[data-bus-suggestion]").forEach(button => {
    button.addEventListener("click", () => {
      const name = button.dataset.busSuggestion;
      input.value = "";
      dropdown.hidden = true;
      input.setAttribute("aria-expanded", "false");
      renderBusDirectory("");
      openBusDetails(name);
    });
  });
}

function openBusDetails(busName) {
  publicRouteObservers.forEach(observer => observer.disconnect());
  publicRouteObservers.clear();
  publicRouteMaps.forEach(map => map.remove());
  publicRouteMaps.clear();
  contributionMapStates.forEach(state => state.map.remove());
  contributionMapStates.clear();

  const directoryView = $("busDirectoryView");
  const detailsView = $("busDetailsView");
  const content = $("busDetailsContent");
  if (!directoryView || !detailsView || !content) return;

  const bus = busRows.find(item =>
    normalize(item.bus_name || item.name) === normalize(busName)
  ) || { bus_name: busName };

  const suggestions = $("busDirectorySuggestions");
  if (suggestions) suggestions.hidden = true;
  $("busDirectorySearch")?.setAttribute("aria-expanded", "false");

  const imageUrl = safeBusImageUrl(bus.bus_image_url);
  const trips = getBusTripGroups(busName);

  directoryView.hidden = true;
  detailsView.hidden = false;

  content.innerHTML = `
    <div class="bus-details-header">
      <div class="bus-details-image">
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(busName)}">` : '<span>🚌</span>'}
      </div>
      <div>
        <span class="section-label">BUS DETAILS</span>
        <h2>${escapeHtml(busName)}</h2>
        <p>${trips.length} trips · ${getBusScheduleRows(busName).length} schedule entries</p>
      </div>
    </div>
    <div class="bus-trip-list">
      ${trips.length ? trips.map((trip, index) => {
        const days = [...new Set(serviceDayRows
          .filter(day => String(day.trip_id || "").trim() === trip.trip_id && trip.trip_id)
          .map(day => String(day.operating_day || "").trim())
          .filter(Boolean))];
        return `
          <article class="bus-trip-card">
            <div class="bus-trip-heading">
              <span class="bus-trip-direction">${escapeHtml(trip.direction)}</span>
              <strong>${escapeHtml(trip.trip_time)}</strong>
            </div>
            ${days.length ? `<div class="bus-trip-days">Operating days: ${escapeHtml(days.join(", "))}</div>` : ""}
            <ol class="bus-route-stops">
              ${trip.stops.map(stop => {
                const sequence = String(stop.sequence ?? "").trim();
                const sequenceLabel = trip.sequenceVerified ? "#" + sequence : "Sequence unverified";
                const timeLabel = String(stop.stopage_time || "").trim();
                return `
                  <li>
                    <span class="bus-route-stop-name">${escapeHtml(stop.stopage || stop.stopage_name || "Stopage unavailable")} <small>${escapeHtml(sequenceLabel)}</small></span>
                    <span class="bus-route-stop-time ${timeLabel ? "" : "unknown"}">${timeLabel ? escapeHtml(timeLabel) : "Not recorded"}</span>
                  </li>
                `;
              }).join("")}
            </ol>
            <div class="bus-route-map-wrap">
              <div class="bus-route-map" id="bus-route-map-${index}" aria-label="Route map for ${escapeHtml(trip.direction)} trip"></div>
              <p class="bus-route-map-note" id="bus-route-map-note-${index}"></p>
            </div>
            <div class="bus-route-actions">
              <button type="button" class="bus-contribute-button" data-open-contribution="${index}" ${trip.trip_id ? "" : "disabled"}>Suggest a route or time correction</button>
            </div>
            <div id="contribution-panel-${index}" hidden></div>
          </article>
        `;
      }).join("") : '<div class="bus-directory-empty">No trip schedule is available for this bus yet.</div>'}
    </div>
  `;

  trips.forEach((trip, index) => {
    initializePublicRouteMap(
      $("bus-route-map-" + index),
      $("bus-route-map-note-" + index),
      trip
    );
  });

  content.querySelectorAll("[data-open-contribution]").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.openContribution);
      const panel = $("contribution-panel-" + index);
      if (!panel) return;
      if (!panel.innerHTML.trim()) {
        openContributionPanel(busName, trips[index], index);
      } else {
        panel.hidden = !panel.hidden;
        if (!panel.hidden) {
          panel.querySelectorAll(".contribution-map").forEach(mapElement => {
            const mapState = contributionMapStates.get(mapElement.dataset.entryKey);
            if (mapState) setTimeout(() => mapState.map.invalidateSize(), 100);
          });
        }
      }
    });
  });

  $("bus-directory")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

$("busDirectorySearch")?.addEventListener("input", event => {
  const query = event.target.value.trim();
  renderBusDirectory(query);
  renderBusDirectorySuggestions(query);
});

$("busDirectorySearch")?.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    const dropdown = $("busDirectorySuggestions");
    if (dropdown) dropdown.hidden = true;
    event.target.setAttribute("aria-expanded", "false");
  }
});

document.addEventListener("click", event => {
  if (event.target.closest(".bus-directory-toolbar")) return;
  const dropdown = $("busDirectorySuggestions");
  const input = $("busDirectorySearch");
  if (dropdown) dropdown.hidden = true;
  if (input) input.setAttribute("aria-expanded", "false");
});

document.querySelector("[data-open-bus-directory]")?.addEventListener("click", () => {
  setTimeout(() => $("busDirectorySearch")?.focus(), 250);
});

$("backToBusDirectory")?.addEventListener("click", () => {
  $("busDetailsView").hidden = true;
  $("busDirectoryView").hidden = false;
  $("bus-directory")?.scrollIntoView({ behavior: "smooth", block: "start" });
});


/* =========================================
   PUBLIC ROUTE MAPS + COMMUNITY CONTRIBUTIONS
========================================= */

const contributionMapStates = new Map();
const publicRouteMaps = new Set();
const publicRouteObservers = new Set();
let contributionEntryCounter = 0;
let lastGeocodeRequestAt = 0;

function findStopRecordForScheduleRow(row) {
  const stopId = String(row?.stop_id || "").trim();
  if (stopId) {
    const byId = stopRows.filter(stop =>
      String(stop.stop_id || "").trim() === stopId
    );
    if (byId.length === 1) return byId[0];
  }
  const name = normalize(row?.stopage || row?.stopage_name).replace(/\s+/g, " ");
  if (!name) return null;
  const byName = stopRows.filter(stop =>
    normalize(stop.stopage_name || stop.stopage || "").replace(/\s+/g, " ") === name
  );
  return byName.length === 1 ? byName[0] : null;
}

function getVerifiedCoordinates(record) {
  if (!record) return null;
  const latText = String(record.latitude ?? "").trim();
  const lngText = String(record.longitude ?? "").trim();
  if (!latText || !lngText) return null;
  const lat = Number(latText);
  const lng = Number(lngText);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function initializePublicRouteMap(mapElement, noteElement, trip) {
  if (!mapElement) return;

  const renderMap = () => {
  const points = trip.stops.map(row => {
    const stop = findStopRecordForScheduleRow(row);
    return { row, stop, coordinates: getVerifiedCoordinates(stop) };
  });
  const located = points.filter(point => point.coordinates);

  if (!located.length) {
    mapElement.classList.add("bus-route-map-empty");
    mapElement.textContent = "No verified stopage coordinates are available yet.";
    if (noteElement) noteElement.textContent =
      "Map pins will appear after real locations are submitted and approved.";
    return;
  }
  if (typeof L === "undefined") {
    mapElement.classList.add("bus-route-map-empty");
    mapElement.textContent = "Map library is unavailable. The stopage list is still available above.";
    return;
  }

  const map = L.map(mapElement, { scrollWheelZoom: false }).setView([0, 0], 2);
  publicRouteMaps.add(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const bounds = [];
  located.forEach(point => {
    const { lat, lng } = point.coordinates;
    const marker = L.marker([lat, lng]).addTo(map);
    const name = point.row.stopage || point.row.stopage_name || "Stopage";
    const time = String(point.row.stopage_time || "").trim() || "Not recorded";
    const sequence = trip.sequenceVerified ? "Sequence " + point.row.sequence : "Sequence unverified";
    marker.bindPopup(
      "<strong>" + escapeHtml(name) + "</strong><br>" +
      escapeHtml(sequence) + "<br>Stopage time: " + escapeHtml(time)
    );
    bounds.push([lat, lng]);
  });

  const allCoordinatesPresent = points.length > 0 && located.length === points.length;
  if (trip.sequenceVerified && allCoordinatesPresent) {
    L.polyline(points.map(point => [
      point.coordinates.lat, point.coordinates.lng
    ]), { weight: 4, opacity: 0.8 }).addTo(map);
    if (noteElement) noteElement.textContent = "Verified sequence · all stopages have coordinates.";
  } else {
    const reasons = [];
    if (!trip.sequenceVerified) reasons.push("sequence contains unknown values");
    if (!allCoordinatesPresent) reasons.push("some stopages have no verified coordinates");
    if (noteElement) noteElement.textContent =
      "Pins shown where locations exist; no connecting route line because " + reasons.join(" and ") + ".";
  }

  if (bounds.length === 1) map.setView(bounds[0], 16);
  else map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
  setTimeout(() => map.invalidateSize(), 120);
  };

  // Avoid creating many OpenStreetMap tile requests before a trip map is visible.
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        publicRouteObservers.delete(observer);
        renderMap();
      }
    }, { rootMargin: "160px" });
    publicRouteObservers.add(observer);
    observer.observe(mapElement);
  } else {
    renderMap();
  }
}

function openContributionPanel(busName, trip, panelIndex) {
  const panel = $("contribution-panel-" + panelIndex);
  if (!panel || !trip?.trip_id) return;
  const bus = busRows.find(item =>
    normalize(item.bus_name || item.name) === normalize(busName)
  );
  const busId = String(bus?.bus_id || "").trim();

  if (!busId) {
    panel.hidden = false;
    panel.innerHTML = '<div class="contribution-panel"><p>Bus ID is unavailable. Submission cannot continue.</p></div>';
    return;
  }

  panel.hidden = false;
  panel.dataset.busId = busId;
  panel.dataset.busName = busName;
  panel.dataset.tripId = trip.trip_id;
  panel.dataset.tripTime = trip.trip_time;
  panel.dataset.direction = trip.direction;
  panel._trip = trip;

  panel.innerHTML = `
    <div class="contribution-panel">
      <h3>Suggest a route or time change</h3>
      <p class="contribution-help">
        Bus: <strong>${escapeHtml(busName)}</strong> ·
        ${escapeHtml(trip.direction)} · Trip time: ${escapeHtml(trip.trip_time)}
      </p>
      ${trip.sequenceVerified ? "" : '<p class="contribution-help"><strong>Sequence not fully verified:</strong> proposals to add, remove or reorder stopages cannot be approved until an admin resolves the unknown sequence. Corrections to existing numbered stopages can be approved without reordering.</p>'}
      <div class="contribution-field" style="margin-top:12px">
        <label for="contribution-email-${panelIndex}">DU email format</label>
        <input id="contribution-email-${panelIndex}" type="email" autocomplete="email"
          placeholder="username-1234567890@subject.du.ac.bd">
      </div>
      <div class="contribution-honeypot" aria-hidden="true">
        <label>Leave this field empty<input id="contribution-website-${panelIndex}" tabindex="-1" autocomplete="off"></label>
      </div>
      <div id="contribution-entries-${panelIndex}"></div>
      <div class="contribution-actions">
        <button type="button" class="contribution-add-entry" id="contribution-add-${panelIndex}">+ Add Another Stopage</button>
        <button type="button" class="contribution-submit" id="contribution-submit-${panelIndex}">Submit for Admin Review</button>
      </div>
      <div class="contribution-status" id="contribution-status-${panelIndex}" role="status" aria-live="polite">
        Stopage time and map location are optional. Unknown values may remain blank.
      </div>
    </div>
  `;

  addContributionEntry(panelIndex, trip);
  $("contribution-add-" + panelIndex).addEventListener("click", () => {
    const count = panel.querySelectorAll(".contribution-entry").length;
    if (count >= 20) {
      setContributionStatus(panelIndex, "A submission can contain at most 20 stopages.", true);
      return;
    }
    addContributionEntry(panelIndex, trip);
  });
  $("contribution-submit-" + panelIndex).addEventListener("click", () => {
    submitContributionPanel(panelIndex);
  });
  setTimeout(() => panel.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
}

function setContributionStatus(panelIndex, message, isError = false) {
  const element = $("contribution-status-" + panelIndex);
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("error", Boolean(isError));
}

function addContributionEntry(panelIndex, trip) {
  const entries = $("contribution-entries-" + panelIndex);
  if (!entries) return;
  const entryKey = "contribution-entry-" + panelIndex + "-" + (++contributionEntryCounter);
  const entryNumber = entries.querySelectorAll(".contribution-entry").length + 1;
  const existingStops = stopRows
    .filter(stop => String(stop.stop_id || "").trim() && String(stop.stopage_name || "").trim())
    .filter((stop, index, all) =>
      all.findIndex(item => String(item.stop_id).trim() === String(stop.stop_id).trim()) === index
    );
  const existingOptions = existingStops.map(stop =>
    `<option value="${escapeHtml(String(stop.stop_id))}">${escapeHtml(stop.stopage_name)}</option>`
  ).join("");
  const targetOptions = trip.stops.map((row, index) => {
    const sequence = String(row.sequence ?? "").trim();
    const valid = sequence !== "" && Number.isInteger(Number(sequence)) && Number(sequence) > 0;
    const name = row.stopage || row.stopage_name || "Unnamed stopage";
    return `<option value="${index}" ${valid ? "" : "disabled"}>${escapeHtml(name)} · ${valid ? "#" + escapeHtml(sequence) : "sequence unknown"}</option>`;
  }).join("");
  const defaultSequence = trip.sequenceVerified
    ? String(trip.stops.reduce((max, row) => Math.max(max, Number(row.sequence) || 0), 0) + entryNumber)
    : "";

  const card = document.createElement("div");
  card.className = "contribution-entry";
  card.dataset.entryKey = entryKey;
  card.innerHTML = `
    <div class="contribution-entry-head">
      <strong>Stopage proposal ${entryNumber}</strong>
      <button type="button" class="contribution-remove-entry">Remove</button>
    </div>
    <div class="contribution-grid">
      <div class="contribution-field">
        <label>Change type</label>
        <select data-operation>
          <option value="ADD">Add stopage to this trip</option>
          <option value="UPDATE">Correct an existing stopage</option>
          <option value="REMOVE">Propose removing a stopage</option>
        </select>
      </div>
      <div class="contribution-field">
        <label data-choice-label>Choose an existing stopage or add a new one</label>
        <select data-stop-choice>
          <option value="__NEW__">New stopage</option>
          ${existingOptions}
        </select>
      </div>
      <div class="contribution-field" data-name-wrap>
        <label>Stopage name</label>
        <input type="text" data-stop-name maxlength="120" placeholder="Enter stopage name">
      </div>
      <div class="contribution-field" data-time-wrap>
        <label>Stopage time (optional)</label>
        <input type="text" data-stop-time maxlength="24" placeholder="e.g. 08:30 AM">
      </div>
      <div class="contribution-field" data-sequence-wrap>
        <label>Sequence in this trip</label>
        <input type="number" data-sequence min="1" step="1" value="${defaultSequence}" placeholder="Enter sequence">
      </div>
      <input type="hidden" data-target-sequence value="">
    </div>
    <div class="contribution-location" data-location-wrap>
      <div class="contribution-location-search">
        <input type="search" data-place-query placeholder="Search a place in OpenStreetMap">
        <button type="button" data-place-search>Search</button>
      </div>
      <select class="contribution-location-results" data-place-results hidden>
        <option value="">Choose a search result</option>
      </select>
      <div class="contribution-map" data-entry-map data-entry-key="${entryKey}" aria-label="Choose this stopage location on map"></div>
      <p class="contribution-help">Click the map or drag the pin. Location is optional; only approved coordinates become public.</p>
      <div class="contribution-coordinates">
        <input type="number" data-latitude step="any" min="-90" max="90" placeholder="Latitude (optional)">
        <input type="number" data-longitude step="any" min="-180" max="180" placeholder="Longitude (optional)">
      </div>
    </div>
  `;
  entries.appendChild(card);

  const operationSelect = card.querySelector("[data-operation]");
  const choiceSelect = card.querySelector("[data-stop-choice]");
  const nameInput = card.querySelector("[data-stop-name]");
  const timeInput = card.querySelector("[data-stop-time]");
  const sequenceInput = card.querySelector("[data-sequence]");
  const targetSequenceInput = card.querySelector("[data-target-sequence]");
  const nameWrap = card.querySelector("[data-name-wrap]");
  const timeWrap = card.querySelector("[data-time-wrap]");
  const sequenceWrap = card.querySelector("[data-sequence-wrap]");
  const locationWrap = card.querySelector("[data-location-wrap]");
  const choiceLabel = card.querySelector("[data-choice-label]");

  initializeContributionMap(card, entryKey, null);

  function fillFromExistingStop(stop) {
    nameInput.value = stop?.stopage_name || "";
    nameInput.readOnly = Boolean(stop);
    setContributionMapLocation(card, entryKey, getVerifiedCoordinates(stop));
  }

  function fillFromTripStop(index) {
    const row = trip.stops[index];
    if (!row) return;
    const sequence = String(row.sequence ?? "").trim();
    targetSequenceInput.value = sequence;
    nameInput.value = row.stopage || row.stopage_name || "";
    nameInput.readOnly = false;
    timeInput.value = row.stopage_time || "";
    sequenceInput.value = sequence;
    fillContributionCoordinates(card, entryKey, getVerifiedCoordinates(findStopRecordForScheduleRow(row)));
  }

  function refreshOperation() {
    const operation = operationSelect.value;
    const isAdd = operation === "ADD";
    const isRemove = operation === "REMOVE";

    if (isAdd) {
      choiceLabel.textContent = "Choose an existing stopage or add a new one";
      choiceSelect.innerHTML = '<option value="__NEW__">New stopage</option>' + existingOptions;
      choiceSelect.value = "__NEW__";
      nameWrap.hidden = false;
      timeWrap.hidden = false;
      sequenceWrap.hidden = false;
      locationWrap.hidden = false;
      nameInput.value = "";
      nameInput.readOnly = false;
      timeInput.value = "";
      targetSequenceInput.value = "";
      sequenceInput.value = defaultSequence;
      fillFromExistingStop(null);
      return;
    }

    choiceLabel.textContent = "Select the stopage in this trip";
    choiceSelect.innerHTML = targetOptions || '<option value="">No target stopages available</option>';
    const firstValid = [...choiceSelect.options].find(option => !option.disabled && option.value !== "");
    if (firstValid) choiceSelect.value = firstValid.value;
    nameWrap.hidden = isRemove;
    timeWrap.hidden = isRemove;
    sequenceWrap.hidden = isRemove;
    locationWrap.hidden = isRemove;
    if (firstValid) fillFromTripStop(Number(firstValid.value));
    else {
      nameInput.value = "";
      timeInput.value = "";
      targetSequenceInput.value = "";
      fillFromExistingStop(null);
    }
  }

  operationSelect.addEventListener("change", refreshOperation);
  choiceSelect.addEventListener("change", () => {
    if (operationSelect.value === "ADD") {
      if (choiceSelect.value === "__NEW__") fillFromExistingStop(null);
      else {
        const stop = existingStops.find(item =>
          String(item.stop_id).trim() === String(choiceSelect.value).trim()
        );
        fillFromExistingStop(stop || null);
      }
    } else {
      fillFromTripStop(Number(choiceSelect.value));
    }
  });

  card.querySelector(".contribution-remove-entry").addEventListener("click", () => {
    const state = contributionMapStates.get(entryKey);
    if (state) state.map.remove();
    contributionMapStates.delete(entryKey);
    card.remove();
    entries.querySelectorAll(".contribution-entry-head strong").forEach((label, index) => {
      label.textContent = "Stopage proposal " + (index + 1);
    });
  });

  card.querySelector("[data-place-search]").addEventListener("click", () => {
    searchContributionPlaces(card, entryKey);
  });
  card.querySelector("[data-place-results]").addEventListener("change", event => {
    const state = contributionMapStates.get(entryKey);
    const result = state?.searchResults?.[Number(event.target.value)];
    if (!result) return;
    setContributionMapLocation(card, entryKey, {
      lat: Number(result.lat), lng: Number(result.lon)
    }, true);
  });

  ["latitude", "longitude"].forEach(field => {
    card.querySelector("[data-" + field + "]").addEventListener("change", () => {
      const lat = card.querySelector("[data-latitude]").value;
      const lng = card.querySelector("[data-longitude]").value;
      if (lat && lng) {
        setContributionMapLocation(card, entryKey, {
          lat: Number(lat), lng: Number(lng)
        }, false);
      }
    });
  });
  refreshOperation();
}

function initializeContributionMap(card, entryKey, initialCoordinates) {
  const mapElement = card.querySelector("[data-entry-map]");
  if (!mapElement || typeof L === "undefined") {
    if (mapElement) mapElement.textContent = "Map library unavailable. You can enter coordinates manually.";
    return;
  }

  const map = L.map(mapElement, { scrollWheelZoom: false }).setView([0, 0], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);
  const state = { map, marker: null, latitude: "", longitude: "", searchResults: [] };
  contributionMapStates.set(entryKey, state);

  function placeMarker(latitude, longitude, centerMap) {
    if (state.marker) state.marker.setLatLng([latitude, longitude]);
    else {
      state.marker = L.marker([latitude, longitude], { draggable: true }).addTo(map);
      state.marker.on("dragend", () => {
        const position = state.marker.getLatLng();
        setContributionMapLocation(card, entryKey, {
          lat: position.lat, lng: position.lng
        }, false);
      });
    }
    state.latitude = latitude;
    state.longitude = longitude;
    card.querySelector("[data-latitude]").value = latitude.toFixed(6);
    card.querySelector("[data-longitude]").value = longitude.toFixed(6);
    if (centerMap) map.setView([latitude, longitude], 16);
  }

  map.on("click", event => placeMarker(event.latlng.lat, event.latlng.lng, false));
  state.placeMarker = placeMarker;
  if (initialCoordinates) placeMarker(initialCoordinates.lat, initialCoordinates.lng, true);
  setTimeout(() => map.invalidateSize(), 120);
}

function fillContributionCoordinates(card, entryKey, coordinates) {
  setContributionMapLocation(card, entryKey, coordinates, Boolean(coordinates));
}

function setContributionMapLocation(card, entryKey, coordinates, centerMap = false) {
  const state = contributionMapStates.get(entryKey);
  const latInput = card.querySelector("[data-latitude]");
  const lngInput = card.querySelector("[data-longitude]");

  if (!coordinates) {
    if (state?.marker) {
      state.map.removeLayer(state.marker);
      state.marker = null;
    }
    if (state) {
      state.latitude = "";
      state.longitude = "";
    }
    if (latInput) latInput.value = "";
    if (lngInput) lngInput.value = "";
    return;
  }

  const lat = Number(coordinates.lat);
  const lng = Number(coordinates.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

  if (state?.placeMarker) state.placeMarker(lat, lng, centerMap);
  else {
    if (latInput) latInput.value = String(lat);
    if (lngInput) lngInput.value = String(lng);
  }
}

async function searchContributionPlaces(card, entryKey) {
  const query = card.querySelector("[data-place-query]").value.trim();
  const button = card.querySelector("[data-place-search]");
  const resultsSelect = card.querySelector("[data-place-results]");
  if (query.length < 3) {
    alert("Enter at least 3 characters to search for a place.");
    return;
  }

  button.disabled = true;
  button.textContent = "Searching...";
  try {
    const wait = Math.max(0, 1100 - (Date.now() - lastGeocodeRequestAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastGeocodeRequestAt = Date.now();
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=" +
      encodeURIComponent(query);
    const response = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error("Place search is temporarily unavailable.");
    const results = await response.json();
    const state = contributionMapStates.get(entryKey);
    if (state) state.searchResults = results;
    resultsSelect.innerHTML = '<option value="">Choose a search result</option>' +
      results.map((item, index) =>
        `<option value="${index}">${escapeHtml(item.display_name || "Map result")}</option>`
      ).join("");
    resultsSelect.hidden = false;
    if (!results.length) {
      const panelId = card.closest("[id^='contribution-panel-']")?.id || "";
      const panelIndex = Number(panelId.replace("contribution-panel-", ""));
      setContributionStatus(panelIndex,
        "No matching place found. You can click the map or move the pin instead.", true);
    }
  } catch (error) {
    alert(error.message || "Place search failed. You can still click the map.");
  } finally {
    button.disabled = false;
    button.textContent = "Search";
  }
}

function requestApiJsonp(params, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const callbackName = "duBusApi_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
    const script = document.createElement("script");
    const url = new URL(API_URL);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    url.searchParams.set("callback", callbackName);
    let finished = false;
    const timeout = setTimeout(() => finish(new Error("The bus server did not respond in time.")), timeoutMs);

    function finish(error, data) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
      if (error) reject(error);
      else resolve(data);
    }
    window[callbackName] = data => finish(null, data);
    script.onerror = () => finish(new Error("Could not reach the bus server."));
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

function createContributionUuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
    const random = Math.random() * 16 | 0;
    const value = character === "x" ? random : (random & 0x3 | 0x8);
    return value.toString(16);
  });
}

async function submitContributionPanel(panelIndex) {
  const panel = $("contribution-panel-" + panelIndex);
  const trip = panel?._trip;
  if (!panel || !trip) return;
  const submitButton = $("contribution-submit-" + panelIndex);
  const email = $("contribution-email-" + panelIndex).value.trim();
  const honeypot = $("contribution-website-" + panelIndex).value;
  const emailPattern = /^[A-Za-z0-9._%+-]+-[0-9]{10}@subject\.du\.ac\.bd$/i;

  if (!emailPattern.test(email)) {
    setContributionStatus(panelIndex,
      "Use the required email format: username-10digit@subject.du.ac.bd. This checks format only, not identity.", true);
    $("contribution-email-" + panelIndex).focus();
    return;
  }

  const entries = [...panel.querySelectorAll(".contribution-entry")];
  if (!entries.length || entries.length > 20) {
    setContributionStatus(panelIndex, "Add between 1 and 20 stopages.", true);
    return;
  }

  const stops = [];
  for (let index = 0; index < entries.length; index++) {
    const card = entries[index];
    const operation = card.querySelector("[data-operation]").value;
    const choice = card.querySelector("[data-stop-choice]").value;
    const name = card.querySelector("[data-stop-name]").value.trim();
    const time = card.querySelector("[data-stop-time]").value.trim();
    const sequenceText = card.querySelector("[data-sequence]").value.trim();
    const latitude = card.querySelector("[data-latitude]").value.trim();
    const longitude = card.querySelector("[data-longitude]").value.trim();

    if ((latitude === "") !== (longitude === "")) {
      setContributionStatus(panelIndex,
        "Stopage " + (index + 1) + ": enter both coordinates or leave both blank.", true);
      return;
    }

    const record = {
      operation,
      stop_id: "",
      stopage_name: "",
      stopage_time: operation === "REMOVE" ? "" : time,
      sequence: "",
      target_sequence: "",
      latitude,
      longitude,
      contribution_type: operation === "ADD" ? "ROUTE" : "CORRECTION"
    };

    if (operation === "ADD") {
      if (!name) {
        setContributionStatus(panelIndex, "Stopage " + (index + 1) + ": enter a stopage name.", true);
        card.querySelector("[data-stop-name]").focus();
        return;
      }
      if (!sequenceText || !Number.isInteger(Number(sequenceText)) || Number(sequenceText) < 1) {
        setContributionStatus(panelIndex, "Stopage " + (index + 1) + ": enter a valid sequence number.", true);
        card.querySelector("[data-sequence]").focus();
        return;
      }
      record.stopage_name = name;
      record.stop_id = choice === "__NEW__" ? "" : choice;
      record.sequence = Number(sequenceText);
      if (choice === "__NEW__") record.contribution_type = "NEW_STOP";
    } else {
      const target = trip.stops[Number(choice)];
      if (!target) {
        setContributionStatus(panelIndex, "Stopage " + (index + 1) + ": select an existing trip stop.", true);
        return;
      }
      const targetSequence = String(target.sequence ?? "").trim();
      if (!targetSequence || !Number.isInteger(Number(targetSequence)) || Number(targetSequence) < 1) {
        setContributionStatus(panelIndex, "This target has no verified sequence and cannot be edited safely.", true);
        return;
      }
      record.target_sequence = Number(targetSequence);
      const stopRecord = findStopRecordForScheduleRow(target);
      record.stop_id = String(stopRecord?.stop_id || target.stop_id || "").trim();
      if (operation === "UPDATE") {
        if (!sequenceText || !Number.isInteger(Number(sequenceText)) || Number(sequenceText) < 1) {
          setContributionStatus(panelIndex, "Stopage " + (index + 1) + ": enter a valid sequence number.", true);
          return;
        }
        record.stopage_name = name;
        record.sequence = Number(sequenceText);
      }
    }
    stops.push(record);
  }

  submitButton.disabled = true;
  submitButton.textContent = "Submitting...";
  setContributionStatus(panelIndex, "Preparing a secure submission...");

  try {
    const nonceResult = await requestApiJsonp({ action: "contribution_nonce" });
    if (!nonceResult || nonceResult.success !== true || !nonceResult.nonce) {
      throw new Error(nonceResult?.error || "Could not prepare a secure submission. Please try again.");
    }

    const batchId = "BATCH-" + createContributionUuid();
    const payload = {
      email,
      bus_id: panel.dataset.busId,
      direction: panel.dataset.direction,
      trip_id: panel.dataset.tripId,
      trip_time: panel.dataset.tripTime,
      client_batch_id: batchId,
      nonce: nonceResult.nonce,
      website: honeypot,
      stops
    };

    if (!window.frames["contributionPostFrame"]) {
      throw new Error("Submission frame is unavailable.");
    }
    const form = document.createElement("form");
    form.method = "POST";
    form.action = API_URL;
    form.target = "contributionPostFrame";
    form.enctype = "application/x-www-form-urlencoded";
    form.style.display = "none";
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "payload";
    input.value = JSON.stringify(payload);
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    setTimeout(() => form.remove(), 1000);

    setContributionStatus(panelIndex, "Request sent. Verifying that it reached the pending review queue...");
    let verified = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 1200 : 1500));
      try {
        const status = await requestApiJsonp({
          action: "submission_status",
          batch_id: batchId
        });
        if (status?.success && status.found) {
          verified = status;
          break;
        }
      } catch (statusError) {
        // Bounded status checks; never report success without a matching batch.
      }
    }

    if (verified && verified.count === stops.length &&
        String(verified.status).toLowerCase() === "pending") {
      setContributionStatus(panelIndex,
        "Submitted successfully. " + verified.count +
        " stopage proposal(s) are pending admin review. Your email is not shown publicly.");
      submitButton.textContent = "Submitted";
    } else if (verified) {
      setContributionStatus(panelIndex,
        "Submission reference found with status: " + verified.status +
        ". Please do not submit the same proposal again.", true);
      submitButton.textContent = "Submission recorded";
    } else {
      setContributionStatus(panelIndex,
        "The request was sent, but the server could not confirm it. Do not immediately submit again; check with the admin first.", true);
      submitButton.textContent = "Verification unavailable";
    }
  } catch (error) {
    setContributionStatus(panelIndex, error.message || "Submission failed. Please try again.", true);
    submitButton.disabled = false;
    submitButton.textContent = "Submit for Admin Review";
  }
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

/* SIMPLE 12-HOUR DIGITAL TIME PICKER WITH AM/PM */
function updateTimeSearchValue() {
  const hour12 = Number($("timeHour")?.value || 12);
  const minute = Number($("timeMinute")?.value || 0);
  const period = $("periodToggle")?.textContent.trim() || "AM";
  let hour24 = hour12 % 12;
  if (period === "PM") hour24 += 12;
  $("timeSearch").value = String(hour24).padStart(2,"0") + ":" + String(minute).padStart(2,"0");
  updateSearchWindowRange();
}
function syncTimePickerFromValue(value) {
  const match = String(value || "00:00").match(/^(\d{2}):(\d{2})$/);
  if (!match) return;
  const hour24 = Number(match[1]);
  $("timeHour").value = String(hour24 % 12 || 12);
  $("timeMinute").value = match[2];
  $("periodToggle").textContent = hour24 >= 12 ? "PM" : "AM";
  updateTimeSearchValue();
}
for (let hour = 1; hour <= 12; hour++) {
  const option = document.createElement("option");
  option.value = String(hour);
  option.textContent = String(hour).padStart(2,"0");
  $("timeHour")?.appendChild(option);
}
for (let minute = 0; minute < 60; minute++) {
  const option = document.createElement("option");
  option.value = String(minute);
  option.textContent = String(minute).padStart(2,"0");
  $("timeMinute")?.appendChild(option);
}
$("timeHour").value = "12";
$("timeMinute").value = "00";
$("periodToggle").textContent = "AM";
$("timeSearch").value = "00:00";
$("timeHour")?.addEventListener("change", updateTimeSearchValue);
$("timeMinute")?.addEventListener("change", updateTimeSearchValue);
$("periodToggle")?.addEventListener("click", () => {
  $("periodToggle").textContent = $("periodToggle").textContent.trim() === "AM" ? "PM" : "AM";
  updateTimeSearchValue();
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


/* MOBILE NAVIGATION MENU */
(() => {
  const menuButton = $("mobileMenuToggle");
  const navigation = $("mainNavigation");
  if (!menuButton || !navigation) return;

  function closeMobileMenu() {
    navigation.classList.remove("is-open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation menu");
  }

  menuButton.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    const isOpen = navigation.classList.toggle("is-open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuButton.setAttribute(
      "aria-label",
      isOpen ? "Close navigation menu" : "Open navigation menu"
    );
  });

  navigation.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", closeMobileMenu);
  });

  document.addEventListener("click", event => {
    if (!navigation.contains(event.target) && !menuButton.contains(event.target)) {
      closeMobileMenu();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMobileMenu();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 640) closeMobileMenu();
  });
})();
