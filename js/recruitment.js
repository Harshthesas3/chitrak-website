/* Team Chitrak recruitment — native form behavior, validation and submission.
   No framework, no API keys. The form posts to a Google Apps Script web app,
   which writes one validated row to a private Google Sheet. */

const CONTACT_EMAIL = "chitrak@rvce.edu.in";
const MESSAGE_SOURCE = "chitrak-recruitment";
const SUBMIT_TIMEOUT_MS = 25000;

const FALLBACK_CONFIG = {
  status: "open",
  endpoint: "",
  statusLabel: "REGISTRATION OPEN",
  cycleLabel: "RECRUITMENT — NEXT CYCLE",
  cycleNote: "Cycle dates, eligibility and open positions will be confirmed by Team Chitrak.",
  departments: [],
  openDepartmentLabel: "Open application — placement discussed with the team",
  years: ["1st year", "2nd year", "3rd year", "4th year", "Other"],
  commitment: null,
  consentVersion: "v1",
  contactEmail: CONTACT_EMAIL,
  retentionDays: 180,
};

const state = {
  config: FALLBACK_CONFIG,
  step: 1,
  submitting: false,
  idempotencyKey: makeUuid(),
  startedAt: Date.now(),
  errors: Object.create(null),
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const form = $("#recruitmentForm");
const formPanel = $("#formPanel");
const alertBox = $("#formAlert");
const alertBody = $("#formAlertBody");
const successPanel = $("#successPanel");
const closedPanel = $("#closedPanel");
const nextBtn = $("#nextBtn");
const backBtn = $("#backBtn");
const submitBtn = $("#submitBtn");
const submitLabel = $(".rc-btn-label", submitBtn);

/* ---------- small helpers ---------- */

function makeUuid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `rc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function clean(value) {
  return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

function normalizeUrl(value) {
  let v = clean(value);
  if (!v) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `https://${v}`;
  return v;
}

function normalizePhone(value) {
  return clean(value).replace(/[\s().-]/g, "");
}

function normalizeDepartmentOptions(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((item) => {
      if (typeof item === "string") return { value: item.trim(), label: item.trim() };
      if (item && typeof item === "object") {
        const value = clean(item.value || item.label);
        return { value, label: clean(item.label || item.value) };
      }
      return { value: "", label: "" };
    })
    .filter((d) => d.value);
}

function allowedDepartments(config) {
  const configured = normalizeDepartmentOptions(config.departments);
  if (configured.length) return configured;
  return [{ value: "Open application", label: config.openDepartmentLabel || "Open application" }];
}

function allowedYears(config) {
  const list = Array.isArray(config.years) ? config.years.map(clean).filter(Boolean) : [];
  return list.length ? list : FALLBACK_CONFIG.years;
}

function commitmentConfig(config = state.config) {
  const commitment = config && config.commitment;
  if (!commitment || typeof commitment !== "object" || !clean(commitment.label)) return null;
  return commitment;
}

/* ---------- config ---------- */

async function loadConfig() {
  try {
    const response = await fetch("../data/recruitment.json", { cache: "no-store" });
    if (!response.ok) throw new Error("config request failed");
    const data = await response.json();
    return { ...FALLBACK_CONFIG, ...data };
  } catch (error) {
    console.warn("[chitrak] Recruitment config unavailable; using safe defaults.");
    return { ...FALLBACK_CONFIG };
  }
}

function populateConfig() {
  const config = state.config;
  $("#cycleLabel").textContent = config.cycleLabel || FALLBACK_CONFIG.cycleLabel;
  $("#statusLabel").textContent = config.statusLabel || (config.status === "closed" ? "REGISTRATION CLOSED" : "REGISTRATION OPEN");
  $("#cycleNote").textContent = config.cycleNote || FALLBACK_CONFIG.cycleNote;
  $("#retentionDays").textContent = String(config.retentionDays || FALLBACK_CONFIG.retentionDays);
  $("#consentVersion").textContent = config.consentVersion || "v1";
  $("#startedAt").value = String(state.startedAt);

  const yearSelect = $("#year");
  yearSelect.innerHTML = "";
  yearSelect.appendChild(new Option("Select year", ""));
  for (const year of allowedYears(config)) yearSelect.appendChild(new Option(year, year));

  const departmentSelect = $("#department");
  departmentSelect.innerHTML = "";
  departmentSelect.appendChild(new Option("Select a preference", ""));
  for (const department of allowedDepartments(config)) {
    departmentSelect.appendChild(new Option(department.label, department.value));
  }

  const commitmentField = $("#commitmentField");
  const commitment = commitmentConfig(config);
  if (commitment) {
    commitmentField.hidden = false;
    $("#commitmentLabel").textContent = commitment.label;
    if (commitment.required) $("#commitment").required = true;
  } else {
    commitmentField.hidden = true;
    $("#commitment").checked = false;
    $("#commitment").required = false;
  }

  if (config.status === "closed") {
    form.hidden = true;
    closedPanel.hidden = false;
    $(".rc-form-aside").hidden = true;
  }
}

/* ---------- validation ---------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RE = /^[\p{L}\p{M} .'’\-]+$/u;
const USN_RE = /^[A-Za-z0-9-]{4,20}$/;
const PHONE_RE = /^\+?[0-9]{10,15}$/;

function rules() {
  const config = state.config;
  const departments = allowedDepartments(config).map((d) => d.value);
  const years = allowedYears(config);
  const commitment = commitmentConfig(config);

  return {
    fullName: {
      step: 1,
      validate(value) {
        const v = clean(value);
        if (!v) return "Enter your full name.";
        if (v.length < 2) return "Enter at least 2 characters.";
        if (v.length > 100) return "Keep your name under 100 characters.";
        if (!NAME_RE.test(v)) return "Use letters, spaces, hyphens, apostrophes or periods only.";
        return "";
      },
    },
    email: {
      step: 1,
      validate(value) {
        const v = clean(value).toLowerCase();
        if (!v) return "Enter your college email address.";
        if (v.length > 254 || !EMAIL_RE.test(v)) return "Enter a valid email address, for example name@rvce.edu.in.";
        return "";
      },
    },
    phone: {
      step: 1,
      validate(value) {
        const v = normalizePhone(value);
        if (!v) return "Enter your phone number.";
        if (!PHONE_RE.test(v)) return "Enter 10–15 digits. Include the country code if you are outside India.";
        return "";
      },
    },
    usn: {
      step: 1,
      validate(value) {
        const v = clean(value);
        if (!v) return "Enter your USN or student ID.";
        if (!USN_RE.test(v)) return "Use 4–20 letters, numbers or hyphens.";
        return "";
      },
    },
    year: {
      step: 1,
      validate(value) {
        const v = clean(value);
        if (!v) return "Select your current year of study.";
        if (!years.includes(v)) return "Select a valid year of study.";
        return "";
      },
    },
    branch: {
      step: 1,
      validate(value) {
        const v = clean(value);
        if (!v) return "Enter your branch or department.";
        if (v.length < 2) return "Enter at least 2 characters.";
        if (v.length > 80) return "Keep this under 80 characters.";
        return "";
      },
    },
    department: {
      step: 2,
      validate(value) {
        const v = clean(value);
        if (!v) return "Select a preferred team or department.";
        if (!departments.includes(v)) return "Select one of the listed options.";
        return "";
      },
    },
    skills: {
      step: 2,
      validate(value) {
        const v = clean(value);
        if (!v) return "Tell the team about your technical skills.";
        if (v.length < 2) return "Add a little more detail.";
        if (v.length > 600) return "Keep this under 600 characters.";
        return "";
      },
    },
    experience: {
      step: 2,
      validate(value) {
        const v = clean(value);
        if (v.length > 1000) return "Keep this under 1000 characters.";
        return "";
      },
    },
    projects: {
      step: 2,
      validate(value) {
        const v = clean(value);
        if (v.length > 1500) return "Keep this under 1500 characters.";
        return "";
      },
    },
    motivation: {
      step: 2,
      validate(value) {
        const v = clean(value);
        if (!v) return "Tell the team why you want to join.";
        if (v.length < 40) return `Add a little more detail (${40 - v.length} more characters minimum).`;
        if (v.length > 2000) return "Keep this under 2000 characters.";
        return "";
      },
    },
    portfolio: { step: 2, url: true },
    github: { step: 2, url: true },
    linkedin: { step: 2, url: true },
    commitment: {
      step: 3,
      checkbox: true,
      validate(_value, input) {
        if (commitment && commitment.required && !input.checked) {
          return "Please confirm the availability requirement, or email the team if you have a question.";
        }
        return "";
      },
    },
    consent: {
      step: 3,
      checkbox: true,
      validate(_value, input) {
        return input.checked ? "" : "You must consent to the collection and use of your registration data.";
      },
    },
  };
}

function validateUrl(value) {
  const v = normalizeUrl(value);
  if (!v) return "";
  if (v.length > 300) return "Keep the URL under 300 characters.";
  try {
    const parsed = new URL(v);
    if (!["http:", "https:"].includes(parsed.protocol)) return "Use an http or https URL.";
    if (parsed.username || parsed.password) return "Remove credentials from the URL.";
    if (!parsed.hostname || !parsed.hostname.includes(".")) return "Enter a valid URL, for example https://example.com.";
    return "";
  } catch {
    return "Enter a valid URL, for example https://example.com.";
  }
}

function validateField(name, { show = true } = {}) {
  const input = form.elements[name];
  if (!input) return "";
  const rule = rules()[name];
  let message = "";
  if (rule) {
    if (rule.url) message = validateUrl(input.value);
    else if (rule.checkbox) message = rule.validate(input.checked, input);
    else message = rule.validate(input.value, input);
  }
  if (show) setError(name, message);
  return message;
}

function setError(name, message) {
  const input = form.elements[name];
  if (!input) return;
  const holder = input.closest(".rc-field") || input.closest(".rc-consent");
  const error = $(`[data-error-for="${name}"]`, form);
  if (message) {
    state.errors[name] = message;
    input.setAttribute("aria-invalid", "true");
    if (holder) holder.classList.add("has-error");
    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
  } else {
    delete state.errors[name];
    input.removeAttribute("aria-invalid");
    if (holder) holder.classList.remove("has-error");
    if (error) {
      error.textContent = "";
      error.hidden = true;
    }
  }
}

function clearErrors() {
  for (const name of Object.keys(state.errors)) setError(name, "");
  state.errors = Object.create(null);
}

function focusField(name) {
  const input = form.elements[name];
  if (!input) return;
  try {
    input.focus({ preventScroll: true });
    input.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
  } catch {
    input.focus();
  }
}

function validateStep(step, { focus = true } = {}) {
  const stepRules = Object.entries(rules()).filter(([, rule]) => rule.step === step);
  let firstInvalid = "";
  for (const [name] of stepRules) {
    const message = validateField(name);
    if (message && !firstInvalid) firstInvalid = name;
  }
  if (firstInvalid && focus) focusField(firstInvalid);
  return { ok: !firstInvalid, firstInvalid };
}

function validateAll() {
  let firstStep = null;
  let firstField = "";
  for (const step of [1, 2, 3]) {
    const result = validateStep(step, { focus: false });
    if (!result.ok) {
      if (!firstStep) firstStep = step;
      if (!firstField) firstField = result.firstInvalid;
    }
  }
  return { ok: !firstStep, firstStep, firstField };
}

/* ---------- steps + progress ---------- */

function stepFromField(name) {
  const rule = rules()[name];
  return rule ? rule.step : 1;
}

function updateProgress() {
  const step = state.step;
  $$("#progressList li").forEach((li) => {
    const n = Number(li.dataset.progress);
    li.classList.toggle("is-active", n === step);
    li.classList.toggle("is-done", n < step);
  });
  $("#formProgressBar").style.transform = `scaleX(${(step - 1) / 2})`;
  $("#progressLive").textContent = step === 3 ? "Step 3 of 3 — review" : `Step ${step} of 3`;
}

function goToStep(step, { focus = true } = {}) {
  state.step = Math.min(3, Math.max(1, step));
  $$(".rc-step", form).forEach((section) => {
    section.hidden = Number(section.dataset.step) !== state.step;
  });
  backBtn.hidden = state.step === 1;
  nextBtn.hidden = state.step === 3;
  submitBtn.hidden = state.step !== 3;
  if (state.step === 3) renderReview();
  updateProgress();
  if (focus) {
    formPanel.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    const heading = $(`.rc-step[data-step="${state.step}"] h3`, form);
    if (heading) {
      try { heading.focus({ preventScroll: true }); } catch { heading.focus(); }
    }
  }
}

function renderReview() {
  const review = $("#reviewList");
  review.textContent = "";

  const groups = [
    {
      title: "01 — Personal",
      step: 1,
      fields: [
        ["fullName", "Full name"],
        ["email", "College email"],
        ["phone", "Phone"],
        ["usn", "USN / student ID"],
        ["year", "Year of study"],
        ["branch", "Branch / department"],
      ],
    },
    {
      title: "02 — Preferences",
      step: 2,
      fields: [
        ["department", "Preferred department"],
        ["skills", "Technical skills"],
        ["experience", "Relevant experience"],
        ["projects", "Previous projects"],
        ["motivation", "Why Team Chitrak"],
        ["portfolio", "Portfolio"],
        ["github", "GitHub"],
        ["linkedin", "LinkedIn"],
      ],
    },
    configCommitmentGroup(),
    {
      title: "Consent",
      step: 3,
      fields: [],
      consent: true,
    },
  ].filter(Boolean);

  for (const group of groups) {
    const head = document.createElement("div");
    head.className = "rc-review-group";
    const title = document.createElement("span");
    title.className = "rc-review-group-title";
    title.textContent = group.title;
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "rc-edit";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      hideAlert();
      goToStep(group.step);
    });
    head.append(title, edit);
    review.appendChild(head);

    for (const [name, label] of group.fields) {
      const value = readDisplayValue(name);
      const row = document.createElement("div");
      row.className = "rc-review-row";
      row.setAttribute("role", "group");

      const dt = document.createElement("span");
      dt.className = "rc-review-label";
      dt.textContent = label;

      const dd = document.createElement("span");
      dd.className = "rc-review-value";
      dd.textContent = value || "—";
      if (!value) dd.classList.add("is-empty");

      row.append(dt, dd);
      review.appendChild(row);
    }

    if (group.consent) {
      const row = document.createElement("div");
      row.className = "rc-review-row";
      const dt = document.createElement("span");
      dt.className = "rc-review-label";
      dt.textContent = "Consent";
      const dd = document.createElement("span");
      dd.className = "rc-review-value";
      dd.textContent = form.elements.consent.checked
        ? `Yes — privacy notice ${state.config.consentVersion || "v1"}`
        : "Not given";
      row.append(dt, dd);
      review.appendChild(row);
    }
  }
}

function configCommitmentGroup() {
  const commitment = commitmentConfig();
  if (!commitment) return null;
  return {
    title: "Commitment",
    step: 3,
    fields: [["commitment", "Availability"]],
  };
}

function readDisplayValue(name) {
  const input = form.elements[name];
  if (!input) return "";
  if (input.type === "checkbox") return input.checked ? "Yes" : "No";
  if (input.type === "url") return normalizeUrl(input.value);
  if (name === "email") return clean(input.value).toLowerCase();
  if (name === "usn") return clean(input.value).toUpperCase();
  return clean(input.value);
}

/* ---------- alert / loading / success ---------- */

function hideAlert() {
  alertBox.hidden = true;
  alertBody.textContent = "";
}

function showAlert(message) {
  alertBody.textContent = message;
  alertBox.hidden = false;
  try { alertBox.focus({ preventScroll: true }); } catch { alertBox.focus(); }
}

function setLoading(loading) {
  state.submitting = loading;
  form.classList.toggle("is-loading", loading);
  form.setAttribute("aria-busy", String(loading));
  submitLabel.textContent = loading ? "Submitting…" : "Submit registration";
  for (const element of $$("input, select, textarea, button", form)) {
    if (loading) {
      element.dataset.rcWasDisabled = element.disabled ? "1" : "0";
      element.disabled = true;
    } else {
      element.disabled = element.dataset.rcWasDisabled === "1";
      delete element.dataset.rcWasDisabled;
    }
  }
}

function showSuccess(data) {
  form.hidden = true;
  successPanel.hidden = false;
  $("#successId").textContent = data.submissionId || "—";
  const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
  const valid = !Number.isNaN(timestamp.getTime());
  $("#successTime").textContent = valid
    ? timestamp.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "—";
  $("#successTime").title = data.timestamp || "";

  $$("#progressList li").forEach((li) => {
    li.classList.remove("is-active");
    li.classList.add("is-done");
  });
  $("#formProgressBar").style.transform = "scaleX(1)";
  $("#progressLive").textContent = "Submitted";
  document.title = "Registration received — Team Chitrak, RVCE";
  try { successPanel.focus({ preventScroll: true }); } catch { successPanel.focus(); }
  requestAnimationFrame(() => {
    successPanel.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  });
}

/* ---------- submit ---------- */

function collectPayload() {
  const payload = {};
  const elements = form.elements;
  for (const name of [
    "fullName", "email", "phone", "usn", "year", "branch", "department",
    "skills", "experience", "projects", "motivation", "portfolio", "github", "linkedin",
  ]) {
    payload[name] = clean(elements[name] && elements[name].value);
  }
  payload.fullName = clean(payload.fullName);
  payload.email = payload.email.toLowerCase();
  payload.phone = normalizePhone(payload.phone);
  payload.usn = payload.usn.toUpperCase();
  for (const name of ["portfolio", "github", "linkedin"]) payload[name] = normalizeUrl(payload[name]);
  payload.consent = Boolean(elements.consent && elements.consent.checked);
  payload.commitment = Boolean(elements.commitment && elements.commitment.checked);
  payload.company = elements.company ? elements.company.value : "";
  payload.startedAt = state.startedAt;
  return payload;
}

function configuredEndpoint() {
  const value = clean(state.config.endpoint);
  if (/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(value)) return value;
  // Local development mock. Never used on the deployed site.
  if (/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mock\/apps-script$/.test(value)) return value;
  return "";
}

function ensureSubmitFrame() {
  let frame = document.getElementById("recruitmentSubmitFrame");
  if (!frame) {
    frame = document.createElement("iframe");
    frame.id = "recruitmentSubmitFrame";
    frame.name = "recruitmentSubmitFrame";
    frame.title = "Registration submission";
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    frame.style.display = "none";
    document.body.appendChild(frame);
  }
  return frame;
}

/* Apps Script web apps do not send CORS headers, so the form is posted into a
   hidden iframe. The script responds with a tiny page that postMessages the
   result back. A random nonce ties the response to this submission. */
function postRegistration(payload) {
  return new Promise((resolve, reject) => {
    const endpoint = configuredEndpoint();
    if (!endpoint) {
      reject(Object.assign(new Error("Registration endpoint is not configured."), { code: "not_configured" }));
      return;
    }

    const frame = ensureSubmitFrame();
    const nonce = makeUuid();
    let form = null;
    let timer = null;
    let settled = false;

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      if (timer) clearTimeout(timer);
      if (form && form.parentNode) form.parentNode.removeChild(form);
    };
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler(value);
    };
    function onMessage(event) {
      const message = event && event.data;
      if (!message || message.source !== MESSAGE_SOURCE) return;
      if (!message.result || message.result.nonce !== nonce) return;
      finish(resolve, message.result);
    }

    window.addEventListener("message", onMessage);
    timer = setTimeout(() => {
      finish(reject, Object.assign(new Error("Registration confirmation timed out."), { code: "timeout" }));
    }, SUBMIT_TIMEOUT_MS);

    form = document.createElement("form");
    form.method = "POST";
    form.action = endpoint;
    form.target = frame.name;
    form.acceptCharset = "UTF-8";
    form.style.display = "none";
    form.setAttribute("aria-hidden", "true");

    const fields = {
      ...payload,
      nonce,
      idempotencyKey: state.idempotencyKey,
      startedAt: String(payload.startedAt),
      consent: payload.consent ? "yes" : "no",
      commitment: payload.commitment ? "yes" : "no",
      company: payload.company || "",
    };
    for (const [name, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = String(value);
      form.appendChild(input);
    }

    document.body.appendChild(form);
    try {
      form.submit();
    } catch {
      finish(reject, Object.assign(new Error("The form could not be submitted."), { code: "submit_failed" }));
    }
  });
}

async function submitForm(event) {
  event.preventDefault();
  if (state.submitting) return;

  hideAlert();
  const validation = validateAll();
  if (!validation.ok) {
    if (validation.firstStep) goToStep(validation.firstStep, { focus: false });
    showAlert("Please correct the highlighted fields, then submit again.");
    setTimeout(() => focusField(validation.firstField), 30);
    return;
  }

  const payload = collectPayload();
  setLoading(true);

  try {
    const data = await postRegistration(payload);

    if (data && data.ok === true) {
      showSuccess(data);
      return;
    }

    if (data && data.errors && typeof data.errors === "object") {
      clearErrors();
      let firstStep = null;
      let firstField = "";
      for (const [name, message] of Object.entries(data.errors)) {
        if (!form.elements[name]) continue;
        setError(name, String(message || "Check this field."));
        const fieldStep = stepFromField(name);
        if (!firstStep || fieldStep < firstStep) firstStep = fieldStep;
        if (!firstField) firstField = name;
      }
      if (firstStep) goToStep(firstStep, { focus: false });
      showAlert(data.message || "Please correct the highlighted fields, then submit again.");
      if (firstField) setTimeout(() => focusField(firstField), 30);
      return;
    }

    showAlert(data && data.message
      ? data.message
      : `We could not confirm your registration. Your details are still in the form. Please try again, or email ${CONTACT_EMAIL}.`);
  } catch (error) {
    if (error && error.code === "not_configured") {
      showAlert(`Registration is not connected yet. Email ${CONTACT_EMAIL} to register.`);
    } else if (error && error.code === "timeout") {
      showAlert(`We could not confirm your registration. Wait a moment, then try again — duplicate submissions are blocked. You can also email ${CONTACT_EMAIL}.`);
    } else {
      showAlert(`We could not reach the registration service. Your details are still in the form. Check your connection and try again, or email ${CONTACT_EMAIL}.`);
    }
  } finally {
    if (!successPanel.hidden) return;
    setLoading(false);
  }
}

/* ---------- events ---------- */

function bindEvents() {
  nextBtn.addEventListener("click", () => {
    hideAlert();
    const result = validateStep(state.step);
    if (!result.ok) {
      showAlert("Check the highlighted fields before continuing.");
      return;
    }
    if (state.step === 2) renderReview();
    goToStep(state.step + 1);
  });

  backBtn.addEventListener("click", () => {
    hideAlert();
    goToStep(state.step - 1);
  });

  form.addEventListener("submit", submitForm);

  form.addEventListener("input", (event) => {
    const name = event.target && event.target.name;
    if (name && state.errors[name]) validateField(name);
  });

  form.addEventListener("change", (event) => {
    const name = event.target && event.target.name;
    if (name && state.errors[name]) validateField(name);
    if (state.step === 3 && (name === "consent" || name === "commitment")) renderReview();
  });

  form.addEventListener("blur", (event) => {
    const input = event.target;
    if (!input || !input.name) return;
    if (input.name === "usn") input.value = clean(input.value).toUpperCase();
    if (input.name === "email") input.value = clean(input.value).toLowerCase();
    if (input.type === "url") input.value = normalizeUrl(input.value);
    if (rules()[input.name] && input.name !== "company") validateField(input.name);
  }, true);

  // Let the form work with Enter on text inputs, but never submit from step 1/2.
  form.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.target.tagName === "TEXTAREA") return;
    if (state.step !== 3) {
      event.preventDefault();
      nextBtn.click();
    }
  });

  // Mobile nav, same behavior as the rest of the site.
  const burger = $("#navBurger");
  const menu = $("#mobileMenu");
  if (burger && menu) {
    burger.addEventListener("click", () => {
      const open = menu.hasAttribute("hidden");
      if (open) menu.removeAttribute("hidden");
      else menu.setAttribute("hidden", "");
      burger.setAttribute("aria-expanded", String(open));
    });
    $$("a", menu).forEach((link) =>
      link.addEventListener("click", () => {
        menu.setAttribute("hidden", "");
        burger.setAttribute("aria-expanded", "false");
      })
    );
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || menu.hasAttribute("hidden")) return;
      menu.setAttribute("hidden", "");
      burger.setAttribute("aria-expanded", "false");
      burger.focus();
    });
  }
}

/* ---------- subtle motion, matching the sponsor page ---------- */

function motion() {
  if (reducedMotion() || !window.gsap || !window.ScrollTrigger) return;
  try {
    gsap.registerPlugin(ScrollTrigger);

    gsap.fromTo(".rc-hero .rc-line",
      { yPercent: 112 },
      { yPercent: 0, duration: 1.05, ease: "power3.out", stagger: 0.12, delay: 0.12 });
    gsap.fromTo(".rc-hero-quote, .rc-hero-sub, .rc-hero-actions, .rc-hero-meta",
      { opacity: 0, y: 24 },
      { opacity: 1, y: 0, duration: 0.85, ease: "power2.out", stagger: 0.1, delay: 0.46 });
    gsap.fromTo(".rc-hero .mono-label",
      { opacity: 0, x: -16 },
      { opacity: 1, x: 0, duration: 0.65, ease: "power2.out", delay: 0.08 });

    gsap.to(".rc-hero-media", {
      yPercent: 10, scale: 1.05, opacity: 0.35, ease: "none",
      scrollTrigger: { trigger: ".rc-hero", start: "top top", end: "bottom top", scrub: true },
    });
    gsap.to(".rc-hero-inner", {
      y: -50, opacity: 0.25, ease: "none",
      scrollTrigger: { trigger: ".rc-hero", start: "top top", end: "bottom 35%", scrub: true },
    });

    const sectionReveals = $$(".rc-about .rc-reveal, .rc-before .rc-reveal, .rc-register > .rc-reveal");
    for (const el of sectionReveals) {
      gsap.fromTo(el,
        { opacity: 0, y: 42, clipPath: "inset(10% 0 10% 0)" },
        {
          opacity: 1, y: 0, clipPath: "inset(0% 0 0% 0)",
          duration: 0.85, ease: "power2.out",
          scrollTrigger: { trigger: el, start: "top 86%" },
        });
    }

    const cards = $$(".rc-discipline, .rc-check");
    cards.forEach((el, index) => {
      gsap.fromTo(el,
        { opacity: 0, y: 30, scale: 0.99 },
        {
          opacity: 1, y: 0, scale: 1,
          duration: 0.65, ease: "power2.out", delay: (index % 3) * 0.06,
          scrollTrigger: { trigger: el, start: "top 90%" },
        });
    });

    gsap.to("#rcProgress", {
      scaleX: 1, ease: "none",
      scrollTrigger: { trigger: document.body, start: "top top", end: "bottom bottom", scrub: 0.3 },
    });
  } catch (error) {
    console.warn("[chitrak] Recruitment motion disabled:", error && error.message);
  }
}

/* ---------- boot ---------- */

async function boot() {
  state.config = await loadConfig();
  populateConfig();
  bindEvents();
  updateProgress();
  goToStep(1, { focus: false });

  if (state.config.status !== "closed") motion();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
