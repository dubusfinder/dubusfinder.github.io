/**
 * DU BUS FINDER — Google Sheets to GitHub read-only snapshot sync.
 *
 * This exports only Buses, Stops, BusSchedule and ServiceDays.
 * It never writes to Google Sheets and never exports Contributions/AdminLog.
 *
 * Required Script Properties:
 *   GITHUB_TOKEN
 *   GITHUB_OWNER       (dubusfinder)
 *   GITHUB_REPO        (dubusfinder.github.io)
 *   GITHUB_BRANCH      (main)
 *   GITHUB_FILE_PATH   (data/database.json)
 */

const GITHUB_SYNC_CONFIG = {
  PROPERTY_KEYS: [
    "GITHUB_TOKEN",
    "GITHUB_OWNER",
    "GITHUB_REPO",
    "GITHUB_BRANCH",
    "GITHUB_FILE_PATH"
  ],
  HANDLER: "githubSyncDatabaseNow",
  INTERVAL_MINUTES: 15
};

function githubSyncDatabaseNow() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const props = PropertiesService.getScriptProperties();
    const config = githubSyncReadConfig_(props);

    const payload = {
      success: true,
      source: "DU_BUS_FINDER_database",
      exported_at: new Date().toISOString(),
      timezone: Session.getScriptTimeZone(),
      sheets: {
        buses: getSheetData(SHEETS.buses),
        stops: getSheetData(SHEETS.stops),
        schedules: getSheetData(SHEETS.schedule),
        serviceDays: getSheetData(SHEETS.serviceDays)
      }
    };

    payload.counts = {
      buses: payload.sheets.buses.length,
      stops: payload.sheets.stops.length,
      schedules: payload.sheets.schedules.length,
      serviceDays: payload.sheets.serviceDays.length
    };

    const json = JSON.stringify(payload, null, 2);
    const apiUrl =
      "https://api.github.com/repos/" +
      encodeURIComponent(config.owner) + "/" +
      encodeURIComponent(config.repo) +
      "/contents/" + config.path.split("/").map(encodeURIComponent).join("/");

    const headers = {
      Authorization: "Bearer " + config.token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    let existingSha = "";
    const getResponse = UrlFetchApp.fetch(
      apiUrl + "?ref=" + encodeURIComponent(config.branch),
      {
        method: "get",
        headers: headers,
        muteHttpExceptions: true
      }
    );

    const getCode = getResponse.getResponseCode();
    if (getCode === 200) {
      const existing = JSON.parse(getResponse.getContentText());
      existingSha = String(existing.sha || "");
    } else if (getCode !== 404) {
      throw new Error(
        "GitHub read failed (" + getCode + "): " +
        getResponse.getContentText().slice(0, 500)
      );
    }

    const requestBody = {
      message: "Sync DU BUS FINDER database snapshot",
      content: Utilities.base64Encode(
        Utilities.newBlob(json, "application/json").getBytes()
      ),
      branch: config.branch
    };

    if (existingSha) requestBody.sha = existingSha;

    const putResponse = UrlFetchApp.fetch(apiUrl, {
      method: "put",
      contentType: "application/json",
      headers: headers,
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true
    });

    const putCode = putResponse.getResponseCode();
    if (putCode < 200 || putCode >= 300) {
      throw new Error(
        "GitHub write failed (" + putCode + "): " +
        putResponse.getContentText().slice(0, 700)
      );
    }

    const result = JSON.parse(putResponse.getContentText());
    const output = {
      success: true,
      message: "Database snapshot synced to GitHub.",
      file_path: config.path,
      branch: config.branch,
      exported_at: payload.exported_at,
      counts: payload.counts,
      commit_url: result.commit && result.commit.html_url
        ? result.commit.html_url
        : ""
    };

    props.setProperty("GITHUB_SYNC_LAST_SUCCESS", JSON.stringify(output));
    props.deleteProperty("GITHUB_SYNC_LAST_ERROR");
    return output;

  } catch (error) {
    PropertiesService.getScriptProperties().setProperty(
      "GITHUB_SYNC_LAST_ERROR",
      JSON.stringify({
        at: new Date().toISOString(),
        message: error.message || String(error)
      })
    );
    throw error;

  } finally {
    lock.releaseLock();
  }
}

function githubSyncSetup() {
  const props = PropertiesService.getScriptProperties();
  githubSyncReadConfig_(props);

  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === GITHUB_SYNC_CONFIG.HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger(GITHUB_SYNC_CONFIG.HANDLER)
    .timeBased()
    .everyMinutes(GITHUB_SYNC_CONFIG.INTERVAL_MINUTES)
    .create();

  return {
    success: true,
    message: "Automatic GitHub sync trigger created.",
    interval_minutes: GITHUB_SYNC_CONFIG.INTERVAL_MINUTES
  };
}

function githubSyncStatus() {
  const props = PropertiesService.getScriptProperties();
  const lastSuccess = props.getProperty("GITHUB_SYNC_LAST_SUCCESS");
  const lastError = props.getProperty("GITHUB_SYNC_LAST_ERROR");
  const config = githubSyncReadConfig_(props, true);

  return {
    configured: config.missing.length === 0,
    missing_properties: config.missing,
    last_success: lastSuccess ? JSON.parse(lastSuccess) : null,
    last_error: lastError ? JSON.parse(lastError) : null,
    trigger_count: ScriptApp.getProjectTriggers().filter(
      trigger => trigger.getHandlerFunction() === GITHUB_SYNC_CONFIG.HANDLER
    ).length
  };
}

function githubSyncReadConfig_(props, allowMissing) {
  const values = {
    token: props.getProperty("GITHUB_TOKEN") || "",
    owner: props.getProperty("GITHUB_OWNER") || "",
    repo: props.getProperty("GITHUB_REPO") || "",
    branch: props.getProperty("GITHUB_BRANCH") || "",
    path: props.getProperty("GITHUB_FILE_PATH") || ""
  };

  const missing = [];
  if (!values.token) missing.push("GITHUB_TOKEN");
  if (!values.owner) missing.push("GITHUB_OWNER");
  if (!values.repo) missing.push("GITHUB_REPO");
  if (!values.branch) missing.push("GITHUB_BRANCH");
  if (!values.path) missing.push("GITHUB_FILE_PATH");

  if (missing.length && !allowMissing) {
    throw new Error(
      "GitHub Sync is not configured. Missing Script Properties: " +
      missing.join(", ")
    );
  }

  if (values.path && (
    values.path.startsWith("/") ||
    values.path.split("/").some(part => part === "..")
  )) {
    throw new Error("Invalid GitHub file path.");
  }

  values.missing = missing;
  return values;
}
