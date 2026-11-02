
/* DU BUS FINDER - Smart Search System */

const API_URL = "https://script.google.com/macros/s/AKfycbzxpN2M7gA9tz2ZIz4V9zxU18MDxH1A9DUndLrAIqoRaXCeLPa9rHng9dXL5Q2XD4pyQA/exec";

let scheduleRows = [];
let busRows = [];
let stopRows = [];
let serviceDayRows = [];
let deferredPrompt;

const $ = (id) => document.getElementById(id);
const results = $("results");

let suggestionPanels = {};

/* ----------------------------------
   BASIC HELPERS
---------------------------------- */

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

/* ----------------------------------
   BANGLA TO ENGLISH TRANSLITERATION
---------------------------------- */

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
  let text = String(value ?? "");

  return [...text].map(char => {
    return banglaMap[char] ?? char;
  }).join("");
}

/* ----------------------------------
   SEARCH NORMALIZATION
---------------------------------- */

function searchNormalize(value) {
  let text = normalize(value);

  // Convert Bangla into approximate English spelling
  text = transliterateBangla(text);

  // Remove spaces and special characters
  text = text.replace(/[^a-z0-9]/g, "");

  // Common spelling variations
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

/* ----------------------------------
   FUZZY MATCHING
---------------------------------- */

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from(
    { length: b.length + 1 },
    (_, i) => i
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

  // Short queries need stricter matching
  const threshold = q.length <= 3 ? 0.75 : 0.55;

  if (score >= threshold) {
    return Math.round(score * 80);
  }

  return 0;
}

/* ----------------------------------
   DATABASE CONNECTION
---------------------------------- */

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

/* ----------------------------------
   GET UNIQUE BUS AND STOP NAMES
---------------------------------- */

function getBusNames() {
  const names = new Set();

  scheduleRows.forEach(row => {
    if (row.bus_name) names.add(String(row.bus_name).trim());
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

/* ----------------------------------
   SMART MATCH
---------------------------------- */

function findBestMatch(query, name) {
  return getMatchScore(query, name);
}

function smartMatches(query, names) {
  if (!query.trim()) return [];

  return names
    .map(name => ({
      name,
      score: findBestMatch(query, name)
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

/* ----------------------------------
   LIVE SUGGESTION DESIGN
---------------------------------- */

function createSuggestionPanel(inputId) {
  const input = $(inputId);

  if (!input) return null;

  const panel = document.createElement("div");

  panel.style.cssText = `
    display:none;
    position:fixed;
    z-index:99999;
    background:#ffffff;
    border:1px solid #ddd;
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
        border-bottom:1px solid #eee;
        background:white;
        text-align:left;
        cursor:pointer;
        color:#222;
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

/* ----------------------------------
   LIVE SEARCH SUGGESTIONS
---------------------------------- */

function setupSuggestions(inputId, getNames) {
  const input = $(inputId);

  if (!input) return;

  const panel = createSuggestionPanel(inputId);

  input.addEventListener("input", () => {
    const query = input.value.trim();

    if (!query || !scheduleRows.length) {
      hideSuggestions(inputId);
      return;
    }

    const matches = smartMatches(query, getNames());

    showSuggestions(inputId, matches);
  });

  input.addEventListener("focus", () => {
    const query = input.value.trim();

    if (!query || !scheduleRows.length) return;

    showSuggestions(
      inputId,
      smartMatches(query, getNames())
    );
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      hideSuggestions(inputId);
    }
  });
}

document.addEventListener("click", e => {
  Object.keys(suggestionPanels).forEach(id => {
    const panel = suggestionPanels[id];
    const input = $(id);

    if (
      panel &&
      !panel.contains(e.target) &&
      !input.contains(e.target)
    ) {
      hideSuggestions(id);
    }
  });
});

window.addEventListener("resize", () => {
  Object.keys(suggestionPanels).forEach(id => {
    const panel = suggestionPanels[id];
    const input = $(id);

    if (panel && input && panel.style.display !== "none") {
      positionPanel(input, panel);
    }
  });
});

window.addEventListener("scroll", () => {
  Object.keys(suggestionPanels).forEach(id => {
    const panel = suggestionPanels[id];
    const input = $(id);

    if (panel && input && panel.style.display !== "none") {
      positionPanel(input, panel);
    }
  });
}, true);

/* ----------------------------------
   TIME CONVERSION
---------------------------------- */

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

/* ----------------------------------
   DIRECTION MATCHING
---------------------------------- */

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

/* ----------------------------------
   DISPLAY RESULTS
---------------------------------- */

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

/* ----------------------------------
   MAIN SMART SEARCH
---------------------------------- */

function runSearch() {
  if (!scheduleRows.length) {
    showEmpty(
      "Database not loaded",
      "Wait for the Google Sheets connection."
    );
    return;
  }

  hideSuggestions("busSearch");
  hideSuggestions("stopSearch");

  const busInput = $("busSearch");
  const bus = busInput ? busInput.value.trim() : "";

  const stop = $("stopSearch").value.trim();
  const dir = $("direction").value;
  const time = $("timeSearch").value;

  let rows = scheduleRows.filter(r => {
    const busName = r.bus_name || "";
    const stopName = r.stopage || r.stopage_name || "";

    const busMatch =
      !bus || getMatchScore(bus, busName) > 0;

    const stopMatch =
      !stop || getMatchScore(stop, stopName) > 0;

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

/* ----------------------------------
   SEARCH BUTTON AND ENTER KEY
---------------------------------- */

$("searchBtn").addEventListener("click", runSearch);

["busSearch", "stopSearch"].forEach(id => {
  const input = $(id);

  if (input) {
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        hideSuggestions(id);
        runSearch();
      }
    });
  }
});

$("timeSearch").addEventListener("keydown", e => {
  if (e.key === "Enter") runSearch();
});

/* ----------------------------------
   QUICK SEARCH CARDS
---------------------------------- */

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

/* ----------------------------------
   PWA INSTALLATION
---------------------------------- */

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

/* ----------------------------------
   SERVICE WORKER
---------------------------------- */

if (
  "serviceWorker" in navigator &&
  location.protocol.startsWith("http")
) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

/* ----------------------------------
   INITIALIZE SMART SEARCH
---------------------------------- */

setupSuggestions("busSearch", getBusNames);
setupSuggestions("stopSearch", getStopNames);

/* LOAD DATABASE */

loadDatabase();
