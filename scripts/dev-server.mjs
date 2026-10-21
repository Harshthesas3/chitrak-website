/* Local development server for the static site + /api/recruitment.
   Mirrors Vercel cleanUrls for /recruitment and /sponsor.

   npm run dev            -> real API (needs Google credentials if submitting)
   npm run dev:mock       -> in-memory mock Sheets, safe end-to-end testing

   This file is development-only and is excluded from Vercel deployments. */

import http from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { startMockSheets } from "./mock-sheets-server.mjs";

const require = createRequire(import.meta.url);
const { loadEnv } = require("./lib/load-env.js");
loadEnv();

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = new Set(process.argv.slice(2));
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const PORT = Number(portArg ? portArg.split("=")[1] : process.env.PORT || 8123);
const USE_MOCK = args.has("--mock-sheets");

let mock = null;
if (USE_MOCK) {
  mock = await startMockSheets();
  process.env.GOOGLE_SHEETS_API_BASE = mock.url;
  process.env.GOOGLE_ACCESS_TOKEN = "local-mock-token";
  process.env.GOOGLE_SHEET_ID = "local-mock-sheet";
  process.env.GOOGLE_SHEET_TAB = "Responses";
  process.env.RECRUITMENT_RATE_LIMIT_PER_HOUR = "100";
  process.env.RECRUITMENT_RATE_LIMIT_PER_DAY = "100";
}

const handler = require("../api/recruitment.js");

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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { pathname = url.pathname; }

    if (pathname === "/api/recruitment" || pathname === "/api/recruitment/") {
      req.headers["x-forwarded-host"] = req.headers.host || `127.0.0.1:${PORT}`;
      req.headers["x-forwarded-proto"] = "http";
      await handler(req, res);
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
    console.log("Google Sheets:     in-memory mock (no real data is written)");
    console.log("Mock sheet rows are available only for this process.");
  } else {
    console.log("Google Sheets:     real credentials from environment/.env.local");
  }
});

async function shutdown() {
  await new Promise((done) => server.close(done));
  if (mock) await mock.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
