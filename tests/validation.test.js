const test = require("node:test");
const assert = require("node:assert/strict");

const {
  HEADERS,
  validateSubmission,
  buildRow,
  escapeCell,
  normalizeUrl,
  normalizePhone,
} = require("../apps-script/Code.gs");

function baseInput(overrides = {}) {
  return {
    fullName: "T Harshith Krishna Sastry",
    email: "Harshith@RVCE.edu.in",
    phone: "+91 98765 43210",
    usn: "1rv21cs001",
    year: "3rd year",
    branch: "Computer Science and Engineering",
    department: "Open application",
    skills: "JavaScript, CAD, fabrication",
    experience: "",
    projects: "",
    motivation: "I want to help build and test the next Chitrak electric motorcycle.",
    portfolio: "github.com/example",
    github: "https://github.com/example",
    linkedin: "",
    consent: "yes",
    commitment: "no",
    company: "",
    ...overrides,
  };
}

test("accepts a complete, valid registration and normalizes values", () => {
  const result = validateSubmission(baseInput());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, {});
  assert.equal(result.data.email, "harshith@rvce.edu.in");
  assert.equal(result.data.usn, "1RV21CS001");
  assert.equal(result.data.phone, "+919876543210");
  assert.equal(result.data.portfolio, "https://github.com/example");
  assert.equal(result.data.department, "Open application");
  assert.equal(result.data.consent, true);
  assert.equal(result.data.commitment, "No");
});

test("rejects invalid email, phone and missing consent", () => {
  const result = validateSubmission(baseInput({
    email: "not-an-email",
    phone: "123",
    consent: "no",
  }));
  assert.equal(result.ok, false);
  assert.match(result.errors.email, /valid email/i);
  assert.match(result.errors.phone, /10–15 digits/i);
  assert.match(result.errors.consent, /consent/i);
});

test("rejects missing year, department, short motivation and bad URLs", () => {
  const result = validateSubmission(baseInput({
    year: "",
    department: "",
    motivation: "Too short",
    portfolio: "javascript:alert(1)",
    github: "https://",
    linkedin: "ftp://example.com/profile",
  }));
  assert.equal(result.ok, false);
  assert.match(result.errors.year, /year of study/i);
  assert.match(result.errors.department, /department/i);
  assert.match(result.errors.motivation, /more detail/i);
  assert.match(result.errors.portfolio, /http/i);
  assert.match(result.errors.github, /valid http/i);
  assert.match(result.errors.linkedin, /http/i);
});

test("enforces field length limits", () => {
  const result = validateSubmission(baseInput({
    fullName: "A".repeat(101),
    branch: "B".repeat(81),
    skills: "S".repeat(601),
    motivation: "M".repeat(2001),
  }));
  assert.equal(result.ok, false);
  assert.match(result.errors.fullName, /under 100/i);
  assert.match(result.errors.branch, /under 80/i);
  assert.match(result.errors.skills, /under 600/i);
  assert.match(result.errors.motivation, /under 2000/i);
});

test("URL normalizer adds https and phone normalizer strips separators", () => {
  assert.equal(normalizeUrl("github.com/team-chitrak"), "https://github.com/team-chitrak");
  assert.equal(normalizeUrl("  https://example.com/a  "), "https://example.com/a");
  assert.equal(normalizeUrl(""), "");
  assert.equal(normalizePhone("+91 98765-43210"), "+919876543210");
});

test("spreadsheet rows use the stable 19-column schema", () => {
  assert.equal(HEADERS.length, 19);
  assert.equal(HEADERS[0], "Submission ID");
  assert.equal(HEADERS[18], "Application Status");

  const validation = validateSubmission(baseInput());
  const row = buildRow(validation.data, "CHK-20261021-ABCD1234", "2026-10-21T10:00:00.000Z");
  assert.equal(row.length, HEADERS.length);
  assert.equal(row[0], "CHK-20261021-ABCD1234");
  assert.equal(row[3], "harshith@rvce.edu.in");
  assert.equal(row[4], "+919876543210");
  assert.equal(row[17], "Yes — privacy notice v1");
  assert.equal(row[18], "New");
});

test("spreadsheet formula injection is neutralized", () => {
  assert.equal(escapeCell("=HYPERLINK(\"http://evil\")"), "'=HYPERLINK(\"http://evil\")");
  assert.equal(escapeCell("+HYPERLINK(\"http://evil\")"), "'+HYPERLINK(\"http://evil\")");
  assert.equal(escapeCell("-2+3"), "'-2+3");
  assert.equal(escapeCell("@SUM(A1:A2)"), "'@SUM(A1:A2)");
  assert.equal(escapeCell("Normal text"), "Normal text");
});

test("international phone numbers are stored without a leading apostrophe", () => {
  assert.equal(escapeCell("+919876543210"), "+919876543210");
  assert.equal(escapeCell("+91 98765 43210"), "+91 98765 43210");
  assert.equal(escapeCell("+1 (415) 555-0100"), "+1 (415) 555-0100");
});
