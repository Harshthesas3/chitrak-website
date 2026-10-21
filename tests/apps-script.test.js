const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  HEADERS,
  SHEET_NAME,
  processSubmission,
} = require("../apps-script/Code.gs");

function createSheet(rows = [HEADERS.slice()]) {
  return {
    name: SHEET_NAME,
    rows,
    frozenRows: 0,
    getLastRow() { return this.rows.length; },
    getRange(row, column, numRows, numColumns) {
      const sheet = this;
      return {
        getValues() {
          const output = [];
          for (let r = 0; r < numRows; r += 1) {
            const source = sheet.rows[row - 1 + r] || [];
            const values = [];
            for (let c = 0; c < numColumns; c += 1) {
              values.push(source[column - 1 + c] === undefined ? "" : source[column - 1 + c]);
            }
            output.push(values);
          }
          return output;
        },
        setValues(values) {
          for (let r = 0; r < values.length; r += 1) {
            if (!sheet.rows[row - 1 + r]) sheet.rows[row - 1 + r] = [];
            for (let c = 0; c < values[r].length; c += 1) {
              sheet.rows[row - 1 + r][column - 1 + c] = values[r][c];
            }
          }
        },
      };
    },
    appendRow(values) { this.rows.push(values.slice()); },
    setFrozenRows(count) { this.frozenRows = count; },
  };
}

function createBook(sheet) {
  return {
    getSheetByName(name) { return sheet && sheet.name === name ? sheet : null; },
    insertSheet(name) {
      if (!sheet) sheet = createSheet([]);
      sheet.name = name;
      return sheet;
    },
  };
}

function validParams(overrides = {}) {
  return {
    fullName: "T Harshith Krishna Sastry",
    email: "harshith@rvce.edu.in",
    phone: "+91 98765 43210",
    usn: "1RV21CS001",
    year: "3rd year",
    branch: "Computer Science and Engineering",
    department: "Open application",
    skills: "JavaScript, CAD, fabrication",
    experience: "Formula Student chassis work.",
    projects: "Built a telemetry dashboard.",
    motivation: "I want to help build and test the next Chitrak electric motorcycle.",
    portfolio: "https://example.com/portfolio",
    github: "https://github.com/example",
    linkedin: "",
    consent: "yes",
    commitment: "no",
    company: "",
    startedAt: String(Date.now() - 5000),
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  };
}

let sheet;
let cache;
let lock;

test.beforeEach(() => {
  sheet = createSheet();
  cache = new Map();
  lock = { busy: false, releases: 0 };
  globalThis.SpreadsheetApp = {
    getActiveSpreadsheet: () => createBook(sheet),
  };
  globalThis.CacheService = {
    getScriptCache: () => ({
      get: (key) => cache.get(key) || null,
      put: (key, value) => { cache.set(key, value); },
    }),
  };
  globalThis.LockService = {
    getScriptLock: () => ({
      tryLock: () => !lock.busy,
      releaseLock: () => { lock.releases += 1; },
    }),
  };
  globalThis.Utilities = {
    DigestAlgorithm: { SHA_256: "sha256" },
    Charset: { UTF_8: "utf8" },
    computeDigest: (algorithm, value) => Array.from(
      crypto.createHash("sha256").update(String(value)).digest()
    ),
    getUuid: () => crypto.randomUUID(),
  };
});

test("valid submission appends exactly one complete row", () => {
  const result = processSubmission(validParams());
  assert.equal(result.ok, true);
  assert.match(result.submissionId, /^CHK-\d{8}-[A-F0-9]{8}$/);
  assert.ok(result.timestamp);
  assert.equal(sheet.rows.length, 2);
  assert.equal(sheet.rows[1].length, HEADERS.length);
  assert.equal(sheet.rows[1][0], result.submissionId);
  assert.equal(sheet.rows[1][3], "harshith@rvce.edu.in");
  assert.equal(sheet.rows[1][4], "+919876543210");
  assert.equal(sheet.rows[1][17], "Yes — privacy notice v1");
  assert.equal(sheet.rows[1][18], "New");
});

test("invalid submissions are rejected before any write", () => {
  const result = processSubmission(validParams({
    email: "not-an-email",
    phone: "123",
    consent: "no",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "validation_error");
  assert.match(result.errors.email, /valid email/i);
  assert.match(result.errors.phone, /10–15 digits/i);
  assert.match(result.errors.consent, /consent/i);
  assert.equal(sheet.rows.length, 1);
});

test("repeated email or USN is rejected as a duplicate", () => {
  const first = processSubmission(validParams());
  assert.equal(first.ok, true);

  const sameEmail = processSubmission(validParams({
    usn: "1RV21CS002",
    idempotencyKey: crypto.randomUUID(),
  }));
  assert.equal(sameEmail.ok, false);
  assert.equal(sameEmail.code, "already_registered");

  const sameUsn = processSubmission(validParams({
    email: "other@rvce.edu.in",
    idempotencyKey: crypto.randomUUID(),
  }));
  assert.equal(sameUsn.ok, false);
  assert.equal(sameUsn.code, "already_registered");
  assert.equal(sheet.rows.length, 2);
});

test("same idempotency key replays the same result without another row", () => {
  const params = validParams();
  const first = processSubmission(params);
  assert.equal(first.ok, true);

  const second = processSubmission(params);
  assert.equal(second.ok, true);
  assert.equal(second.submissionId, first.submissionId);
  assert.equal(sheet.rows.length, 2);
});

test("a busy lock returns in_progress and writes nothing", () => {
  lock.busy = true;
  const result = processSubmission(validParams());
  assert.equal(result.ok, false);
  assert.equal(result.code, "in_progress");
  assert.equal(sheet.rows.length, 1);
});

test("honeypot and impossibly fast submissions receive a generic rejection", () => {
  const honeypot = processSubmission(validParams({ company: "spam-bot" }));
  assert.equal(honeypot.code, "invalid_request");

  const fast = processSubmission(validParams({ startedAt: String(Date.now() - 1000) }));
  assert.equal(fast.code, "invalid_request");
  assert.equal(sheet.rows.length, 1);
});

test("stale forms are rejected with an expiry message", () => {
  const result = processSubmission(validParams({
    startedAt: String(Date.now() - 25 * 60 * 60 * 1000),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "validation_error");
  assert.match(result.errors.form, /expired/i);
});

test("per-email rate limit blocks excess attempts", () => {
  let last;
  for (let i = 0; i < 6; i += 1) {
    last = processSubmission(validParams({ idempotencyKey: crypto.randomUUID() }));
  }
  assert.equal(last.ok, false);
  assert.equal(last.code, "rate_limited");
  assert.equal(sheet.rows.length, 2);
});

test("a mismatched header row fails safely", () => {
  sheet.rows[0][3] = "Wrong header";
  assert.throws(
    () => processSubmission(validParams()),
    (error) => error && error.name === "ConfigError"
  );
  assert.equal(sheet.rows.length, 1);
});

test("an empty tab gets the header row and one submission", () => {
  sheet = createSheet([]);
  sheet.name = SHEET_NAME;
  const result = processSubmission(validParams());
  assert.equal(result.ok, true);
  assert.deepEqual(sheet.rows[0], HEADERS);
  assert.equal(sheet.rows.length, 2);
});
