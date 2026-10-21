/* Server-side validation and spreadsheet row construction.
   This module is deliberately dependency-free and never logs applicant data. */

const HEADERS = [
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
  "Application Status",
];

const LIMITS = {
  fullName: 100,
  email: 254,
  phone: 20,
  usn: 20,
  branch: 80,
  skills: 600,
  experience: 1000,
  projects: 1500,
  motivation: 2000,
  url: 300,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RE = /^[\p{L}\p{M} .'’\-]+$/u;
const USN_RE = /^[A-Za-z0-9-]{4,20}$/;
const PHONE_RE = /^\+?[0-9]{10,15}$/;

function clean(value) {
  if (typeof value === "string") {
    return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function normalizePhone(value) {
  return clean(value).replace(/[\s().-]/g, "");
}

function normalizeUrl(value) {
  let url = clean(value);
  if (!url) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

function normalizeDepartments(config) {
  const list = Array.isArray(config.departments) ? config.departments : [];
  const values = list
    .map((item) => {
      if (typeof item === "string") return clean(item);
      if (item && typeof item === "object") return clean(item.value || item.label);
      return "";
    })
    .filter(Boolean);
  return values.length ? values : ["Open application"];
}

function normalizeYears(config) {
  const list = Array.isArray(config.years) ? config.years.map(clean).filter(Boolean) : [];
  return list.length ? list : ["1st year", "2nd year", "3rd year", "4th year", "Other"];
}

function validUrl(value) {
  if (!value) return true;
  if (value.length > LIMITS.url) return false;
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol)
      && Boolean(parsed.hostname && parsed.hostname.includes("."))
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

function isChecked(value) {
  return value === true || value === "yes" || value === "on" || value === 1 || value === "true";
}

/**
 * Validate an untrusted submission.
 * @param {unknown} input
 * @param {object} config recruitment config (data/recruitment.json)
 * @param {number} [now] injectable clock for tests
 */
function validateSubmission(input, config, now = Date.now()) {
  const errors = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: { form: "Invalid submission." }, data: null, bot: false };
  }

  // Honeypot: a real applicant never fills this off-screen field.
  if (clean(input.company)) {
    return { ok: false, errors: { form: "Submission could not be processed." }, data: null, bot: true };
  }

  const startedAt = Number(input.startedAt);
  const elapsed = now - startedAt;
  if (!Number.isFinite(startedAt) || startedAt <= 0 || elapsed < 2500) {
    return { ok: false, errors: { form: "Submission could not be processed." }, data: null, bot: true };
  }
  if (elapsed > 24 * 60 * 60 * 1000) {
    return { ok: false, errors: { form: "This form has expired. Reload the page and try again." }, data: null, bot: false };
  }

  const fullName = clean(input.fullName);
  if (!fullName) errors.fullName = "Enter your full name.";
  else if (fullName.length < 2) errors.fullName = "Enter at least 2 characters.";
  else if (fullName.length > LIMITS.fullName) errors.fullName = `Keep your name under ${LIMITS.fullName} characters.`;
  else if (!NAME_RE.test(fullName)) errors.fullName = "Use letters, spaces, hyphens, apostrophes or periods only.";

  const email = clean(input.email).toLowerCase();
  if (!email) errors.email = "Enter your college email address.";
  else if (email.length > LIMITS.email || !EMAIL_RE.test(email)) errors.email = "Enter a valid email address.";

  const phone = normalizePhone(input.phone);
  if (!phone) errors.phone = "Enter your phone number.";
  else if (!PHONE_RE.test(phone)) errors.phone = "Enter 10–15 digits, with country code if needed.";

  const usn = clean(input.usn).toUpperCase();
  if (!usn) errors.usn = "Enter your USN or student ID.";
  else if (!USN_RE.test(usn)) errors.usn = "Use 4–20 letters, numbers or hyphens.";

  const years = normalizeYears(config);
  const year = clean(input.year);
  if (!year) errors.year = "Select your current year of study.";
  else if (!years.includes(year)) errors.year = "Select a valid year of study.";

  const branch = clean(input.branch);
  if (!branch) errors.branch = "Enter your branch or department.";
  else if (branch.length < 2) errors.branch = "Enter at least 2 characters.";
  else if (branch.length > LIMITS.branch) errors.branch = `Keep this under ${LIMITS.branch} characters.`;

  const departments = normalizeDepartments(config);
  const department = clean(input.department);
  if (!department) errors.department = "Select a preferred team or department.";
  else if (!departments.includes(department)) errors.department = "Select one of the listed options.";

  const skills = clean(input.skills);
  if (!skills) errors.skills = "Tell the team about your technical skills.";
  else if (skills.length < 2) errors.skills = "Add a little more detail.";
  else if (skills.length > LIMITS.skills) errors.skills = `Keep this under ${LIMITS.skills} characters.`;

  const experience = clean(input.experience);
  if (experience.length > LIMITS.experience) errors.experience = `Keep this under ${LIMITS.experience} characters.`;

  const projects = clean(input.projects);
  if (projects.length > LIMITS.projects) errors.projects = `Keep this under ${LIMITS.projects} characters.`;

  const motivation = clean(input.motivation);
  if (!motivation) errors.motivation = "Tell the team why you want to join.";
  else if (motivation.length < 40) errors.motivation = "Add a little more detail (40 characters minimum).";
  else if (motivation.length > LIMITS.motivation) errors.motivation = `Keep this under ${LIMITS.motivation} characters.`;

  const portfolio = normalizeUrl(input.portfolio);
  if (!validUrl(portfolio)) errors.portfolio = "Enter a valid http or https URL.";

  const github = normalizeUrl(input.github);
  if (!validUrl(github)) errors.github = "Enter a valid http or https URL.";

  const linkedin = normalizeUrl(input.linkedin);
  if (!validUrl(linkedin)) errors.linkedin = "Enter a valid http or https URL.";

  const commitment = isChecked(input.commitment);
  const commitmentRule = config.commitment && typeof config.commitment === "object" ? config.commitment : null;
  if (commitmentRule && commitmentRule.required && !commitment) {
    errors.commitment = "Please confirm the availability requirement.";
  }

  const consent = isChecked(input.consent);
  if (!consent) errors.consent = "You must consent to the collection and use of your registration data.";

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    bot: false,
    data: ok ? {
      fullName,
      email,
      phone,
      usn,
      year,
      branch,
      department,
      skills,
      experience,
      projects,
      motivation,
      portfolio,
      github,
      linkedin,
      commitment: commitment ? "Yes" : "No",
      consent: true,
    } : null,
  };
}

/* Prevent spreadsheet formula injection. RAW input already keeps values literal,
   but a leading formula character can still be dangerous when the sheet is
   exported to CSV and opened in a spreadsheet app.
   International phone numbers (+<digits>) are left untouched so applicants see
   a normal number; they cannot form a dangerous formula. */
function escapeCell(value) {
  let cell = String(value == null ? "" : value).replace(/\r/g, "");
  if (/^\+\d[\d\s()-]*$/.test(cell)) return cell;
  if (/^[=+\-@\t]/.test(cell)) cell = `'${cell}`;
  return cell;
}

function buildRow(data, { submissionId, timestamp, consentVersion = "v1" }) {
  return [
    submissionId,
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
    `Yes — privacy notice ${consentVersion}`,
    "New",
  ].map(escapeCell);
}

module.exports = {
  HEADERS,
  LIMITS,
  clean,
  normalizePhone,
  normalizeUrl,
  normalizeDepartments,
  normalizeYears,
  validateSubmission,
  buildRow,
  escapeCell,
};
