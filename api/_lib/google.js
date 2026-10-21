/* Minimal Google Sheets client using a service account.
   No npm dependencies: JWT signing uses node:crypto and HTTP uses fetch.
   Credentials are read only from server-side environment variables. */

const crypto = require("node:crypto");
const { HEADERS } = require("./validation");

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_API_BASE = "https://sheets.googleapis.com";

let tokenCache = null;
const sheetReady = new Map();

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

class GoogleApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

function env(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sheetId() {
  const id = env("GOOGLE_SHEET_ID");
  if (!id) throw new ConfigError("GOOGLE_SHEET_ID is not configured.");
  return id;
}

function tabName() {
  return env("GOOGLE_SHEET_TAB", "Responses");
}

function apiBase() {
  return env("GOOGLE_SHEETS_API_BASE", DEFAULT_API_BASE).replace(/\/+$/, "");
}

function tokenUrl() {
  return env("GOOGLE_OAUTH_TOKEN_URL", DEFAULT_TOKEN_URL);
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function privateKey() {
  const raw = env("GOOGLE_PRIVATE_KEY");
  if (!raw) return "";
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertGoogleConfigured() {
  if (env("GOOGLE_ACCESS_TOKEN")) return;
  const missing = [];
  if (!env("GOOGLE_SERVICE_ACCOUNT_EMAIL")) missing.push("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  if (!privateKey()) missing.push("GOOGLE_PRIVATE_KEY");
  if (missing.length) {
    throw new ConfigError(`Google service account is not configured (${missing.join(", ")}).`);
  }
}

async function getAccessToken() {
  assertGoogleConfigured();

  // Test/local escape hatch. Never needed in production.
  if (env("GOOGLE_ACCESS_TOKEN")) return env("GOOGLE_ACCESS_TOKEN");

  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt > now + 60) return tokenCache.token;

  const issuedAt = now;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: env("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    scope: SCOPE,
    aud: tokenUrl(),
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  let signature;
  try {
    signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), privateKey());
  } catch {
    throw new ConfigError("GOOGLE_PRIVATE_KEY could not be parsed. Paste the full service-account key, including the BEGIN/END lines.");
  }

  const assertion = `${unsigned}.${base64url(signature)}`;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  let response;
  try {
    response = await fetch(tokenUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new GoogleApiError(0, "Google token endpoint could not be reached.");
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new GoogleApiError(response.status, `Google token request failed (${response.status}). ${text.slice(0, 160)}`);
  }

  const data = await response.json();
  if (!data || !data.access_token) throw new GoogleApiError(0, "Google token response was missing access_token.");
  tokenCache = {
    token: data.access_token,
    expiresAt: now + Number(data.expires_in || 3600),
  };
  return tokenCache.token;
}

async function sheetsRequest(path, { method = "GET", body, retry = true } = {}) {
  const token = await getAccessToken();
  const id = sheetId();
  const url = `${apiBase()}/v4/spreadsheets/${encodeURIComponent(id)}${path}`;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    if (retry) {
      await sleep(250);
      return sheetsRequest(path, { method, body, retry: false });
    }
    throw new GoogleApiError(0, "Google Sheets could not be reached.");
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }

  if (!response.ok) {
    if (retry && (response.status === 429 || response.status >= 500)) {
      await sleep(300);
      return sheetsRequest(path, { method, body, retry: false });
    }
    const apiMessage = data && data.error && data.error.message
      ? String(data.error.message).slice(0, 240)
      : text.slice(0, 240);
    throw new GoogleApiError(response.status, `Google Sheets request failed (${response.status}). ${apiMessage}`);
  }

  return data;
}

function range(tab, cells) {
  return `${tab}!${cells}`;
}

async function spreadsheetMeta() {
  return sheetsRequest("?fields=sheets.properties.title,sheets.properties.sheetId");
}

async function ensureSheet(tab = tabName(), { repairHeaders = false } = {}) {
  const cacheKey = `${tab}:${repairHeaders ? "repair" : "strict"}`;
  if (sheetReady.has(cacheKey)) return sheetReady.get(cacheKey);

  const task = (async () => {
    let meta = await spreadsheetMeta();
    let sheet = (meta.sheets || []).find((s) => s && s.properties && s.properties.title === tab);

    if (!sheet) {
      await sheetsRequest(":batchUpdate", {
        method: "POST",
        body: { requests: [{ addSheet: { properties: { title: tab } } }] },
      });
      meta = await spreadsheetMeta();
      sheet = (meta.sheets || []).find((s) => s && s.properties && s.properties.title === tab);
    }
    if (!sheet) throw new ConfigError(`The spreadsheet tab "${tab}" could not be created or found.`);

    const headerRange = range(tab, "A1:S1");
    const result = await sheetsRequest(`/values/${encodeURIComponent(headerRange)}`);
    const existing = (result && result.values && result.values[0]) || [];
    const matches = HEADERS.every((header, index) => existing[index] === header);

    if (!existing.length) {
      await sheetsRequest(
        `/values/${encodeURIComponent(headerRange)}?valueInputOption=RAW`,
        { method: "PUT", body: { values: [HEADERS] } }
      );
    } else if (!matches) {
      if (!repairHeaders) {
        throw new ConfigError(
          `The header row in "${tab}" does not match the expected ${HEADERS.length}-column recruitment schema. ` +
          "Run `npm run setup:sheet` to repair it, or use a dedicated recruitment spreadsheet tab."
        );
      }
      await sheetsRequest(
        `/values/${encodeURIComponent(headerRange)}?valueInputOption=RAW`,
        { method: "PUT", body: { values: [HEADERS] } }
      );
    }

    return { tab, sheetId: sheet.properties.sheetId };
  })();

  sheetReady.set(cacheKey, task);
  try {
    return await task;
  } catch (error) {
    sheetReady.delete(cacheKey);
    throw error;
  }
}

async function getExistingIdentities(tab = tabName()) {
  const path = `/values:batchGet?ranges=${encodeURIComponent(range(tab, "D2:D"))}&ranges=${encodeURIComponent(range(tab, "F2:F"))}`;
  const data = await sheetsRequest(path);
  const valueRanges = (data && data.valueRanges) || [];
  const valuesOf = (rangeData) => ((rangeData && rangeData.values) || []).map((row) => String((row && row[0]) || "").trim());
  return {
    emails: valuesOf(valueRanges[0]).map((value) => value.toLowerCase()).filter(Boolean),
    usns: valuesOf(valueRanges[1]).map((value) => value.toUpperCase()).filter(Boolean),
  };
}

async function appendRow(row, tab = tabName()) {
  const cellRange = range(tab, "A:S");
  const path = `/values/${encodeURIComponent(cellRange)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const data = await sheetsRequest(path, {
    method: "POST",
    body: { majorDimension: "ROWS", values: [row] },
  });
  if (!data || !data.updates || !data.updates.updatedRange) {
    throw new GoogleApiError(0, "Google Sheets did not confirm the appended row.");
  }
  return data.updates;
}

async function readValues(rangeA1) {
  const data = await sheetsRequest(`/values/${encodeURIComponent(rangeA1)}`);
  return (data && data.values) || [];
}

async function deleteRows(sheetIdValue, ranges) {
  if (!Array.isArray(ranges) || !ranges.length) return;
  const requests = ranges.map(({ startIndex, endIndex }) => ({
    deleteDimension: {
      range: {
        sheetId: sheetIdValue,
        dimension: "ROWS",
        startIndex,
        endIndex,
      },
    },
  }));
  await sheetsRequest(":batchUpdate", { method: "POST", body: { requests } });
}

function resetCacheForTests() {
  tokenCache = null;
  sheetReady.clear();
}

module.exports = {
  ConfigError,
  GoogleApiError,
  getAccessToken,
  ensureSheet,
  getExistingIdentities,
  appendRow,
  readValues,
  deleteRows,
  spreadsheetMeta,
  tabName,
  HEADERS,
  resetCacheForTests,
};
