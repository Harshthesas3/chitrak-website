/* POST /api/recruitment
   Native Team Chitrak registration endpoint. Validates server-side, rate limits,
   prevents duplicate submissions, and writes one row to a private Google Sheet.
   No applicant data is written to logs or returned in error responses. */

const crypto = require("node:crypto");
const config = require("../data/recruitment.json");
const {
  validateSubmission,
  buildRow,
} = require("./_lib/validation");
const {
  ConfigError,
  GoogleApiError,
  ensureSheet,
  getExistingIdentities,
  appendRow,
  tabName,
  resetCacheForTests,
} = require("./_lib/google");

const MAX_BODY_BYTES = 32 * 1024;
const IDEM_TTL_SECONDS = 24 * 60 * 60;
/* A crashed function invocation must not block an applicant for a whole day. */
const PENDING_TTL_SECONDS = 120;
/* Short-lived lock that closes the read-then-write race between different
   idempotency keys for the same email or USN. */
const IDENTITY_TTL_SECONDS = 60;
const memory = globalThis.__chitrakRecruitment || (globalThis.__chitrakRecruitment = {
  idempotency: new Map(),
  identityLocks: new Map(),
  rate: new Map(),
});

/* ---------- HTTP helpers ---------- */

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(payload));
}

function header(req, name) {
  const value = req.headers ? req.headers[name.toLowerCase()] : undefined;
  if (Array.isArray(value)) return String(value[0] || "");
  return String(value || "");
}

function firstToken(value) {
  return String(value || "").split(",")[0].trim();
}

function clientIp(req) {
  return firstToken(header(req, "x-forwarded-for"))
    || firstToken(header(req, "x-real-ip"))
    || (req.socket && req.socket.remoteAddress)
    || "unknown";
}

function originAllowed(req) {
  if (header(req, "sec-fetch-site") === "cross-site") return false;
  const origin = header(req, "origin");
  if (!origin) return true; // same-origin navigations / server-side tests

  const host = firstToken(header(req, "x-forwarded-host")) || firstToken(header(req, "host"));
  const proto = firstToken(header(req, "x-forwarded-proto")) || "https";
  if (host && origin === `${proto}://${host}`) return true;

  const extra = String(process.env.RECRUITMENT_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return extra.includes(origin);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Payload too large."), { statusCode: 413 }));
        return;
      }
      raw += chunk;
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

async function jsonBody(req) {
  const contentType = header(req, "content-type").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw Object.assign(new Error("Content-Type must be application/json."), { statusCode: 415 });
  }

  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;

  let raw = "";
  if (typeof req.body === "string") {
    raw = req.body;
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Payload too large."), { statusCode: 413 });
    }
  } else if (Buffer.isBuffer(req.body)) {
    if (req.body.length > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Payload too large."), { statusCode: 413 });
    }
    raw = req.body.toString("utf8");
  } else {
    raw = await readBody(req);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Invalid JSON."), { statusCode: 400 });
  }
}

/* ---------- hashing + optional Upstash Redis ---------- */

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 40);
}

function redisConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function redisPipeline(commands) {
  if (!redisConfigured()) return null;
  const url = String(process.env.UPSTASH_REDIS_REST_URL).replace(/\/+$/, "");
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN);
  try {
    const response = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data)) return null;
    return data.map((item) => (item && Object.prototype.hasOwnProperty.call(item, "result") ? item.result : null));
  } catch {
    return null;
  }
}

async function rateLimit(key, limit, windowSeconds) {
  if (redisConfigured()) {
    const result = await redisPipeline([
      ["INCR", key],
      ["EXPIRE", key, windowSeconds, "NX"],
    ]);
    if (result) {
      const count = Number(result[0]);
      if (Number.isFinite(count)) return { allowed: count <= limit, count };
    }
  }

  const now = Date.now();
  const record = memory.rate.get(key);
  if (!record || record.reset <= now) {
    memory.rate.set(key, { count: 1, reset: now + windowSeconds * 1000 });
    if (memory.rate.size > 2000) pruneMemory(now);
    return { allowed: limit >= 1, count: 1 };
  }
  record.count += 1;
  return { allowed: record.count <= limit, count: record.count };
}

function pruneMemory(now) {
  for (const [key, value] of memory.rate) {
    if (!value || value.reset <= now) memory.rate.delete(key);
  }
  for (const [key, value] of memory.idempotency) {
    if (!value || value.expires <= now) memory.idempotency.delete(key);
  }
  for (const [key, expires] of memory.identityLocks) {
    if (!expires || expires <= now) memory.identityLocks.delete(key);
  }
}

async function idemGet(key) {
  if (redisConfigured()) {
    const result = await redisPipeline([["GET", key]]);
    if (result) {
      const raw = result[0];
      if (!raw) return null;
      if (raw === "pending") return { state: "pending" };
      try {
        const parsed = JSON.parse(raw);
        return parsed && parsed.state ? parsed : null;
      } catch {
        return null;
      }
    }
  }
  const value = memory.idempotency.get(key);
  if (!value || value.expires <= Date.now()) {
    memory.idempotency.delete(key);
    return null;
  }
  return value;
}

async function idemClaim(key) {
  if (redisConfigured()) {
    const result = await redisPipeline([["SET", key, "pending", "EX", PENDING_TTL_SECONDS, "NX"]]);
    if (result) return result[0] === "OK";
  }
  const existing = memory.idempotency.get(key);
  if (existing && existing.expires > Date.now()) return false;
  memory.idempotency.set(key, { state: "pending", expires: Date.now() + PENDING_TTL_SECONDS * 1000 });
  return true;
}

async function idemComplete(key, payload) {
  const record = { state: "done", result: payload, expires: Date.now() + IDEM_TTL_SECONDS * 1000 };
  if (redisConfigured()) {
    await redisPipeline([["SET", key, JSON.stringify(record), "EX", IDEM_TTL_SECONDS]]);
  }
  memory.idempotency.set(key, record);
}

async function idemRelease(key) {
  if (redisConfigured()) await redisPipeline([["DEL", key]]);
  memory.idempotency.delete(key);
}

/* ---------- identity locks ---------- */

/* Claim one lock per identity (email and USN). All-or-nothing: if any lock is
   busy, release the others and report failure so the caller can retry. */
async function lockClaim(keys, ttlSeconds) {
  if (redisConfigured()) {
    const result = await redisPipeline(
      keys.map((key) => ["SET", key, "locked", "EX", ttlSeconds, "NX"])
    );
    if (result) {
      const acquired = keys.filter((_, index) => result[index] === "OK");
      if (acquired.length !== keys.length) {
        if (acquired.length) await redisPipeline(acquired.map((key) => ["DEL", key]));
        return false;
      }
      return true;
    }
  }

  const now = Date.now();
  for (const key of keys) {
    const expires = memory.identityLocks.get(key);
    if (expires && expires > now) return false;
  }
  for (const key of keys) memory.identityLocks.set(key, now + ttlSeconds * 1000);
  if (memory.identityLocks.size > 2000) pruneMemory(now);
  return true;
}

async function lockRelease(keys) {
  if (redisConfigured()) await redisPipeline(keys.map((key) => ["DEL", key]));
  for (const key of keys) memory.identityLocks.delete(key);
}

/* ---------- identifiers ---------- */

function submissionId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `CHK-${date}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

/* ---------- handler ---------- */

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { ok: false, code: "method_not_allowed", message: "Use POST." });
  }

  if (!originAllowed(req)) {
    return send(res, 403, { ok: false, code: "origin_not_allowed", message: "This request is not allowed from that origin." });
  }

  if (config.status !== "open") {
    return send(res, 503, {
      ok: false,
      code: "closed",
      message: "Registration is currently closed. The next recruitment window will be announced on the recruitment page.",
    });
  }

  let body;
  try {
    body = await jsonBody(req);
  } catch (error) {
    const status = error && error.statusCode ? error.statusCode : 400;
    return send(res, status, {
      ok: false,
      code: status === 413 ? "payload_too_large" : status === 415 ? "unsupported_media_type" : "invalid_json",
      message: status === 413
        ? "The submission is too large."
        : status === 415
          ? "The submission must use application/json."
          : "The submission could not be read.",
    });
  }

  const validation = validateSubmission(body, config);
  if (!validation.ok) {
    if (validation.bot) {
      // Do not reveal which anti-spam check fired.
      return send(res, 400, {
        ok: false,
        code: "invalid_request",
        message: "The submission could not be processed. Reload the page and try again.",
      });
    }
    return send(res, 400, {
      ok: false,
      code: "validation_error",
      message: "Please correct the highlighted fields and submit again.",
      errors: validation.errors,
    });
  }

  const data = validation.data;
  const idempotencyHeader = header(req, "idempotency-key").slice(0, 200);
  const idempotencyKey = `recruitment:idem:${hash(idempotencyHeader || `${data.email}|${data.usn}|${data.phone}`)}`;

  const prior = await idemGet(idempotencyKey);
  if (prior && prior.state === "done" && prior.result) {
    return send(res, 200, { ok: true, ...prior.result, replayed: true });
  }
  if (prior && prior.state === "pending") {
    res.setHeader("Retry-After", "2");
    return send(res, 409, {
      ok: false,
      code: "in_progress",
      message: "A submission is already being processed. Wait a moment before trying again.",
    });
  }

  const perHour = Math.max(1, Number(process.env.RECRUITMENT_RATE_LIMIT_PER_HOUR || 8));
  const perDay = Math.max(1, Number(process.env.RECRUITMENT_RATE_LIMIT_PER_DAY || 3));
  const ipLimit = await rateLimit(`recruitment:rate:ip:${hash(clientIp(req))}`, perHour, 3600);
  if (!ipLimit.allowed) {
    res.setHeader("Retry-After", "3600");
    return send(res, 429, {
      ok: false,
      code: "rate_limited",
      message: "Too many registration attempts from this connection. Please wait and try again.",
    });
  }
  const emailLimit = await rateLimit(`recruitment:rate:email:${hash(data.email)}`, perDay, 86400);
  if (!emailLimit.allowed) {
    res.setHeader("Retry-After", "86400");
    return send(res, 429, {
      ok: false,
      code: "rate_limited",
      message: "Too many registration attempts for this email. Please wait and try again, or contact the team.",
    });
  }

  const claimed = await idemClaim(idempotencyKey);
  if (!claimed) {
    const again = await idemGet(idempotencyKey);
    if (again && again.state === "done" && again.result) {
      return send(res, 200, { ok: true, ...again.result, replayed: true });
    }
    res.setHeader("Retry-After", "2");
    return send(res, 409, {
      ok: false,
      code: "in_progress",
      message: "A submission is already being processed. Wait a moment before trying again.",
    });
  }

  const identityKeys = [
    `recruitment:ident:email:${hash(data.email)}`,
    `recruitment:ident:usn:${hash(data.usn)}`,
  ];
  const identityLocked = await lockClaim(identityKeys, IDENTITY_TTL_SECONDS);
  if (!identityLocked) {
    await idemRelease(idempotencyKey);
    res.setHeader("Retry-After", "2");
    return send(res, 409, {
      ok: false,
      code: "in_progress",
      message: "A submission for these details is already being processed. Wait a moment before trying again.",
    });
  }

  try {
    await ensureSheet(tabName());

    const identities = await getExistingIdentities(tabName());
    if (identities.emails.includes(data.email) || identities.usns.includes(data.usn)) {
      await idemRelease(idempotencyKey);
      return send(res, 409, {
        ok: false,
        code: "already_registered",
        message: "A registration with this email or USN already exists. Email chitrak@rvce.edu.in if you need to update it.",
      });
    }

    const id = submissionId();
    const timestamp = new Date().toISOString();
    const row = buildRow(data, {
      submissionId: id,
      timestamp,
      consentVersion: config.consentVersion || "v1",
    });

    await appendRow(row, tabName());
    const result = { submissionId: id, timestamp };
    await idemComplete(idempotencyKey, result);
    return send(res, 201, { ok: true, ...result });
  } catch (error) {
    await idemRelease(idempotencyKey);
    if (error instanceof ConfigError) {
      console.error("[recruitment] configuration error:", error.message);
      return send(res, 503, {
        ok: false,
        code: "not_configured",
        message: "The registration service is not configured yet. Please email chitrak@rvce.edu.in.",
      });
    }
    if (error instanceof GoogleApiError) {
      console.error("[recruitment] spreadsheet error:", error.status || 0, error.message);
      return send(res, 503, {
        ok: false,
        code: "storage_unavailable",
        message: "Your registration could not be saved right now. Your details are still in the form — please try again, or email chitrak@rvce.edu.in.",
      });
    }
    console.error("[recruitment] unexpected error:", error && error.name ? error.name : "Error");
    return send(res, 500, {
      ok: false,
      code: "server_error",
      message: "Your registration could not be confirmed. Please try again, or email chitrak@rvce.edu.in.",
    });
  } finally {
    await lockRelease(identityKeys);
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: { sizeLimit: "32kb" } } };
module.exports.__resetForTests = () => {
  memory.rate.clear();
  memory.idempotency.clear();
  memory.identityLocks.clear();
  resetCacheForTests();
};
