/**
 * Team Chitrak recruitment endpoint.
 *
 * This script is bound to the recruitment spreadsheet
 * (Spreadsheet → Extensions → Apps Script). It writes one validated row per
 * registration to the "Responses" tab.
 *
 * Deploy: Deploy → New deployment → Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * No Google Cloud project, API key, service account or billing is required.
 * The spreadsheet stays private; the web app can only append rows.
 */

var MESSAGE_SOURCE = "chitrak-recruitment";
var SHEET_NAME = "Responses";
var CONSENT_VERSION = "v1";
var IDEM_TTL_SECONDS = 6 * 60 * 60;
var RATE_LIMIT_PER_EMAIL = 5; // per 6 hours
var CONTACT_EMAIL = "chitrak@rvce.edu.in";

var HEADERS = [
  "Submission ID",
  "Timestamp",
  "Full Name",
  "Email",
  "Phone",
  "USN",
  "Year",
  "Branch",
  "Preferred Department",
  "Skills",
  "Experience",
  "Projects",
  "Motivation",
  "Portfolio",
  "GitHub",
  "LinkedIn",
  "Availability",
  "Consent",
  "Application Status"
];

var LIMITS = {
  fullName: 100,
  email: 254,
  phone: 20,
  usn: 20,
  year: 40,
  branch: 80,
  department: 80,
  skills: 600,
  experience: 1000,
  projects: 1500,
  motivation: 2000,
  url: 300
};

var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
var NAME_RE = /^[\p{L}\p{M} .'’\-]+$/u;
var USN_RE = /^[A-Za-z0-9-]{4,20}$/;
var PHONE_RE = /^\+?[0-9]{10,15}$/;

/* ---------- web app entry points ---------- */

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: "chitrak-recruitment" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var params = (e && e.parameter) || {};
  var result;
  try {
    result = processSubmission(params);
  } catch (error) {
    console.error("[recruitment]", error && error.name ? error.name : "Error");
    if (error && error.name === "ConfigError") {
      result = {
        ok: false,
        code: "not_configured",
        message: "The registration sheet is not ready. Please email " + CONTACT_EMAIL + "."
      };
    } else {
      result = {
        ok: false,
        code: "server_error",
        message: "Your registration could not be confirmed. Please try again, or email " + CONTACT_EMAIL + "."
      };
    }
  }
  result.nonce = clean(params.nonce).slice(0, 120);
  return HtmlService
    .createHtmlOutput(resultPage(result))
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ---------- submission pipeline ---------- */

function processSubmission(params) {
  params = params || {};

  // Honeypot: a real applicant never fills this off-screen field.
  if (clean(params.company)) return botRejection();

  var startedAt = Number(params.startedAt);
  var now = Date.now();
  if (!isFinite(startedAt) || startedAt <= 0 || now - startedAt < 2500) return botRejection();
  if (now - startedAt > 24 * 60 * 60 * 1000) {
    return {
      ok: false,
      code: "validation_error",
      message: "This form has expired. Reload the page and try again.",
      errors: { form: "This form has expired. Reload the page and try again." }
    };
  }

  var validation = validateSubmission(params);
  if (!validation.ok) {
    return {
      ok: false,
      code: "validation_error",
      message: "Please correct the highlighted fields and submit again.",
      errors: validation.errors
    };
  }

  var data = validation.data;
  var cache = CacheService.getScriptCache();
  var idemKey = clean(params.idempotencyKey).slice(0, 200);
  var cacheKey = idemKey ? "idem:" + hash(idemKey) : "";

  if (cacheKey) {
    var cached = cache.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (ignored) {}
    }
  }

  if (!allowRate(data.email, cache)) {
    return {
      ok: false,
      code: "rate_limited",
      message: "Too many registration attempts for this email. Please wait and try again, or email " + CONTACT_EMAIL + "."
    };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return {
      ok: false,
      code: "in_progress",
      message: "A registration with these details is already being processed. Wait a moment before trying again."
    };
  }

  try {
    var sheet = getSheet();
    if (isDuplicate(sheet, data.email, data.usn)) {
      return {
        ok: false,
        code: "already_registered",
        message: "A registration with this email or USN already exists. Email " + CONTACT_EMAIL + " if you need to update it."
      };
    }

    var id = submissionId();
    var timestamp = new Date().toISOString();
    sheet.appendRow(buildRow(data, id, timestamp));

    var result = { ok: true, submissionId: id, timestamp: timestamp };
    if (cacheKey) cache.put(cacheKey, JSON.stringify(result), IDEM_TTL_SECONDS);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function validateSubmission(input) {
  var errors = {};

  var fullName = clean(input.fullName);
  if (!fullName) errors.fullName = "Enter your full name.";
  else if (fullName.length < 2) errors.fullName = "Enter at least 2 characters.";
  else if (fullName.length > LIMITS.fullName) errors.fullName = "Keep your name under " + LIMITS.fullName + " characters.";
  else if (!NAME_RE.test(fullName)) errors.fullName = "Use letters, spaces, hyphens, apostrophes or periods only.";

  var email = clean(input.email).toLowerCase();
  if (!email) errors.email = "Enter your college email address.";
  else if (email.length > LIMITS.email || !EMAIL_RE.test(email)) errors.email = "Enter a valid email address.";

  var phone = normalizePhone(input.phone);
  if (!phone) errors.phone = "Enter your phone number.";
  else if (!PHONE_RE.test(phone)) errors.phone = "Enter 10–15 digits, with country code if needed.";

  var usn = clean(input.usn).toUpperCase();
  if (!usn) errors.usn = "Enter your USN or student ID.";
  else if (!USN_RE.test(usn)) errors.usn = "Use 4–20 letters, numbers or hyphens.";

  var year = clean(input.year);
  if (!year) errors.year = "Select your current year of study.";
  else if (year.length > LIMITS.year) errors.year = "Select a valid year of study.";

  var branch = clean(input.branch);
  if (!branch) errors.branch = "Enter your branch or department.";
  else if (branch.length < 2) errors.branch = "Enter at least 2 characters.";
  else if (branch.length > LIMITS.branch) errors.branch = "Keep this under " + LIMITS.branch + " characters.";

  var department = clean(input.department);
  if (!department) errors.department = "Select a preferred team or department.";
  else if (department.length > LIMITS.department) errors.department = "Select a valid option.";

  var skills = clean(input.skills);
  if (!skills) errors.skills = "Tell the team about your technical skills.";
  else if (skills.length < 2) errors.skills = "Add a little more detail.";
  else if (skills.length > LIMITS.skills) errors.skills = "Keep this under " + LIMITS.skills + " characters.";

  var experience = clean(input.experience);
  if (experience.length > LIMITS.experience) errors.experience = "Keep this under " + LIMITS.experience + " characters.";

  var projects = clean(input.projects);
  if (projects.length > LIMITS.projects) errors.projects = "Keep this under " + LIMITS.projects + " characters.";

  var motivation = clean(input.motivation);
  if (!motivation) errors.motivation = "Tell the team why you want to join.";
  else if (motivation.length < 40) errors.motivation = "Add a little more detail (40 characters minimum).";
  else if (motivation.length > LIMITS.motivation) errors.motivation = "Keep this under " + LIMITS.motivation + " characters.";

  var portfolio = normalizeUrl(input.portfolio);
  if (!validUrl(portfolio)) errors.portfolio = "Enter a valid http or https URL.";

  var github = normalizeUrl(input.github);
  if (!validUrl(github)) errors.github = "Enter a valid http or https URL.";

  var linkedin = normalizeUrl(input.linkedin);
  if (!validUrl(linkedin)) errors.linkedin = "Enter a valid http or https URL.";

  var consent = isChecked(input.consent);
  if (!consent) errors.consent = "You must consent to the collection and use of your registration data.";

  var ok = Object.keys(errors).length === 0;
  return {
    ok: ok,
    errors: errors,
    data: ok ? {
      fullName: fullName,
      email: email,
      phone: phone,
      usn: usn,
      year: year,
      branch: branch,
      department: department,
      skills: skills,
      experience: experience,
      projects: projects,
      motivation: motivation,
      portfolio: portfolio,
      github: github,
      linkedin: linkedin,
      commitment: isChecked(input.commitment) ? "Yes" : "No",
      consent: true
    } : null
  };
}

/* ---------- spreadsheet ---------- */

function getSheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw configError("The script is not bound to a spreadsheet.");

  var sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    sheet.setFrozenRows(1);
  }

  var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  var current = sheet.getLastRow() === 0 ? [] : headerRange.getValues()[0];
  var isEmpty = current.join("") === "";

  if (isEmpty) {
    headerRange.setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  for (var i = 0; i < HEADERS.length; i += 1) {
    if (String(current[i] || "").trim() !== HEADERS[i]) {
      throw configError("Header row does not match the recruitment schema.");
    }
  }
  return sheet;
}

function isDuplicate(sheet, email, usn) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  var values = sheet.getRange(2, 4, lastRow - 1, 3).getValues(); // D:F = email, phone, USN
  for (var i = 0; i < values.length; i += 1) {
    var rowEmail = String(values[i][0] || "").trim().toLowerCase();
    var rowUsn = String(values[i][2] || "").trim().toUpperCase();
    if (rowEmail === email || (usn && rowUsn === usn)) return true;
  }
  return false;
}

function buildRow(data, id, timestamp) {
  return [
    id,
    timestamp,
    data.fullName,
    data.email,
    data.phone,
    data.usn,
    data.year,
    data.branch,
    data.department,
    data.skills,
    data.experience,
    data.projects,
    data.motivation,
    data.portfolio,
    data.github,
    data.linkedin,
    data.commitment,
    "Yes — privacy notice " + CONSENT_VERSION,
    "New"
  ].map(escapeCell);
}

/* ---------- validation helpers ---------- */

function clean(value) {
  if (typeof value === "string") {
    return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  }
  if (typeof value === "number" && isFinite(value)) return String(value);
  return "";
}

function normalizePhone(value) {
  return clean(value).replace(/[\s().-]/g, "");
}

function normalizeUrl(value) {
  var url = clean(value);
  if (!url) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = "https://" + url;
  return url;
}

function validUrl(value) {
  if (!value) return true;
  if (value.length > LIMITS.url) return false;
  var match = /^https?:\/\/([^\/?#\s]+)([\/?#]\S*)?$/i.exec(value);
  if (!match) return false;
  var host = match[1];
  if (host.indexOf("@") !== -1) return false;
  return host.indexOf(".") !== -1;
}

function isChecked(value) {
  return value === true || value === "yes" || value === "on" || value === 1 || value === "true";
}

/* Prevent spreadsheet formula injection. International phone numbers are kept
   readable and cannot form a dangerous formula. */
function escapeCell(value) {
  var cell = String(value == null ? "" : value).replace(/\r/g, "");
  if (/^\+\d[\d\s()-]*$/.test(cell)) return cell;
  if (/^[=+\-@\t]/.test(cell)) cell = "'" + cell;
  return cell;
}

/* ---------- infrastructure helpers ---------- */

function submissionId() {
  var date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  var random = Utilities.getUuid().replace(/-/g, "").slice(0, 8).toUpperCase();
  return "CHK-" + date + "-" + random;
}

function allowRate(email, cache) {
  var key = "rate:" + hash(email);
  var count = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(count), IDEM_TTL_SECONDS);
  return count <= RATE_LIMIT_PER_EMAIL;
}

function hash(value) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  var hex = "";
  for (var i = 0; i < bytes.length; i += 1) {
    var byteValue = (bytes[i] + 256) % 256;
    if (byteValue < 16) hex += "0";
    hex += byteValue.toString(16);
  }
  return hex;
}

function botRejection() {
  return {
    ok: false,
    code: "invalid_request",
    message: "The submission could not be processed. Reload the page and try again."
  };
}

function configError(message) {
  var error = new Error(message);
  error.name = "ConfigError";
  return error;
}

function resultPage(result) {
  var payload = JSON.stringify({ source: MESSAGE_SOURCE, result: result }).replace(/</g, "\\u003c");
  return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body><script>" +
    "window.top.postMessage(" + payload + ", \"*\");" +
    "</script></body></html>";
}

/* Exposed only when loaded by Node for tests; Apps Script has no `module`. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HEADERS: HEADERS,
    LIMITS: LIMITS,
    SHEET_NAME: SHEET_NAME,
    doGet: doGet,
    doPost: doPost,
    processSubmission: processSubmission,
    validateSubmission: validateSubmission,
    buildRow: buildRow,
    escapeCell: escapeCell,
    normalizeUrl: normalizeUrl,
    normalizePhone: normalizePhone,
    resultPage: resultPage
  };
}
