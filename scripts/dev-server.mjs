/* Local development server for the static site.
   Mirrors Vercel cleanUrls for /recruitment and /sponsor.

   npm run dev        -> uses the Apps Script URL in data/recruitment.json
   npm run dev:mock   -> in-memory mock endpoint, safe end-to-end testing

   This file is development-only and is excluded from Vercel deployments. */

import http from "node:http";
import { stat, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = new Set(process.argv.slice(2));
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const PORT = Number(portArg ? portArg.split("=")[1] : process.env.PORT || 8123);
const USE_MOCK = args.has("--mock-sheets");

const MOCK_HEADERS = [
  "Submission ID", "Timestamp", "Full Name", "Email", "Phone", "USN", "Year",
  "Branch", "Preferred Department", "Skills", "Experience", "Projects",
  "Motivation", "Portfolio", "GitHub", "LinkedIn", "Availability", "Consent",
  "Application Status",
];
const mockRows = [MOCK_HEADERS.slice()];
const mockIdempotency = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

async function fileOrNull(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

async function resolveStatic(pathname) {
  let candidate = pathname;
  if (candidate.endsWith("/")) candidate += "index.html";

  const direct = resolve(ROOT, `.${candidate}`);
  if (!direct.startsWith(ROOT + sep) && direct !== ROOT) return null;
  if (await fileOrNull(direct)) return direct;

  if (!extname(candidate)) {
    const directoryIndex = resolve(ROOT, `.${candidate}`, "index.html");
    if (directoryIndex.startsWith(ROOT + sep) && await fileOrNull(directoryIndex)) return directoryIndex;
    const html = resolve(ROOT, `.${candidate}.html`);
    if (html.startsWith(ROOT + sep) && await fileOrNull(html)) return html;
  }
  return null;
}

async function serveFile(req, res, filePath) {
  const info = await fileOrNull(filePath);
  if (!info) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not found");
    return;
  }

  const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range;
  let start = 0;
  let end = info.size - 1;
  let status = 200;

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      start = match[1] ? Number(match[1]) : 0;
      end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) {
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${info.size}`);
        res.end();
        return;
      }
      status = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${info.size}`);
    }
  }

  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Length", String(end - start + 1));
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(filePath, { start, end }).pipe(res);
}

/* ---------- mock Apps Script endpoint ---------- */

async function readBody(req) {
  let raw = "";
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Payload too large.");
    raw += chunk;
  }
  return raw;
}

function duplicate(email, usn) {
  return mockRows.slice(1).some((row) =>
    String(row[3] || "").trim().toLowerCase() === email
    || String(row[5] || "").trim().toUpperCase() === usn
  );
}

function mockResult(params) {
  if (String(params.company || "").trim()) {
    return { ok: false, code: "invalid_request", message: "The submission could not be processed. Reload the page and try again." };
  }
  const startedAt = Number(params.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0 || Date.now() - startedAt < 2500) {
    return { ok: false, code: "invalid_request", message: "The submission could not be processed. Reload the page and try again." };
  }

  const errors = {};
  if (!String(params.fullName || "").trim()) errors.fullName = "Enter your full name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(params.email || ""))) errors.email = "Enter a valid email address.";
  if (!/^\+?[0-9]{10,15}$/.test(String(params.phone || ""))) errors.phone = "Enter 10–15 digits, with country code if needed.";
  if (!String(params.usn || "").trim()) errors.usn = "Enter your USN or student ID.";
  if (!String(params.year || "").trim()) errors.year = "Select your current year of study.";
  if (!String(params.branch || "").trim()) errors.branch = "Enter your branch or department.";
  if (!String(params.department || "").trim()) errors.department = "Select a preferred team or department.";
  if (!String(params.skills || "").trim()) errors.skills = "Tell the team about your technical skills.";
  if (String(params.motivation || "").trim().length < 40) errors.motivation = "Add a little more detail (40 characters minimum).";
  if (!["yes", "on", "true", "1"].includes(String(params.consent || ""))) errors.consent = "You must consent to the collection and use of your registration data.";

  if (Object.keys(errors).length) {
    return { ok: false, code: "validation_error", message: "Please correct the highlighted fields and submit again.", errors };
  }

  const email = String(params.email).trim().toLowerCase();
  const usn = String(params.usn).trim().toUpperCase();
  const idemKey = String(params.idempotencyKey || "").slice(0, 200);
  if (idemKey && mockIdempotency.has(idemKey)) return mockIdempotency.get(idemKey);

  if (duplicate(email, usn)) {
    return { ok: false, code: "already_registered", message: "A registration with this email or USN already exists. Email chitrak@rvce.edu.in if you need to update it." };
  }

  const now = new Date();
  const id = `CHK-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
  mockRows.push([
    id,
    now.toISOString(),
    String(params.fullName || "").trim(),
    email,
    String(params.phone || "").trim(),
    usn,
    String(params.year || "").trim(),
    String(params.branch || "").trim(),
    String(params.department || "").trim(),
    String(params.skills || "").trim(),
    String(params.experience || "").trim(),
    String(params.projects || "").trim(),
    String(params.motivation || "").trim(),
    String(params.portfolio || "").trim(),
    String(params.github || "").trim(),
    String(params.linkedin || "").trim(),
    ["yes", "on", "true", "1"].includes(String(params.commitment || "")) ? "Yes" : "No",
    "Yes — privacy notice v1",
    "New",
  ]);
  const result = { ok: true, submissionId: id, timestamp: now.toISOString() };
  if (idemKey) mockIdempotency.set(idemKey, result);
  return result;
}

function resultPage(result, nonce) {
  const payload = JSON.stringify({
    source: "chitrak-recruitment",
    result: { ...result, nonce: String(nonce || "").slice(0, 120) },
  }).replace(/</g, "\\u003c");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>window.top.postMessage(${payload}, "*");</script></body></html>`;
}

async function handleMockPost(req, res) {
  let status = 200;
  let result;
  try {
    const body = await readBody(req);
    const params = Object.fromEntries(new URLSearchParams(body));
    result = mockResult(params);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(resultPage(result, params.nonce));
  } catch (error) {
    status = error && error.message === "Payload too large." ? 413 : 400;
    result = { ok: false, code: "invalid_request", message: "The submission could not be processed." };
    res.statusCode = status;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(resultPage(result, ""));
  }
}

/* ---------- server ---------- */

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { pathname = url.pathname; }

    if (USE_MOCK && pathname === "/mock/apps-script" && req.method === "POST") {
      await handleMockPost(req, res);
      return;
    }

    if (USE_MOCK && pathname === "/mock/rows" && req.method === "GET") {
      const body = JSON.stringify({ headers: mockRows[0], rows: mockRows.slice(1) });
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(body);
      return;
    }

    if (USE_MOCK && pathname === "/data/recruitment.json" && req.method === "GET") {
      const config = JSON.parse(await readFile(join(ROOT, "data", "recruitment.json"), "utf8"));
      config.endpoint = `http://127.0.0.1:${PORT}/mock/apps-script`;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(config));
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD");
      res.end("Method not allowed");
      return;
    }

    const filePath = await resolveStatic(pathname);
    if (!filePath) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not found");
      return;
    }
    await serveFile(req, res, filePath);
  } catch (error) {
    console.error("[dev] request failed:", error && error.message);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
    }
    res.end("Server error");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`CHITRAK dev server: http://127.0.0.1:${PORT}`);
  console.log(`Recruitment page:  http://127.0.0.1:${PORT}/recruitment`);
  if (USE_MOCK) {
    console.log("Registration:      in-memory mock Apps Script endpoint");
    console.log("Mock rows:         http://127.0.0.1:" + PORT + "/mock/rows");
  } else {
    console.log("Registration:      Apps Script URL from data/recruitment.json");
  }
});

async function shutdown() {
  await new Promise((done) => server.close(done));
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
