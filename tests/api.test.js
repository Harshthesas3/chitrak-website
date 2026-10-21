const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

let handler;
let HEADERS;
let mock;

function validBody(overrides = {}) {
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
    consent: true,
    commitment: false,
    company: "",
    startedAt: Date.now() - 5000,
    ...overrides,
  };
}

async function call(body, { headers = {}, method = "POST" } = {}) {
  const req = {
    method,
    headers: {
      host: "localhost:3000",
      "x-forwarded-host": "localhost:3000",
      "x-forwarded-proto": "http",
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
      ...headers,
    },
    body,
    socket: { remoteAddress: "127.0.0.1" },
  };
  const res = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    end(chunk) { this.body = chunk == null ? "" : String(chunk); },
  };
  await handler(req, res);
  let json = null;
  try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
  return { status: res.statusCode, headers: res.headers, json };
}

test.before(async () => {
  const mockModule = await import("../scripts/mock-sheets-server.mjs");
  mock = await mockModule.startMockSheets();
  process.env.GOOGLE_SHEETS_API_BASE = mock.url;
  process.env.GOOGLE_ACCESS_TOKEN = "test-access-token";
  process.env.GOOGLE_SHEET_ID = "test-spreadsheet";
  process.env.GOOGLE_SHEET_TAB = "Responses";
  process.env.RECRUITMENT_RATE_LIMIT_PER_HOUR = "100";
  process.env.RECRUITMENT_RATE_LIMIT_PER_DAY = "100";
  handler = require("../api/recruitment.js");
  HEADERS = require("../api/_lib/validation").HEADERS;
});

test.after(async () => {
  if (mock) await mock.close();
});

test.beforeEach(() => {
  handler.__resetForTests();
  mock.state.rows = [HEADERS.slice()];
  mock.state.appended = 0;
  mock.state.failAppend = false;
  mock.state.failRead = false;
  mock.state.delayMs = 0;
  process.env.RECRUITMENT_RATE_LIMIT_PER_HOUR = "100";
  process.env.RECRUITMENT_RATE_LIMIT_PER_DAY = "100";
});

test("POST /api/recruitment stores one validated row", async () => {
  const result = await call(validBody());
  assert.equal(result.status, 201);
  assert.equal(result.json.ok, true);
  assert.match(result.json.submissionId, /^CHK-\d{8}-[A-F0-9]{8}$/);
  assert.ok(result.json.timestamp);

  assert.equal(mock.state.appended, 1);
  assert.equal(mock.state.rows.length, 2);
  const row = mock.state.rows[1];
  assert.equal(row.length, HEADERS.length);
  assert.equal(row[0], result.json.submissionId);
  assert.equal(row[1], result.json.timestamp);
  assert.equal(row[3], "harshith@rvce.edu.in");
  assert.equal(row[4], "+919876543210");
  assert.equal(row[5], "1RV21CS001");
  assert.equal(row[8], "Open application");
  assert.equal(row[17], "Yes — privacy notice v1");
  assert.equal(row[18], "New");
});

test("invalid submissions are rejected before any sheet write", async () => {
  const result = await call(validBody({
    email: "not-an-email",
    phone: "123",
    consent: false,
  }));
  assert.equal(result.status, 400);
  assert.equal(result.json.ok, false);
  assert.equal(result.json.code, "validation_error");
  assert.match(result.json.errors.email, /valid email/i);
  assert.match(result.json.errors.phone, /10–15 digits/i);
  assert.match(result.json.errors.consent, /consent/i);
  assert.equal(mock.state.appended, 0);
  assert.equal(mock.state.rows.length, 1);
});

test("repeated email or USN is rejected as a duplicate", async () => {
  const first = await call(validBody());
  assert.equal(first.status, 201);

  const sameEmail = await call(validBody({ usn: "1RV21CS002" }));
  assert.equal(sameEmail.status, 409);
  assert.equal(sameEmail.json.code, "already_registered");

  const sameUsn = await call(validBody({ email: "other@rvce.edu.in" }));
  assert.equal(sameUsn.status, 409);
  assert.equal(sameUsn.json.code, "already_registered");

  assert.equal(mock.state.appended, 1);
});

test("same idempotency key replays the same successful result", async () => {
  const key = crypto.randomUUID();
  const first = await call(validBody(), { headers: { "idempotency-key": key } });
  assert.equal(first.status, 201);

  const second = await call(validBody(), { headers: { "idempotency-key": key } });
  assert.equal(second.status, 200);
  assert.equal(second.json.ok, true);
  assert.equal(second.json.replayed, true);
  assert.equal(second.json.submissionId, first.json.submissionId);
  assert.equal(mock.state.appended, 1);
});

test("concurrent repeat clicks create only one row", async () => {
  const key = crypto.randomUUID();
  const results = await Promise.all([
    call(validBody(), { headers: { "idempotency-key": key } }),
    call(validBody(), { headers: { "idempotency-key": key } }),
  ]);
  const statuses = results.map((result) => result.status).sort();
  assert.deepEqual(statuses, [201, 409]);
  assert.equal(mock.state.appended, 1);
  assert.equal(mock.state.rows.length, 2);
});

test("concurrent submissions with different keys cannot bypass the duplicate check", async () => {
  // Hold the identity lock across the sheet read so the second request must
  // observe contention rather than racing the duplicate check.
  mock.state.delayMs = 60;
  const results = await Promise.all([
    call(validBody(), { headers: { "idempotency-key": crypto.randomUUID() } }),
    call(validBody(), { headers: { "idempotency-key": crypto.randomUUID() } }),
  ]);
  const statuses = results.map((result) => result.status).sort();
  assert.deepEqual(statuses, [201, 409]);
  assert.equal(mock.state.appended, 1);
  assert.equal(mock.state.rows.length, 2);
});

test("sheet failure returns 503 and a retry can succeed", async () => {
  const key = crypto.randomUUID();
  mock.state.failAppend = true;
  const failed = await call(validBody(), { headers: { "idempotency-key": key } });
  assert.equal(failed.status, 503);
  assert.equal(failed.json.ok, false);
  assert.equal(failed.json.code, "storage_unavailable");
  assert.equal(mock.state.appended, 0);

  mock.state.failAppend = false;
  const retried = await call(validBody(), { headers: { "idempotency-key": key } });
  assert.equal(retried.status, 201);
  assert.equal(mock.state.appended, 1);
});

test("per-connection rate limit blocks excess valid submissions", async () => {
  process.env.RECRUITMENT_RATE_LIMIT_PER_HOUR = "1";
  const first = await call(validBody());
  assert.equal(first.status, 201);

  const second = await call(validBody({ email: "second@rvce.edu.in", usn: "1RV21CS003" }));
  assert.equal(second.status, 429);
  assert.equal(second.json.code, "rate_limited");
  assert.equal(second.headers["retry-after"], "3600");
  assert.equal(mock.state.appended, 1);
});

test("cross-origin submissions are rejected", async () => {
  const result = await call(validBody(), {
    headers: { origin: "https://evil.example" },
  });
  assert.equal(result.status, 403);
  assert.equal(result.json.code, "origin_not_allowed");
  assert.equal(mock.state.appended, 0);
});

test("wrong content type, method and malformed JSON are rejected safely", async () => {
  const wrongType = await call(validBody(), { headers: { "content-type": "text/plain" } });
  assert.equal(wrongType.status, 415);

  const wrongMethod = await call(null, { method: "GET" });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.allow, "POST");

  const malformed = await call("{not json", { headers: { "content-type": "application/json" } });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.json.code, "invalid_json");
});

test("oversized submissions are rejected", async () => {
  const big = JSON.stringify(validBody({ skills: "S".repeat(40 * 1024) }));
  const result = await call(big);
  assert.equal(result.status, 413);
  assert.equal(result.json.code, "payload_too_large");
  assert.equal(mock.state.appended, 0);
});

test("honeypot submissions receive a generic rejection", async () => {
  const result = await call(validBody({ company: "bot" }));
  assert.equal(result.status, 400);
  assert.equal(result.json.code, "invalid_request");
  assert.equal(result.json.errors, undefined);
  assert.equal(mock.state.appended, 0);
});
