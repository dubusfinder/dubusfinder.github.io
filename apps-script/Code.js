
/**
 * =========================================
 * DU BUS FINDER - COMPLETE BACKEND API
 * Public API + Contributions + Admin Review
 * =========================================
 */

const SHEETS = {
  buses: "Buses",
  stops: "Stops",
  schedule: "BusSchedule",
  serviceDays: "ServiceDays"
};

const CONTRIBUTION_CONFIG = {
  SHEET_NAME: "Contributions",
  MAX_STOPS_PER_SUBMISSION: 20,
  MAX_SUBMISSIONS_PER_EMAIL: 5,
  RATE_WINDOW_SECONDS: 600,
  DUPLICATE_WINDOW_SECONDS: 120,
  MAX_PAYLOAD_CHARS: 30000,
  NONCE_TTL_SECONDS: 600
};


/* =========================================
   1. GENERAL DATABASE HELPERS
========================================= */

function getSheetData(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error("Sheet not found: " + sheetName);
  }

  const values = sheet.getDataRange().getDisplayValues();

  if (values.length < 2) return [];

  const headers = values[0].map(h => String(h).trim());

  return values.slice(1)
    .filter(row => row.some(cell => String(cell).trim() !== ""))
    .map(row => {
      const obj = {};

      headers.forEach((header, index) => {
        if (header) obj[header] = row[index] || "";
      });

      return obj;
    });
}

function getDatabase() {
  return {
    success: true,
    buses: getSheetData(SHEETS.buses),
    stops: getSheetData(SHEETS.stops),
    schedules: getSheetData(SHEETS.schedule),
    serviceDays: getSheetData(SHEETS.serviceDays)
  };
}


/* =========================================
   2. PUBLIC GET API
========================================= */

function issueContributionNonce_() {
  const token = Utilities.getUuid() + "." + Utilities.getUuid();
  CacheService.getScriptCache().put(
    "contrib_nonce_" + contributionHash(token),
    "1",
    CONTRIBUTION_CONFIG.NONCE_TTL_SECONDS
  );
  return token;
}

function consumeContributionNonce_(token) {
  const value = String(token || "").trim();
  if (!value || value.length > 100) {
    throw new Error("Please refresh the form and try again.");
  }

  const cache = CacheService.getScriptCache();
  const key = "contrib_nonce_" + contributionHash(value);
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    if (cache.get(key) !== "1") {
      throw new Error("Form security token expired or already used. Please try again.");
    }
    cache.remove(key);
  } finally {
    lock.releaseLock();
  }
}

function getPublicSubmissionStatus_(batchId) {
  const id = String(batchId || "").trim();
  if (!/^BATCH-[a-f0-9-]{36}$/i.test(id)) {
    throw new Error("Invalid submission reference.");
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CONTRIBUTION_CONFIG.SHEET_NAME);

  if (!sheet || sheet.getLastRow() < 2) {
    return { success: true, found: false, status: "Not found", count: 0 };
  }

  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0].map(value => String(value).trim());
  const batchColumn = headers.indexOf("batch_id") + 1;
  const statusColumn = headers.indexOf("status") + 1;

  if (batchColumn < 1 || statusColumn < 1) {
    throw new Error("Contribution status is temporarily unavailable.");
  }

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastColumn)
    .getDisplayValues();
  const matches = rows.filter(row => String(row[batchColumn - 1]).trim() === id);

  if (!matches.length) {
    return { success: true, found: false, status: "Not found", count: 0 };
  }

  const statuses = [...new Set(matches.map(row =>
    String(row[statusColumn - 1] || "").trim()
  ))];

  return {
    success: true,
    found: true,
    status: statuses.length === 1 ? statuses[0] : "Mixed",
    count: matches.length
  };
}

function doGet(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    const action = String(params.action || "all").toLowerCase();

    let result;

    if (action === "all") {
      result = getDatabase();

    } else if (action === "buses") {
      result = {
        success: true,
        data: getSheetData(SHEETS.buses)
      };

    } else if (action === "stops") {
      result = {
        success: true,
        data: getSheetData(SHEETS.stops)
      };

    } else if (action === "schedule") {
      result = {
        success: true,
        data: getSheetData(SHEETS.schedule)
      };

    } else if (action === "servicedays") {
      result = {
        success: true,
        data: getSheetData(SHEETS.serviceDays)
      };

    } else if (action === "contribution_nonce") {
      result = { success: true, nonce: issueContributionNonce_() };

    } else if (action === "submission_status") {
      result = getPublicSubmissionStatus_(params.batch_id);

    } else if (action === "admin_pending") {
      result = getAdminPendingContributions_();
    
    } else if (action === "admin_dashboard") {
  // Verify admin identity only; do not read the Contributions sheet here.
  getAdminIdentity_();

  const template = HtmlService.createTemplateFromFile(
    "AdminDashboard"
  );

  return template.evaluate()
    .setTitle("DU Bus Finder - Admin Dashboard");

    } else if (action === "admin_post_test_page") {
      const auth = getAdminPendingContributions_();

      if (!auth || auth.success !== true) {
        throw new Error("Unauthorized");
      }

      const template = HtmlService.createTemplateFromFile(
        "AdminPostTest"
      );

      template.webAppUrl = ScriptApp.getService().getUrl();

      return template.evaluate()
        .setTitle("DU Bus Finder Admin POST Test");

    } else {
      throw new Error("Invalid action");
    }

    const json = JSON.stringify(result);
    const callback = params.callback;

    if (
      callback &&
      /^[a-zA-Z_$][0-9a-zA-Z_$\.]*$/.test(callback)
    ) {
      return ContentService
        .createTextOutput(callback + "(" + json + ");")
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }

    return ContentService
      .createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.message || "Request failed."
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}



/* =========================================
   3. CONTRIBUTION HELPERS
========================================= */

function contributionResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function contributionHash(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );

  return Utilities.base64EncodeWebSafe(bytes)
    .replace(/=+$/, "");
}

function validateContributionEmail(email) {
  return /^[A-Za-z0-9._%+-]+-[0-9]{10}@subject\.du\.ac\.bd$/i
    .test(String(email || "").trim());
}

function contributionNumber(value, fieldName, required) {
  if (value === "" || value === null || value === undefined) {
    if (required) {
      throw new Error(fieldName + " is required.");
    }

    return "";
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error("Invalid " + fieldName + ".");
  }

  return number;
}


/* =========================================
   4. PUBLIC CONTRIBUTION POST API
========================================= */

function doPost(e) {
  try {
    const rawPayload = e && e.parameter && e.parameter.payload;

    if (!rawPayload) {
      throw new Error("Missing contribution payload.");
    }

    if (String(rawPayload).length > CONTRIBUTION_CONFIG.MAX_PAYLOAD_CHARS) {
      throw new Error("Submission is too large. Please reduce the number of stopages.");
    }

    const payload = JSON.parse(rawPayload);
          /* =====================================
       ADMIN APPROVE / REJECT API
    ===================================== */

    if (payload.action === "admin_review") {

      // Authentication is checked inside adminReview_()
      const id = String(payload.id || "").trim();

      const decision = String(payload.decision || "")
        .trim()
        .toUpperCase();

      const isBatch = payload.is_batch === true;
      const note = String(payload.note || "").trim();

      if (!id) {
        throw new Error("Contribution ID or Batch ID is required.");
      }

      if (!["APPROVE", "REJECT", "REQUEST_CORRECTION"].includes(decision)) {
        throw new Error("Invalid review decision.");
      }

      const result = isBatch
        ? adminReviewBatch(id, decision, note)
        : adminReviewContribution(id, decision, note);

      return contributionResponse(result);
    }
    if (payload.website) {
      return contributionResponse({
        success: false,
        error: "Invalid submission."
      });
    }

    consumeContributionNonce_(payload.nonce);

    const email = String(payload.email || "")
      .trim()
      .toLowerCase();

    if (!validateContributionEmail(email)) {
      throw new Error("Use the required DU email format.");
    }

    const busId = String(payload.bus_id || "").trim();
    const direction = String(payload.direction || "")
      .trim()
      .toUpperCase();

    const tripId = String(payload.trip_id || "").trim();
    const tripTime = String(payload.trip_time || "").trim();
    const stops = payload.stops;

    if (!busId) throw new Error("Bus is required.");

    if (!["UP", "DOWN"].includes(direction)) {
      throw new Error("Invalid direction.");
    }

    if (!tripId) throw new Error("Trip is required.");
    if (!tripTime) throw new Error("Trip time is required.");

    if (
      !Array.isArray(stops) ||
      stops.length < 1 ||
      stops.length > CONTRIBUTION_CONFIG.MAX_STOPS_PER_SUBMISSION
    ) {
      throw new Error("Submit between 1 and 20 stopages.");
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const busSheet = ss.getSheetByName(SHEETS.buses);
    const contributionSheet = ss.getSheetByName(
      CONTRIBUTION_CONFIG.SHEET_NAME
    );

    if (!busSheet || !contributionSheet) {
      throw new Error("Required database sheet is missing.");
    }

    const buses = getSheetData(SHEETS.buses);

    const selectedBus = buses.find(bus =>
      String(bus.bus_id).trim() === busId
    );

    if (!selectedBus) {
      throw new Error("Selected bus was not found.");
    }

    if (!String(selectedBus.bus_name || "").trim()) {
      throw new Error("Selected bus has no bus name.");
    }

    const scheduleRows = getSheetData(SHEETS.schedule);
    const tripRows = scheduleRows.filter(row =>
      String(row.trip_id || "").trim() === tripId
    );

    if (!tripRows.length) {
      throw new Error("Selected trip was not found.");
    }

    const tripMatches = tripRows.every(row =>
      String(row.bus_name || "").trim() === String(selectedBus.bus_name).trim() &&
      String(row.direction || "").trim().toUpperCase() === direction &&
      String(row.trip_time || "").trim() === tripTime
    );

    if (!tripMatches) {
      throw new Error("Trip details do not match the selected bus.");
    }

    const stopTable = getSheetData(SHEETS.stops);
    const validStopIds = new Set(stopTable.map(row =>
      String(row.stop_id || "").trim()
    ).filter(Boolean));

    const cleanStops = stops.map((stop, index) => {
      const operation = String(stop.operation || "ADD")
        .trim()
        .toUpperCase();

      if (!["ADD", "UPDATE", "REMOVE"].includes(operation)) {
        throw new Error(
          "Invalid operation at stopage " + (index + 1)
        );
      }

      const targetSequence = contributionNumber(
        stop.target_sequence,
        "Target sequence",
        operation !== "ADD"
      );

      const sequence = contributionNumber(
        stop.sequence,
        "Sequence",
        operation !== "REMOVE"
      );

      if (sequence !== "" && (!Number.isInteger(sequence) || sequence < 1)) {
        throw new Error("Sequence must be a positive whole number.");
      }
      if (targetSequence !== "" &&
          (!Number.isInteger(targetSequence) || targetSequence < 1)) {
        throw new Error("Target sequence must be a positive whole number.");
      }

      const latitude = contributionNumber(
        stop.latitude,
        "Latitude",
        false
      );

      const longitude = contributionNumber(
        stop.longitude,
        "Longitude",
        false
      );

      if ((latitude === "") !== (longitude === "")) {
        throw new Error(
          "Both latitude and longitude are required together."
        );
      }

      if (
        latitude !== "" &&
        (latitude < -90 || latitude > 90)
      ) {
        throw new Error("Latitude is out of range.");
      }

      if (
        longitude !== "" &&
        (longitude < -180 || longitude > 180)
      ) {
        throw new Error("Longitude is out of range.");
      }

      const stopageName = String(
        stop.stopage_name || ""
      ).trim();

      if (operation === "ADD" && !stopageName) {
        throw new Error("Stopage name is required for a new stop.");
      }

      const stopageTime = String(stop.stopage_time || "").trim();
      if (stopageTime) adminTimeToSheetValue_(stopageTime);

      const stopId = String(stop.stop_id || "").trim();
      if (stopId && !validStopIds.has(stopId)) {
        throw new Error("Selected existing stopage could not be verified.");
      }

      return {
        operation: operation,
        targetSequence: targetSequence,
        sequence: sequence,
        stopId: stopId,
        stopageName: stopageName,
        stopageTime: stopageTime,
        latitude: latitude,
        longitude: longitude,
        contributionType: String(
          stop.contribution_type || "ROUTE"
        ).trim().toUpperCase()
      };
    });

    const lastColumn = contributionSheet.getLastColumn();

    if (lastColumn < 1) {
      throw new Error("Contributions header row is empty.");
    }

    const headers = contributionSheet
      .getRange(1, 1, 1, lastColumn)
      .getDisplayValues()[0]
      .map(header => String(header).trim());

    const requiredHeaders = [
      "contribution_id",
      "batch_id",
      "submitted_at",
      "email",
      "bus_id",
      "direction",
      "trip_time",
      "contribution_type",
      "stop_id",
      "stopage_name",
      "stopage_time",
      "latitude",
      "longitude",
      "status",
      "admin_note",
      "reviewed_at",
      "reviewed_by",
      "operation",
      "trip_id",
      "target_sequence",
      "sequence"
    ];

    const missingHeaders = requiredHeaders.filter(
      header => !headers.includes(header)
    );

    if (missingHeaders.length) {
      throw new Error(
        "Missing Contributions headers: " +
        missingHeaders.join(", ")
      );
    }

    const fingerprint = contributionHash(
      JSON.stringify({
        email,
        busId,
        direction,
        tripId,
        tripTime,
        stops: cleanStops
      })
    );

    const emailHash = contributionHash(email);
    const cache = CacheService.getScriptCache();

    const rateKey = "contrib_rate_" + emailHash;
    const duplicateKey = "contrib_dup_" + fingerprint;

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);

    try {
      if (cache.get(duplicateKey)) {
        throw new Error(
          "Duplicate submission detected. Please wait before trying again."
        );
      }

      const currentCount = Number(cache.get(rateKey) || 0);

      if (
        currentCount >=
        CONTRIBUTION_CONFIG.MAX_SUBMISSIONS_PER_EMAIL
      ) {
        throw new Error(
          "Submission limit reached. Please try again later."
        );
      }

      const now = new Date();
      const submittedAt = now.toISOString();
      const requestedBatchId = String(payload.client_batch_id || "").trim();
      const batchId = /^BATCH-[a-f0-9-]{36}$/i.test(requestedBatchId)
        ? requestedBatchId
        : "BATCH-" + Utilities.getUuid();

      const rows = cleanStops.map(stop => {
        const record = {
          contribution_id: "CON-" + Utilities.getUuid(),
          batch_id: batchId,
          submitted_at: submittedAt,
          email: email,
          bus_id: busId,
          direction: direction,
          trip_time: tripTime,
          contribution_type: stop.contributionType,
          stop_id: stop.stopId,
          stopage_name: stop.stopageName,
          stopage_time: stop.stopageTime,
          latitude: stop.latitude,
          longitude: stop.longitude,
          status: "Pending",
          admin_note: "",
          reviewed_at: "",
          reviewed_by: "",
          operation: stop.operation,
          trip_id: tripId,
          target_sequence: stop.targetSequence,
          sequence: stop.sequence
        };

        return headers.map(header =>
          Object.prototype.hasOwnProperty.call(record, header)
            ? record[header]
            : ""
        );
      });

      const startRow = contributionSheet.getLastRow() + 1;

      contributionSheet
        .getRange(startRow, 1, rows.length, headers.length)
        .setValues(rows);

      cache.put(
        rateKey,
        String(currentCount + 1),
        CONTRIBUTION_CONFIG.RATE_WINDOW_SECONDS
      );

      cache.put(
        duplicateKey,
        "1",
        CONTRIBUTION_CONFIG.DUPLICATE_WINDOW_SECONDS
      );

      return contributionResponse({
        success: true,
        message: "Contribution submitted for admin review.",
        batch_id: batchId,
        submitted_count: rows.length,
        status: "Pending"
      });

    } finally {
      lock.releaseLock();
    }

  } catch (error) {
    return contributionResponse({
      success: false,
      error: error.message || "Submission failed."
    });
  }
}


/* =========================================
   5. ADMIN AUTHENTICATION
========================================= */

function getAdminIdentity_() {
  const expectedEmail = String(
    PropertiesService.getScriptProperties()
      .getProperty("ADMIN_EMAIL") || ""
  ).trim().toLowerCase();

  const activeEmail = String(
    Session.getActiveUser().getEmail() || ""
  ).trim().toLowerCase();

  if (!expectedEmail) {
    throw new Error("ADMIN_EMAIL is not configured.");
  }

  if (!activeEmail) {
    throw new Error(
      "Google account identity is unavailable. " +
      "Use an admin deployment that executes as the accessing user."
    );
  }

  if (activeEmail !== expectedEmail) {
    throw new Error("Unauthorized admin account.");
  }

  return activeEmail;
}

function testAdminIdentity() {
  const email = getAdminIdentity_();

  Logger.log("Admin identity verified: " + email);
}


/* =========================================
   6. ADMIN PENDING CONTRIBUTIONS
========================================= */

function getAdminPendingContributions_() {
  const adminEmail = getAdminIdentity_();

  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CONTRIBUTION_CONFIG.SHEET_NAME);

  if (!sheet) {
    throw new Error("Sheet not found: " + CONTRIBUTION_CONFIG.SHEET_NAME);
  }

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 2 || lastColumn < 1) {
    return {
      success: true,
      admin_email: adminEmail,
      total_pending: 0,
      data: []
    };
  }

  // Read the header and status column first, not the entire Contributions sheet.
  const headers = sheet.getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0]
    .map(header => String(header).trim());

  const statusColumn = headers.indexOf("status") + 1;

  if (statusColumn < 1) {
    throw new Error("Missing Contributions column: status");
  }

  // Let Sheets locate exact Pending cells server-side instead of
  // transferring every status cell to Apps Script.
  const pendingMatches = sheet.getRange(2, statusColumn, lastRow - 1, 1)
    .createTextFinder("pending")
    .matchCase(false)
    .matchEntireCell(true)
    .useRegularExpression(false)
    .findAll();

  // Collect matching sheet row numbers in their original order.
  const pendingRows = pendingMatches
    .map(cell => cell.getRow())
    .sort((a, b) => a - b);

  if (!pendingRows.length) {
    return {
      success: true,
      admin_email: adminEmail,
      total_pending: 0,
      data: []
    };
  }

  // Read full-width data only for pending rows. Adjacent rows are grouped
  // into one range to reduce Spreadsheet service calls.
  const pending = [];
  let blockStart = pendingRows[0];
  let previousRow = pendingRows[0];

  function appendPendingBlock_(startRow, endRow) {
    const values = sheet.getRange(
      startRow,
      1,
      endRow - startRow + 1,
      lastColumn
    ).getDisplayValues();

    values.forEach(row => {
      if (!row.some(cell => String(cell).trim() !== "")) return;

      const record = {};
      headers.forEach((header, index) => {
        if (header) record[header] = row[index] || "";
      });
      pending.push(record);
    });
  }

  for (let i = 1; i < pendingRows.length; i++) {
    const rowNumber = pendingRows[i];

    if (rowNumber !== previousRow + 1) {
      appendPendingBlock_(blockStart, previousRow);
      blockStart = rowNumber;
    }

    previousRow = rowNumber;
  }

  appendPendingBlock_(blockStart, previousRow);

  return {
    success: true,
    admin_email: adminEmail,
    total_pending: pending.length,
    data: pending
  };
}

function getAdminDashboardData() {
  // The dashboard loads pending rows once through this server function.
  return getAdminPendingContributions_();
}

function testAdminPending() {
  const result = getAdminPendingContributions_();

  Logger.log(JSON.stringify(result, null, 2));
}


/* =========================================
   7. ADMIN TABLE HELPERS
========================================= */

function adminLoadTable_(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(sheetName);

  if (!sheet) {
    throw new Error("Missing sheet: " + sheetName);
  }

  const lastColumn = sheet.getLastColumn();

  if (lastColumn < 1) {
    throw new Error("Missing headers: " + sheetName);
  }

  const headers = sheet
    .getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0]
    .map(h => String(h).trim());

  const values = sheet.getLastRow() > 1
    ? sheet.getRange(
        2, 1,
        sheet.getLastRow() - 1,
        lastColumn
      ).getValues()
    : [];

  return {
    sheet: sheet,
    headers: headers,
    values: values
  };
}

function adminCol_(table, name) {
  const index = table.headers.indexOf(name);

  if (index < 0) {
    throw new Error("Missing column: " + name);
  }

  return index;
}

function adminGet_(table, row, name) {
  const index = table.headers.indexOf(name);

  return index < 0 ? "" : row[index];
}

function adminTimeToSheetValue_(value) {
  if (value === "" || value == null) return "";

  let hours;
  let minutes;
  let seconds = 0;

  if (value instanceof Date) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const timezone = ss.getSpreadsheetTimeZone();
    const formatted = Utilities.formatDate(value, timezone, "HH:mm:ss");
    const parts = formatted.split(":");

    hours = Number(parts[0]);
    minutes = Number(parts[1]);
    seconds = Number(parts[2]);

  } else if (typeof value === "number") {
    if (value >= 0 && value < 1) return value;
    throw new Error("Invalid stopage time value.");

  } else {
    const match = String(value).trim().match(
      /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i
    );

    if (!match) {
      throw new Error("Invalid stopage time: " + value);
    }

    hours = Number(match[1]);
    minutes = Number(match[2]);
    seconds = Number(match[3] || 0);

    const period = (match[4] || "").toUpperCase();

    if (minutes > 59 || seconds > 59) {
      throw new Error("Invalid stopage time: " + value);
    }

    if (period) {
      if (hours < 1 || hours > 12) {
        throw new Error("Invalid stopage time: " + value);
      }

      if (period === "AM" && hours === 12) hours = 0;
      if (period === "PM" && hours !== 12) hours += 12;

    } else if (hours > 23) {
      throw new Error("Invalid stopage time: " + value);
    }
  }

  return (
    hours * 3600 +
    minutes * 60 +
    seconds
  ) / 86400;
}


function adminTimesEqual_(a, b) {
  const aEmpty = a === "" || a == null;
  const bEmpty = b === "" || b == null;

  if (aEmpty || bEmpty) return aEmpty && bEmpty;

  const aValue = adminTimeToSheetValue_(a);
  const bValue = adminTimeToSheetValue_(b);

  return Math.abs(aValue - bValue) < (0.5 / 86400);
}


function adminPut_(table, row, name, value) {
  const index = adminCol_(table, name);

  if (name === "stopage_time") {
    value = adminTimeToSheetValue_(value);
  }

  row[index] = value;
}

function adminMakeRow_(table, record) {
  return table.headers.map(header =>
    Object.prototype.hasOwnProperty.call(record, header)
      ? record[header]
      : ""
  );
}

function adminAssertNoDataFormulas_(table) {
  const lastRow = table.sheet.getLastRow();
  if (lastRow < 2) return;

  const formulas = table.sheet.getRange(
    2, 1, lastRow - 1, table.headers.length
  ).getFormulas();

  const hasFormula = formulas.some(row =>
    row.some(formula => String(formula || "").trim() !== "")
  );

  if (hasFormula) {
    throw new Error(
      "Formula cells were found in " + table.sheet.getName() +
      ". Approval was stopped to avoid replacing formulas with static values."
    );
  }
}


/* =========================================
   8. SCHEDULE TARGET FINDER
========================================= */

function adminFindScheduleTarget_(scheduleTable, contribution) {
  const tripIndex = adminCol_(scheduleTable, "trip_id");
  const sequenceIndex = adminCol_(scheduleTable, "sequence");
  const stopIdIndex = scheduleTable.headers.indexOf("stop_id");

  const targetSequence = Number(contribution.target_sequence);
  const targetTrip = String(contribution.trip_id).trim();
  const targetStopId = String(contribution.stop_id || "").trim();

  const matches = [];

  scheduleTable.values.forEach((row, index) => {
    const sameTrip =
      String(row[tripIndex]).trim() === targetTrip;

    const sameSequence =
      Number(row[sequenceIndex]) === targetSequence;

    const sameStop = !targetStopId ||
      (
        stopIdIndex >= 0 &&
        String(row[stopIdIndex]).trim() === targetStopId
      );

    if (sameTrip && sameSequence && sameStop) {
      matches.push({
        rowNumber: index + 2,
        values: row
      });
    }
  });

  if (matches.length !== 1) {
    throw new Error(
      "Could not uniquely find target schedule row for " +
      contribution.contribution_id
    );
  }

  return matches[0];
}


/* =========================================
   9. SAFE APPROVAL APPLY ENGINE
   Sequence-aware ADD / UPDATE / REMOVE
========================================= */


function adminApplyApproved_(contributions) {

  if (!contributions.length) {
    throw new Error("No contributions supplied.");
  }

  const schedule = adminLoadTable_(SHEETS.schedule);
  const stops = adminLoadTable_(SHEETS.stops);
  const buses = adminLoadTable_(SHEETS.buses);

  // This engine reorders full trip rows. Stop rather than flatten sheet formulas.
  adminAssertNoDataFormulas_(schedule);
  adminAssertNoDataFormulas_(stops);

  [
    "bus_name",
    "direction",
    "trip_time",
    "stopage_time",
    "stopage",
    "sequence",
    "verification_status",
    "trip_id",
    "stop_id"
  ].forEach(name => adminCol_(schedule, name));

  [
    "stop_id",
    "stopage_name",
    "latitude",
    "longitude"
  ].forEach(name => adminCol_(stops, name));

  const busIdIndex = adminCol_(buses, "bus_id");
  const busNameIndex = adminCol_(buses, "bus_name");

  const tripIds = [
    ...new Set(contributions.map(c =>
      String(c.trip_id || "").trim()
    ))
  ];

  const busIds = [
    ...new Set(contributions.map(c =>
      String(c.bus_id || "").trim()
    ))
  ];

  if (tripIds.length !== 1 || !tripIds[0]) {
    throw new Error("All contributions must belong to one trip.");
  }

  if (busIds.length !== 1 || !busIds[0]) {
    throw new Error("All contributions must belong to one bus.");
  }

  const tripId = tripIds[0];
  const busId = busIds[0];

  const busMatches = buses.values.filter(row =>
    String(row[busIdIndex]).trim() === busId
  );

  if (busMatches.length !== 1) {
    throw new Error("Bus could not be uniquely identified.");
  }

  const busName = String(
    busMatches[0][busNameIndex]
  ).trim();

  const plans = contributions.map(c => {

    const operation = String(c.operation || "ADD")
      .trim()
      .toUpperCase();

    if (!["ADD", "UPDATE", "REMOVE"].includes(operation)) {
      throw new Error("Invalid operation: " + operation);
    }

    if (
      String(c.trip_id).trim() !== tripId ||
      String(c.bus_id).trim() !== busId
    ) {
      throw new Error("Contribution bus or trip mismatch.");
    }

    const target = operation === "ADD"
      ? null
      : adminFindScheduleTarget_(schedule, c);

    if (operation !== "REMOVE") {

      // UPDATE: unchanged name and time retain existing schedule values.
      if (operation === "UPDATE") {

        const oldName = adminGet_(
          schedule,
          target.values,
          "stopage"
        );

        const oldTime = adminGet_(
          schedule,
          target.values,
          "stopage_time"
        );

        if (!String(c.stopage_name || "").trim()) {
          c.stopage_name = oldName;
        }

        if (
          c.stopage_time === "" ||
          c.stopage_time == null
        ) {
          c.stopage_time = oldTime;
        }
      }

      // ADD requires a name. Time and location are optional.
      if (
        operation === "ADD" &&
        !String(c.stopage_name || "").trim()
      ) {
        throw new Error("Stopage name is required for a new stop.");
      }

      const sequence = Number(c.sequence);

      if (!Number.isInteger(sequence) || sequence < 1) {
        throw new Error("Invalid sequence.");
      }

      // Location is optional, but both coordinates must be supplied together.
      const latEmpty =
        c.latitude === "" || c.latitude == null;

      const lngEmpty =
        c.longitude === "" || c.longitude == null;

      if (latEmpty !== lngEmpty) {
        throw new Error(
          "Latitude and longitude must be supplied together."
        );
      }

      if (!latEmpty) {

        const latitude = Number(c.latitude);
        const longitude = Number(c.longitude);

        if (
          !Number.isFinite(latitude) ||
          latitude < -90 ||
          latitude > 90
        ) {
          throw new Error("Latitude is out of range.");
        }

        if (
          !Number.isFinite(longitude) ||
          longitude < -180 ||
          longitude > 180
        ) {
          throw new Error("Longitude is out of range.");
        }

        c.latitude = latitude;
        c.longitude = longitude;
      }
    }

    return {
      contribution: c,
      operation: operation,
      target: target
    };
  });

  const targetNumbers = plans
    .filter(p => p.target)
    .map(p => p.target.rowNumber);

  if (new Set(targetNumbers).size !== targetNumbers.length) {
    throw new Error("Multiple contributions target the same schedule row.");
  }

  /*
   * Prepare Stops in memory.
   */

  const stopRows = stops.values.map(row => row.slice());

  const stopIdIndex = adminCol_(stops, "stop_id");
  const stopNameIndex = adminCol_(stops, "stopage_name");
  const stopLatIndex = adminCol_(stops, "latitude");
  const stopLngIndex = adminCol_(stops, "longitude");

  function resolveStopId_(c, oldStopId) {

    let stopId = String(c.stop_id || oldStopId || "").trim();

    if (!stopId) {
      stopId = "STP-" + Utilities.getUuid();
    }

    const foundIndex = stopRows.findIndex(row =>
      String(row[stopIdIndex]).trim() === stopId
    );

    if (foundIndex === -1) {

      const newRow = stops.headers.map(() => "");

      newRow[stopIdIndex] = stopId;
      newRow[stopNameIndex] = c.stopage_name || "";
      newRow[stopLatIndex] = c.latitude ?? "";
      newRow[stopLngIndex] = c.longitude ?? "";

      stopRows.push(newRow);

    } else {

      if (c.stopage_name) {
        stopRows[foundIndex][stopNameIndex] = c.stopage_name;
      }

      if (
        c.latitude !== "" && c.latitude != null &&
        c.longitude !== "" && c.longitude != null
      ) {
        stopRows[foundIndex][stopLatIndex] = c.latitude;
        stopRows[foundIndex][stopLngIndex] = c.longitude;
      }
    }

    c.stop_id = stopId;
    return stopId;
  }

  /*
   * Prepare all schedule rows in memory.
   */

  const originalRows = schedule.values.map((row, index) => ({
    values: row.slice(),
    rowNumber: index + 2,
    trip: String(
      adminGet_(schedule, row, "trip_id")
    ).trim() === tripId
  }));

  const tripRows = originalRows.filter(item => item.trip);
  const otherRows = originalRows.filter(item => !item.trip);

  /*
   * Validate that the trip already exists.
   */

  if (!tripRows.length) {
    throw new Error("Selected trip was not found in BusSchedule.");
  }

  /*
   * Ensure the existing trip belongs to the selected bus.
   */

  tripRows.forEach(item => {

    const row = item.values;

    if (
      String(adminGet_(schedule, row, "bus_name")).trim() !== busName
    ) {
      throw new Error("Trip bus name does not match.");
    }
  });

  let workingTrip = tripRows.map(item => ({
    values: item.values.slice(),
    originalRow: item.rowNumber
  }));

  /*
   * Apply REMOVE operations.
   */

  plans
    .filter(p => p.operation === "REMOVE")
    .forEach(plan => {

      const index = workingTrip.findIndex(item =>
        item.originalRow === plan.target.rowNumber
      );

      if (index < 0) {
        throw new Error("Removal target is no longer available.");
      }

      workingTrip.splice(index, 1);
    });

  /*
   * Apply UPDATE operations.
   */

  plans
    .filter(p => p.operation === "UPDATE")
    .sort((a, b) =>
      Number(a.contribution.sequence) -
      Number(b.contribution.sequence)
    )
    .forEach(plan => {

      const c = plan.contribution;

      const index = workingTrip.findIndex(item =>
        item.originalRow === plan.target.rowNumber
      );

      if (index < 0) {
        throw new Error("Update target is no longer available.");
      }

      const item = workingTrip.splice(index, 1)[0];

      const oldStopId = String(
        adminGet_(schedule, plan.target.values, "stop_id") || ""
      ).trim();

      const stopId = resolveStopId_(c, oldStopId);

      adminPut_(schedule, item.values, "stop_id", stopId);
      adminPut_(schedule, item.values, "stopage", c.stopage_name);
      adminPut_(schedule, item.values, "stopage_time", c.stopage_time);
      adminPut_(schedule, item.values, "verification_status", "VERIFIED");

      const newIndex = Math.min(
        Number(c.sequence) - 1,
        workingTrip.length
      );

      workingTrip.splice(newIndex, 0, item);
    });

  /*
   * Apply ADD operations.
   */

  plans
    .filter(p => p.operation === "ADD")
    .sort((a, b) =>
      Number(a.contribution.sequence) -
      Number(b.contribution.sequence)
    )
    .forEach(plan => {

      const c = plan.contribution;

      const stopId = resolveStopId_(c, "");

      const newRow = adminMakeRow_(schedule, {
        bus_name: busName,
        direction: c.direction,
        trip_time: c.trip_time,
        stopage_time: "",
        stopage: c.stopage_name,
        sequence: Number(c.sequence),
        verification_status: "VERIFIED",
        source_image: "",
        trip_id: tripId,
        stop_id: stopId
      });

      // Convert optional ADD time into a spreadsheet time fraction.
      adminPut_(schedule, newRow, "stopage_time", c.stopage_time || "");

      const newItem = {
        values: newRow,
        originalRow: null
      };

      const newIndex = Math.min(
        Number(c.sequence) - 1,
        workingTrip.length
      );

      workingTrip.splice(newIndex, 0, newItem);
    });

  /*
   * Final sequence numbers.
   */

  workingTrip.forEach((item, index) => {
    adminPut_(schedule, item.values, "sequence", index + 1);
  });

  /*
   * Preserve all other trips.
   */

  const firstOriginalIndex = originalRows.findIndex(item => item.trip);

  const otherItems = originalRows
    .filter(item => !item.trip)
    .map(item => item.values);

  const insertAt = originalRows
    .slice(0, firstOriginalIndex)
    .filter(item => !item.trip)
    .length;

  otherItems.splice(
    insertAt,
    0,
    ...workingTrip.map(item => item.values)
  );

  /*
   * Commit prepared data.
   */

  const stopSheet = stops.sheet;
  const scheduleSheet = schedule.sheet;

  const oldStopLastRow = stopSheet.getLastRow();
  const oldScheduleLastRow = scheduleSheet.getLastRow();

  if (oldStopLastRow > 1) {
    stopSheet.getRange(
      2, 1,
      oldStopLastRow - 1,
      stops.headers.length
    ).clearContent();
  }

  if (stopRows.length) {
    stopSheet.getRange(
      2, 1,
      stopRows.length,
      stops.headers.length
    ).setValues(stopRows);
  }

  if (oldScheduleLastRow > 1) {
    scheduleSheet.getRange(
      2, 1,
      oldScheduleLastRow - 1,
      schedule.headers.length
    ).clearContent();
  }

  if (otherItems.length) {
    scheduleSheet.getRange(
      2, 1,
      otherItems.length,
      schedule.headers.length
    ).setValues(otherItems);
  }

  return {
    success: true,
    trip_id: tripId,
    schedule_rows: otherItems.length,
    stop_rows: stopRows.length
  };
}


/* =========================================
   10. ADMIN LOG
========================================= */

function adminWriteLog_(contributionId, action, adminEmail, note) {

  const log = adminLoadTable_("AdminLog");

  const record = {
    log_id: "LOG-" + Utilities.getUuid(),
    contribution_id: contributionId,
    action: action,
    admin: adminEmail,
    timestamp: new Date().toISOString(),
    note: note || ""
  };

  log.sheet.appendRow(adminMakeRow_(log, record));
}


/* =========================================
   11. ROLLBACK HELPERS
========================================= */

function adminTakeSnapshot_(sheetName) {

  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(sheetName);

  if (!sheet) {
    throw new Error("Cannot snapshot missing sheet: " + sheetName);
  }

  const range = sheet.getDataRange();
  return {
    sheet: sheet,
    name: sheetName,
    values: range.getValues(),
    formulas: range.getFormulas()
  };
}


function adminRestoreSnapshot_(snapshot) {

  const sheet = snapshot.sheet;
  const oldValues = snapshot.values;

  const oldRows = oldValues.length;
  const oldColumns = oldValues[0]
    ? oldValues[0].length
    : 1;

  const currentRows = Math.max(
    sheet.getLastRow(),
    oldRows,
    1
  );

  const currentColumns = Math.max(
    sheet.getLastColumn(),
    oldColumns,
    1
  );

  if (sheet.getMaxRows() < oldRows) {
    sheet.insertRowsAfter(
      sheet.getMaxRows(),
      oldRows - sheet.getMaxRows()
    );
  }

  if (sheet.getMaxColumns() < oldColumns) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      oldColumns - sheet.getMaxColumns()
    );
  }

  sheet.getRange(
    1,
    1,
    currentRows,
    currentColumns
  ).clearContent();

  if (oldRows > 0 && oldColumns > 0) {
    sheet.getRange(
      1,
      1,
      oldRows,
      oldColumns
    ).setValues(oldValues);

    const formulas = snapshot.formulas || [];
    formulas.forEach((row, rowIndex) => {
      row.forEach((formula, columnIndex) => {
        if (String(formula || "").trim()) {
          sheet.getRange(rowIndex + 1, columnIndex + 1).setFormula(formula);
        }
      });
    });
  }
}



/* =========================================
   12. INDIVIDUAL + BATCH REVIEW
========================================= */

function adminReviewContribution(contributionId, decision, note) {
  return adminReview_(contributionId, false, decision, note, null);
}

function adminReviewBatch(batchId, decision, note) {
  return adminReview_(batchId, true, decision, note, null);
}

function adminEditApplyBatch(batchId, edits, note) {
  if (!Array.isArray(edits) || !edits.length) {
    throw new Error("At least one edit is required.");
  }
  return adminReview_(batchId, true, "APPROVE", note, edits);
}

function adminReview_(id, isBatch, decision, note, edits) {

  const adminEmail = getAdminIdentity_();

  decision = String(decision || "")
    .trim()
    .toUpperCase();

  if (!["APPROVE", "REJECT", "REQUEST_CORRECTION"].includes(decision)) {
    throw new Error("Invalid review decision.");
  }

  if (decision === "REQUEST_CORRECTION" && !String(note || "").trim()) {
    throw new Error("Add a note explaining the required correction.");
  }

  if (!String(id || "").trim()) {
    throw new Error("Contribution ID or Batch ID is required.");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  let snapshots = [];

  try {

    /*
     * Snapshot all affected sheets before making changes.
     */

    const sheetNames = [
      "Stops",
      "BusSchedule",
      "Contributions",
      "AdminLog"
    ];

    snapshots = sheetNames.map(name =>
      adminTakeSnapshot_(name)
    );

    const table = adminLoadTable_(
      CONTRIBUTION_CONFIG.SHEET_NAME
    );

    const idColumn = isBatch
      ? "batch_id"
      : "contribution_id";

    const idIndex = adminCol_(table, idColumn);
    const statusIndex = adminCol_(table, "status");

    const selected = [];

    table.values.forEach((row, index) => {

      const matches =
        String(row[idIndex]).trim() === String(id).trim();

      const pending =
        String(row[statusIndex]).trim().toLowerCase() === "pending";

      if (matches && pending) {
        selected.push({
          rowNumber: index + 2,
          values: row
        });
      }
    });

    if (!selected.length) {
      throw new Error("No Pending Contribution found.");
    }

    const editMap = new Map();
    if (Array.isArray(edits)) {
      edits.forEach(edit => {
        const contributionId = String(edit.contribution_id || "").trim();
        if (!contributionId || editMap.has(contributionId)) {
          throw new Error("Invalid or duplicate contribution edit.");
        }
        editMap.set(contributionId, edit);
      });
    }

    const contributions = selected.map(item => {
      const c = {};

      table.headers.forEach((header, index) => {
        c[header] = item.values[index];
      });

      c._rowNumber = item.rowNumber;
      c._auditUpdates = [];

      if (decision !== "APPROVE" || !Array.isArray(edits)) return c;

      const contributionId = String(c.contribution_id || "").trim();
      const suppliedEdit = editMap.get(contributionId);

      if (Array.isArray(edits) && !suppliedEdit) {
        throw new Error("Missing edit for contribution: " + contributionId);
      }

      const edit = suppliedEdit || {
        stopage_name: c.stopage_name || "",
        stopage_time: c.stopage_time || "",
        latitude: c.latitude ?? "",
        longitude: c.longitude ?? ""
      };

      const operation = String(c.operation || "ADD")
        .trim().toUpperCase();

      if (!["ADD", "UPDATE", "REMOVE"].includes(operation)) {
        throw new Error("Invalid operation: " + operation);
      }

      c.operation = operation;

      if (operation !== "REMOVE") {
        const editedName = String(edit.stopage_name ?? "").trim();
        const editedTime = String(edit.stopage_time ?? "").trim();

        if (operation === "ADD") {
          // ADD requires a name; time and map location are optional.
          if (!editedName) {
            throw new Error("Stopage name is required for a new stop.");
          }

          c.stopage_name = editedName;
          c.stopage_time = editedTime;

          c._auditUpdates.push(
            ["stopage_name", editedName],
            ["stopage_time", editedTime]
          );

        } else {
          // UPDATE: blank or unchanged values mean preserve BusSchedule values.
          const submittedName = String(c.stopage_name || "").trim();

          if (editedName && editedName !== submittedName) {
            c.stopage_name = editedName;
            c._auditUpdates.push(["stopage_name", editedName]);
          } else {
            c.stopage_name = "";
          }

          if (
            editedTime &&
            !adminTimesEqual_(editedTime, c.stopage_time)
          ) {
            c.stopage_time = editedTime;
            c._auditUpdates.push(["stopage_time", editedTime]);
          } else {
            c.stopage_time = "";
          }
        }

        // Location is optional. If changed, both coordinates are required.
        const latText = String(edit.latitude ?? "").trim();
        const lngText = String(edit.longitude ?? "").trim();

        if (latText !== "" || lngText !== "") {
          if (latText === "" || lngText === "") {
            throw new Error("Both latitude and longitude are required for a location.");
          }

          const latitude = Number(latText);
          const longitude = Number(lngText);

          if (
            !Number.isFinite(latitude) ||
            latitude < -90 || latitude > 90
          ) {
            throw new Error("Invalid latitude.");
          }

          if (
            !Number.isFinite(longitude) ||
            longitude < -180 || longitude > 180
          ) {
            throw new Error("Invalid longitude.");
          }

          const hasOriginalLocation =
            c.latitude !== "" && c.latitude != null &&
            c.longitude !== "" && c.longitude != null;

          const sameAsSubmittedLocation =
            hasOriginalLocation &&
            Math.abs(latitude - Number(c.latitude)) < 0.0000001 &&
            Math.abs(longitude - Number(c.longitude)) < 0.0000001;

          if (operation === "ADD" || !sameAsSubmittedLocation) {
            c.latitude = latitude;
            c.longitude = longitude;
            c._auditUpdates.push(
              ["latitude", latitude],
              ["longitude", longitude]
            );
          } else {
            // Unchanged submitted coordinates must not overwrite Stops.
            c.latitude = "";
            c.longitude = "";
          }

        } else {
          // No location selected: preserve existing Stop coordinates.
          c.latitude = "";
          c.longitude = "";
        }
      }

      return c;
    });

    const applyResult = decision === "APPROVE"
      ? adminApplyApproved_(contributions)
      : null;

    const now = new Date().toISOString();
    const status = decision === "APPROVE"
      ? "Approved"
      : decision === "REJECT"
        ? "Rejected"
        : "Correction Requested";
    const logAction = decision === "APPROVE"
      ? (Array.isArray(edits) ? "ADMIN_EDIT_APPLY" : "APPROVE")
      : decision;

    contributions.forEach(c => {
      const updates = [
        ["status", status],
        ["reviewed_at", now],
        ["reviewed_by", adminEmail],
        ["admin_note", note || ""]
      ].concat(c._auditUpdates || []);

      // Keep the resolved/generated Stop ID in the Contributions audit row.
      if (c.stop_id && decision === "APPROVE") updates.push(["stop_id", c.stop_id]);

      updates.forEach(([column, value]) => {
        const colIndex = table.headers.indexOf(column);

        // Skip optional columns that do not exist in Contributions.
        if (colIndex >= 0) {
          table.sheet
            .getRange(c._rowNumber, colIndex + 1)
            .setValue(value);
        }
      });

      adminWriteLog_(
        c.contribution_id,
        logAction,
        adminEmail,
        note || (decision === "APPROVE"
          ? "Approved contribution."
          : decision === "REJECT"
            ? "Rejected contribution."
            : "Correction requested.")
      );
    });

    return {
      success: true,
      decision: decision,
      action: logAction,
      reviewed_count: contributions.length,
      reviewed_by: adminEmail,
      apply_result: applyResult
    };

  } catch (error) {
    const rollbackErrors = [];

    for (let i = snapshots.length - 1; i >= 0; i--) {
      try {
        adminRestoreSnapshot_(snapshots[i]);
      } catch (restoreError) {
        rollbackErrors.push(
          snapshots[i].name + ": " + restoreError.message
        );
      }
    }

    if (rollbackErrors.length) {
      throw new Error(
        "Admin Edit failed: " + error.message +
        ". Rollback incomplete: " + rollbackErrors.join(" | ")
      );
    }

    throw new Error(
      "Admin Edit failed. Previous sheet data was restored. Reason: " +
      error.message
    );

  } finally {
    lock.releaseLock();
  }
}


/* =========================================
   13. COPY-ONLY STOP ID MIGRATION
   Never edits the original BusSchedule sheet.
========================================= */

function adminNormalizeStopName_(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[.,;:()\-–—]/g, "")
    .replace(/\s+/g, " ");
}

function buildStopIdMigrationPlan_() {
  const schedule = adminLoadTable_(SHEETS.schedule);
  const stops = adminLoadTable_(SHEETS.stops);

  const scheduleStopIdIndex = adminCol_(schedule, "stop_id");
  const scheduleNameIndex = adminCol_(schedule, "stopage");
  const stopIdIndex = adminCol_(stops, "stop_id");
  const stopNameIndex = adminCol_(stops, "stopage_name");

  const stopLookup = new Map();
  stops.values.forEach(row => {
    const name = adminNormalizeStopName_(row[stopNameIndex]);
    const id = String(row[stopIdIndex] || "").trim();
    if (!name || !id) return;
    if (!stopLookup.has(name)) stopLookup.set(name, []);
    stopLookup.get(name).push(id);
  });

  const plan = {
    schedule,
    stopIdColumn: scheduleStopIdIndex + 1,
    updates: [],
    alreadyLinked: 0,
    unknown: 0,
    unmatched: 0,
    ambiguous: 0
  };

  schedule.values.forEach((row, index) => {
    const currentId = String(row[scheduleStopIdIndex] || "").trim();
    const name = String(row[scheduleNameIndex] || "").trim();

    if (currentId) {
      plan.alreadyLinked++;
      return;
    }

    if (!name || name.toUpperCase() === "UNKNOWN") {
      plan.unknown++;
      return;
    }

    const candidates = stopLookup.get(adminNormalizeStopName_(name)) || [];
    const uniqueIds = [...new Set(candidates)];

    if (uniqueIds.length === 1) {
      plan.updates.push({
        rowNumber: index + 2,
        stopId: uniqueIds[0]
      });
    } else if (uniqueIds.length > 1) {
      plan.ambiguous++;
    } else {
      plan.unmatched++;
    }
  });

  return plan;
}

function adminPreviewStopIdMigration() {
  const adminEmail = getAdminIdentity_();
  const plan = buildStopIdMigrationPlan_();

  return {
    success: true,
    admin_email: adminEmail,
    original_sheet: SHEETS.schedule,
    original_modified: false,
    rows_with_unique_candidate: plan.updates.length,
    already_linked: plan.alreadyLinked,
    unknown_or_blank_name: plan.unknown,
    unmatched: plan.unmatched,
    ambiguous: plan.ambiguous,
    action: "PREVIEW_ONLY"
  };
}

function adminCreateStopIdMigrationCopy() {
  const adminEmail = getAdminIdentity_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  let copy = null;

  try {
    const plan = buildStopIdMigrationPlan_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const stamp = Utilities.formatDate(
      new Date(),
      ss.getSpreadsheetTimeZone(),
      "yyyyMMdd_HHmmss"
    );

    let name = "BusSchedule_Migration_" + stamp;
    let suffix = 1;
    while (ss.getSheetByName(name)) {
      name = "BusSchedule_Migration_" + stamp + "_" + suffix;
      suffix++;
    }

    copy = plan.schedule.sheet.copyTo(ss);
    copy.setName(name);

    if (plan.schedule.values.length && plan.updates.length) {
      const idRange = copy.getRange(
        2,
        plan.stopIdColumn,
        plan.schedule.values.length,
        1
      );
      const idValues = idRange.getValues();
      const idFormulas = idRange.getFormulas();

      plan.updates.forEach(update => {
        const rowIndex = update.rowNumber - 2;
        if (String(idFormulas[rowIndex][0] || "").trim()) {
          throw new Error("A stop_id formula was found in the copied sheet; migration copy was not changed.");
        }
        idValues[rowIndex][0] = update.stopId;
      });

      // Only the stop_id column in the copied sheet is updated.
      copy.getRange(
        2,
        plan.stopIdColumn,
        idValues.length,
        1
      ).setValues(idValues);
    }

    return {
      success: true,
      admin_email: adminEmail,
      original_sheet: SHEETS.schedule,
      original_modified: false,
      copy_sheet: name,
      rows_with_unique_candidate: plan.updates.length,
      already_linked: plan.alreadyLinked,
      unknown_or_blank_name: plan.unknown,
      unmatched: plan.unmatched,
      ambiguous: plan.ambiguous
    };

  } catch (error) {
    if (copy) {
      try {
        SpreadsheetApp.getActiveSpreadsheet().deleteSheet(copy);
      } catch (cleanupError) {
        throw new Error(
          "Migration copy failed: " + error.message +
          ". Temporary copy cleanup failed: " + cleanupError.message
        );
      }
    }
    throw error;

  } finally {
    lock.releaseLock();
  }
}


/* =========================================
   14. ADMIN EXISTING STOP LOCATION MANAGER
========================================= */

function getAdminStopLocationOptions() {
  const adminEmail = getAdminIdentity_();
  const rows = getSheetData(SHEETS.stops);

  return {
    success: true,
    admin_email: adminEmail,
    data: rows.map(row => ({
      stop_id: String(row.stop_id || ""),
      stopage_name: String(row.stopage_name || ""),
      latitude: String(row.latitude || ""),
      longitude: String(row.longitude || "")
    }))
  };
}

function adminSetStopLocation(stopId, latitude, longitude, note) {
  const adminEmail = getAdminIdentity_();
  const id = String(stopId || "").trim();
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!id) throw new Error("Select an existing stopage.");
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error("Latitude is invalid.");
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error("Longitude is invalid.");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let snapshots = [];

  try {
    snapshots = [
      adminTakeSnapshot_(SHEETS.stops),
      adminTakeSnapshot_("AdminLog")
    ];

    const table = adminLoadTable_(SHEETS.stops);
    const idIndex = adminCol_(table, "stop_id");
    const latIndex = adminCol_(table, "latitude");
    const lngIndex = adminCol_(table, "longitude");

    const matches = [];
    table.values.forEach((row, index) => {
      if (String(row[idIndex] || "").trim() === id) {
        matches.push(index + 2);
      }
    });

    if (matches.length !== 1) {
      throw new Error("Stopage ID could not be uniquely identified.");
    }

    const rowNumber = matches[0];
    const latitudeCell = table.sheet.getRange(rowNumber, latIndex + 1);
    const longitudeCell = table.sheet.getRange(rowNumber, lngIndex + 1);

    if (latitudeCell.getFormula() || longitudeCell.getFormula()) {
      throw new Error("Selected coordinate cells contain formulas and cannot be overwritten.");
    }

    latitudeCell.setValue(lat);
    longitudeCell.setValue(lng);

    adminWriteLog_(
      "STOP:" + id,
      "ADMIN_SET_STOP_LOCATION",
      adminEmail,
      String(note || "").trim() || "Admin updated existing stopage coordinates."
    );

    return {
      success: true,
      stop_id: id,
      latitude: lat,
      longitude: lng,
      updated_by: adminEmail
    };

  } catch (error) {
    const rollbackErrors = [];
    for (let index = snapshots.length - 1; index >= 0; index--) {
      try {
        adminRestoreSnapshot_(snapshots[index]);
      } catch (restoreError) {
        rollbackErrors.push(
          snapshots[index].name + ": " + restoreError.message
        );
      }
    }
    if (rollbackErrors.length) {
      throw new Error(
        "Location update failed: " + error.message +
        ". Rollback incomplete: " + rollbackErrors.join(" | ")
      );
    }
    throw new Error("Location update failed. Previous sheet data was restored. Reason: " + error.message);

  } finally {
    lock.releaseLock();
  }
}
