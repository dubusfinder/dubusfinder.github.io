
/* ----------------------------------
   ONLINE + OFFLINE DATABASE SYSTEM
---------------------------------- */

const DB_CACHE_KEY = "duBusFinderDatabaseV1";

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

    localStorage.setItem(DB_CACHE_KEY, JSON.stringify(backup));
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
      `${total} loaded successfully.`
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
}

function loadDatabase() {
  if (databaseLoading) return;

  const cachedData = getLocalDatabase();

  // Immediately load saved data if available.
  if (cachedData) {
    applyDatabase(cachedData, "offline");
  }

  // If there is no internet, use the saved database.
  if (!navigator.onLine) {
    if (!cachedData) {
      databaseLoaded = false;
      setStatus("No saved offline database");

      showConnectionError(
        "Internet connection required",
        "Connect to the internet once to download and save the bus database."
      );
    }

    return;
  }

  if (!API_URL || API_URL.includes("PASTE_YOUR")) {
    if (!cachedData) {
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
    setStatus("Connecting to database...");
  } else {
    setStatus("Using saved database · Checking for updates...", true);
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
      // Keep the saved database active.
      applyDatabase(cachedData, "offline");
      setStatus(
        "Using saved database · Online update unavailable",
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
      "The online database did not respond. Please try again later.",
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

    // Save the complete database, not just searched results.
    const saved = saveDatabaseLocally(data);

    // Online search works even if local saving fails.
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
      "Could not connect to the online database.",
      "API connection failed"
    );
  };

  script.src = API_URL +
    "?action=all&callback=" +
    encodeURIComponent(callbackName);

  document.body.appendChild(script);
}

// Automatically check for online updates.
window.addEventListener("online", () => {
  loadDatabase();
});

// Keep the saved database available when internet disconnects.
window.addEventListener("offline", () => {
  const saved = getLocalDatabase();

  if (saved) {
    applyDatabase(saved, "offline");
  }
});
