
/* DU BUS FINDER - Enhanced Search System */

const API_URL = "https://script.google.com/macros/s/AKfycbztmllLo3702kye-QB3O-D809kj0TpovZRQzHdEx6-hjUlBKMO49StHpsCZjHJ9ANCPhA/exec";
let scheduleRows = [];
let busRows = [];
let stopRows = [];
let serviceDayRows = [];
let deferredPrompt;

const $ = (id) => document.getElementById(id);
const results = $("results");

/* Helper Functions */

function normalize(v) {
  return String(v ?? "").trim().toLowerCase();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function showEmpty(title, message) {
  $("resultTitle").textContent = title;
  results.className = "results empty";

  results.innerHTML = `
    <div class="empty-icon">🚌</div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(message)}</p>
  `;
}

function setStatus(message, success = false) {
  $("dataStatus").textContent = message;
  $("dataStatus").style.background =
    success ? "#d9f2e6" : "#fff0d9";
  $("dataStatus").style.color =
    success ? "#12634f" : "#80551b";
}

/* Google Sheets Database Connection */

function loadDatabase() {
  if (API_URL.includes("PASTE_YOUR")) {
    setStatus("API URL not configured");
    showEmpty("API URL missing", "Add your Google Apps Script URL.");
    return;
  }

  setStatus("Connecting to database...");

  const callbackName =
    "duBusCallback_" + Date.now() + "_" +
    Math.floor(Math.random() * 10000);

  const script = document.createElement("script");

  const cleanup = () => {
    delete window[callbackName];
    script.remove();
  };

  const timeout = setTimeout(() => {
    cleanup();
    setStatus("Connection timed out");
    showEmpty("Connection failed", "Check your API URL and deployment.");
  }, 20000);

  window[callbackName] = function(data) {
    clearTimeout(timeout);
    cleanup();

    if (!data || data.success !== true) {
      setStatus("Database error");
      showEmpty("Database error", data?.error || "Could not load database.");
      return;
    }

    busRows = data.buses || [];
    stopRows = data.stops || [];
    scheduleRows = data.schedules || [];
    serviceDayRows = data.serviceDays || [];

    setStatus(`${scheduleRows.length} schedule rows loaded`, true);

    showEmpty(
      "Database connected!",
      `${busRows.length} buses, ${stopRows.length} stopages and ${scheduleRows.length} schedule entries loaded. Search for a bus or stopage.`
    );
  };

  script.onerror = () => {
    clearTimeout(timeout);
    cleanup();
    setStatus("API connection failed");
    showEmpty("Connection failed", "Check the API URL and try again.");
  };

  script.src = API_URL +
    "?action=all&callback=" +
    encodeURIComponent(callbackName);

  document.body.appendChild(script);
}

/* Time Conversion: Supports 12-hour and 24-hour formats */

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

/* Time Difference Across Midnight */

function timeDifference(a, b) {
  const difference = Math.abs(a - b);
  return Math.min(difference, 1440 - difference);
}

/* Direction Matching */

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

/* Display Search Results */

function renderRows(rows, title) {
  $("resultTitle").textContent = title;

  if (!rows.length) {
    showEmpty(
      title,
      "No matching schedule was found. Try another bus name, stopage, time or direction."
    );
    return;
  }

  results.className = "results";

  results.innerHTML = rows.map(r => {
    const bus = r.bus_name || "Bus name unavailable";
    const stop = r.stopage || r.stopage_name || "Stopage unavailable";
    const direction = r.direction || "Direction unavailable";

    // Display trip_time only
    const time = r.trip_time || "Time unavailable";

    return `
      <div class="result-row">
        <div>
          <strong>${escapeHtml(bus)}</strong>
          <small>${escapeHtml(stop)} · ${escapeHtml(direction)}</small>
        </div>
        <div class="time">${escapeHtml(time)}</div>
      </div>
    `;
  }).join("");
}

/* Main Search Function */

function runSearch() {
  if (!scheduleRows.length) {
    showEmpty(
      "Database not loaded",
      "Wait for the Google Sheets connection."
    );
    return;
  }

  const busInput = $("busSearch");
  const bus = normalize(busInput ? busInput.value : "");

  const stop = normalize($("stopSearch").value);
  const dir = $("direction").value;
  const time = $("timeSearch").value;

  let rows = scheduleRows.filter(r => {
    const busName = normalize(r.bus_name);
    const stopName = normalize(r.stopage || r.stopage_name);

    const busMatch = !bus || busName.includes(bus);
    const stopMatch = !stop || stopName.includes(stop);

    const directionMatch =
      directionMatches(r.direction, dir);

    return busMatch && stopMatch && directionMatch;
  });

  /* Time Search: trip_time only, within ±30 minutes */

  if (time) {
    const target = toMinutes(time);

    if (target === null) {
      showEmpty("Invalid time", "Please enter a valid time.");
      return;
    }

    rows = rows.filter(r => {
      const rowTime = toMinutes(r.trip_time);

      return rowTime !== null &&
        timeDifference(rowTime, target) <= 30;
    });

    /* Closest times appear first */

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
  } else if (dir) {
    title = dir === "UP" ? "Up Trip Buses" : "Down Trip Buses";
  }

  renderRows(rows, title);
}

/* Search Button */

$("searchBtn").addEventListener("click", runSearch);

/* Enter Key Support */

["busSearch", "stopSearch"].forEach(id => {
  const input = $(id);

  if (input) {
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") runSearch();
    });
  }
});

$("timeSearch").addEventListener("keydown", e => {
  if (e.key === "Enter") runSearch();
});

/* Quick Search Cards */

document.querySelectorAll(".quick-card").forEach(btn => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode;

    if (mode === "near") {
      $("timeSearch").focus();
      $("resultTitle").textContent = "Buses within ±30 minutes";

    } else if (mode === "direction") {
      $("direction").focus();

    } else if (mode === "where") {
      showEmpty(
        "Scheduled bus position",
        "This feature needs reliable stop-wise times. It will show an estimate, never live GPS."
      );

    } else {
      $("stopSearch").focus();
    }
  });
});

/* PWA Installation */

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredPrompt = e;
  $("installBtn").hidden = false;
});

$("installBtn").addEventListener("click", async () => {
  if (!deferredPrompt) return;

  await deferredPrompt.prompt();
  deferredPrompt = null;
  $("installBtn").hidden = true;
});

/* Service Worker */

if (
  "serviceWorker" in navigator &&
  location.protocol.startsWith("http")
) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

/* Load Database */

loadDatabase();
