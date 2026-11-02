
/* DU BUS FINDER - Universal Smart Search */

const API_URL = "https://script.google.com/macros/s/AKfycbztmllLo3702kye-QB3-O-D809kj0TpovZRQzHdEx6-hjUlBKMO49StHpsCZjHJ9ANCPhA/exec";

let scheduleRows = [];
let busRows = [];
let stopRows = [];
let serviceDayRows = [];
let deferredPrompt;

const $ = (id) => document.getElementById(id);
const results = $("results");

/* BASIC HELPERS */

function normalize(v) {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
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

/* BANGLA + ENGLISH SMART NORMALIZATION */

function toSearchSkeleton(value) {
  let s = normalize(value);

  // Bengali consonant mapping
  const banglaMap = {
    "ক":"k","খ":"kh","গ":"g","ঘ":"gh","ঙ":"ng",
    "চ":"ch","ছ":"chh","জ":"j","ঝ":"jh","ঞ":"n",
    "ট":"t","ঠ":"th","ড":"d","ঢ":"dh","ণ":"n",
    "ত":"t","থ":"th","দ":"d","ধ":"dh","ন":"n",
    "প":"p","ফ":"f","ব":"b","ভ":"bh","ম":"m",
    "য":"j","র":"r","ল":"l","শ":"s","ষ":"s",
    "স":"s","হ":"h","ড়":"r","ঢ়":"rh","য়":"y",
    "ৎ":"t","ং":"ng","ঃ":"h"
  };

  // If Bengali is detected, convert consonants to Roman form
  if (/[ঁ-৿]/.test(s)) {
    s = [...s].map(ch => banglaMap[ch] || "").join("");
  }

  // Normalize common English spelling variations
  s = s
    .replace(/sh/g, "s")
    .replace(/chh/g, "ch")
    .replace(/ph/g, "f")
    .replace(/bh/g, "b")
    .replace(/kh/g, "k")
    .replace(/gh/g, "g")
    .replace(/th/g, "t")
    .replace(/dh/g, "d")
    .replace(/zh/g, "j")
    .replace(/ng/g, "n")
    .replace(/aa/g, "a")
    .replace(/oo/g, "o")
    .replace(/ee/g, "i");

  // Ignore vowels and spaces for phonetic matching
  return s.replace(/[aeiou\s\-_.,']/g, "");
}

/* EDIT DISTANCE FOR TYPING ERRORS */

function editDistance(a, b) {
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

/* UNIVERSAL MATCH FUNCTION */

function smartMatch(query, candidate) {
  const q = normalize(query);
  const c = normalize(candidate);

  if (!q) return true;
  if (!c) return false;

  // Exact or partial text match
  if (c.includes(q) || q.includes(c)) return true;

  const qs = toSearchSkeleton(q);
  const cs = toSearchSkeleton(c);

  if (!qs || !cs) return false;

  // Phonetic and partial match
  if (cs.includes(qs) || qs.includes(cs)) return true;

  // Fuzzy matching
  if (Math.min(qs.length, cs.length) < 4) return false;

  const distance = editDistance(qs, cs);
  const threshold = qs.length >= 8 ? 2 : 1;

  return distance <= threshold;
}

/* SUGGESTION SYSTEM */

const busInput = $("busSearch");

let suggestionBox = null;

function createSuggestionBox() {
  if (!busInput || suggestionBox) return;

  suggestionBox = document.createElement("div");
  suggestionBox.id = "busSuggestions";

  Object.assign(suggestionBox.style, {
    display: "none",
    position: "relative",
    width: "100%",
    background: "#ffffff",
    border: "1px solid #dce3eb",
    borderRadius: "10px",
    marginTop: "5px",
    maxHeight: "220px",
    overflowY: "auto",
    zIndex: "9999",
    boxShadow: "0 5px 15px rgba(0,0,0,0.10)"
  });

  busInput.insertAdjacentElement("afterend", suggestionBox);
}

function getBusNames() {
  const names = [
    ...busRows.map(b =>
      b.bus_name || b.name || b.bus || ""
    ),
    ...scheduleRows.map(r => r.bus_name || "")
  ];

  return [...new Set(
    names.map(n => String(n).trim()).filter(Boolean)
  )];
}

function showBusSuggestions() {
  if (!busInput || !scheduleRows.length) return;

  const query = busInput.value.trim();

  if (!query) {
    suggestionBox.style.display = "none";
    return;
  }

  const matches = getBusNames()
    .filter(name => smartMatch(query, name))
    .sort((a, b) => {
      const q = normalize(query);

      if (normalize(a) === q) return -1;
      if (normalize(b) === q) return 1;

      return a.localeCompare(b);
    })
    .slice(0, 8);

  if (!matches.length) {
    suggestionBox.style.display = "none";
    return;
  }

  suggestionBox.innerHTML = matches.map(name => `
    <div class="bus-suggestion"
      data-name="${escapeHtml(name)}"
      style="
        padding: 11px 14px;
        cursor: pointer;
        border-bottom: 1px solid #edf0f4;
        color: #263648;
        font-size: 14px;
      ">
      🚌 ${escapeHtml(name)}
    </div>
  `).join("");

  suggestionBox.style.display = "block";

  suggestionBox.querySelectorAll(".bus-suggestion")
    .forEach(item => {
      item.addEventListener("mousedown", e => {
        e.preventDefault();

        busInput.value = item.dataset.name;
        suggestionBox.style.display = "none";

        runSearch();
      });
    });
}

createSuggestionBox();

if (busInput) {
  busInput.addEventListener("input", showBusSuggestions);

  busInput.addEventListener("focus", showBusSuggestions);

  busInput.addEventListener("blur", () => {
    setTimeout(() => {
      if (suggestionBox) {
        suggestionBox.style.display = "none";
      }
    }, 150);
  });
}

/* EMPTY STATE */

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

/* DATABASE CONNECTION */

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

/* TIME CONVERSION */

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

/* TIME DIFFERENCE */

function timeDifference(a, b) {
  const difference = Math.abs(a - b);
  return Math.min(difference, 1440 - difference);
}

/* DIRECTION MATCHING */

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

/* DISPLAY RESULTS */

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

/* MAIN SMART SEARCH */

function runSearch() {
  if (!scheduleRows.length) {
    showEmpty(
      "Database not loaded",
      "Wait for the Google Sheets connection."
    );
    return;
  }

  if (suggestionBox) {
    suggestionBox.style.display = "none";
  }

  const bus = normalize(busInput ? busInput.value : "");
  const stop = normalize($("stopSearch").value);
  const dir = $("direction").value;
  const time = $("timeSearch").value;

  let rows = scheduleRows.filter(r => {
    const busName = r.bus_name || "";
    const stopName = r.stopage || r.stopage_name || "";

    // Universal smart matching
    const busMatch = !bus || smartMatch(bus, busName);
    const stopMatch = !stop || smartMatch(stop, stopName);

    const directionMatch =
      directionMatches(r.direction, dir);

    return busMatch && stopMatch && directionMatch;
  });

  /* TIME SEARCH: ±30 MINUTES */

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

/* SEARCH BUTTON */

$("searchBtn").addEventListener("click", runSearch);

/* ENTER KEY */

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

/* QUICK SEARCH CARDS */

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

/* PWA INSTALLATION */

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

/* SERVICE WORKER */

if (
  "serviceWorker" in navigator &&
  location.protocol.startsWith("http")
) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

/* LOAD DATABASE */

loadDatabase();
