/* In-memory Google Sheets API stub for local development and automated tests.
   It never contacts Google and never stores real applicant data. */

import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { HEADERS } = require("../api/_lib/validation.js");

export function createMockSheetsState() {
  return {
    sheetId: 0,
    tab: "Responses",
    rows: [HEADERS.slice()],
    failAppend: false,
    failRead: false,
    delayMs: 0,
    appended: 0,
  };
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function parseRange(raw) {
  const value = decodeURIComponent(String(raw || ""));
  const bang = value.lastIndexOf("!");
  if (bang < 0) return { tab: value, cells: "" };
  return { tab: value.slice(0, bang), cells: value.slice(bang + 1) };
}

export function createMockSheetsServer(state = createMockSheetsState()) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const path = decodeURIComponent(url.pathname);

    if (state.failRead) {
      return json(res, 500, { error: { message: "Mock Google Sheets read failure." } });
    }

    if (req.method === "GET" && /^\/v4\/spreadsheets\/[^/]+$/.test(path)) {
      return json(res, 200, {
        sheets: [{ properties: { title: state.tab, sheetId: state.sheetId } }],
      });
    }

    if (req.method === "POST" && path.endsWith(":batchUpdate")) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      let body = {};
      try { body = JSON.parse(raw); } catch { body = {}; }
      for (const request of body.requests || []) {
        if (request.addSheet) {
          const title = request.addSheet.properties && request.addSheet.properties.title;
          if (title === state.tab) {
            return json(res, 400, { error: { message: "A sheet with this name already exists." } });
          }
        }
        if (request.deleteDimension) {
          const range = request.deleteDimension.range || {};
          const start = Number(range.startIndex);
          const end = Number(range.endIndex);
          if (Number.isFinite(start) && Number.isFinite(end)) {
            state.rows.splice(start, end - start);
          }
        }
      }
      return json(res, 200, {});
    }

    if (req.method === "GET" && path.endsWith("/values:batchGet")) {
      if (state.delayMs > 0) await new Promise((done) => setTimeout(done, state.delayMs));
      const ranges = url.searchParams.getAll("ranges");
      const valueRanges = ranges.map((rawRange) => {
        const { cells } = parseRange(rawRange);
        const column = cells.startsWith("D") ? 3 : cells.startsWith("F") ? 5 : 0;
        const values = state.rows.slice(1)
          .map((row) => [row[column]])
          .filter((row) => row[0] !== undefined);
        return { range: rawRange, majorDimension: "ROWS", values };
      });
      return json(res, 200, { valueRanges });
    }

    if (path.includes("/values/")) {
      const afterValues = path.slice(path.indexOf("/values/") + "/values/".length);

      if (req.method === "POST" && afterValues.endsWith(":append")) {
        if (state.failAppend) {
          return json(res, 500, { error: { message: "Mock Google Sheets append failure." } });
        }
        let raw = "";
        for await (const chunk of req) raw += chunk;
        let body = {};
        try { body = JSON.parse(raw); } catch { body = {}; }
        const row = body.values && body.values[0];
        if (!Array.isArray(row)) return json(res, 400, { error: { message: "Missing values." } });
        state.rows.push(row);
        state.appended += 1;
        const rowNumber = state.rows.length;
        return json(res, 200, {
          updates: {
            updatedRange: `${state.tab}!A${rowNumber}:S${rowNumber}`,
            updatedRows: 1,
            updatedColumns: row.length,
          },
        });
      }

      if (req.method === "GET") {
        const { cells } = parseRange(afterValues);
        if (cells.includes("A1")) {
          return json(res, 200, {
            range: afterValues,
            majorDimension: "ROWS",
            values: state.rows.length ? [state.rows[0]] : [],
          });
        }
        if (cells.includes("A2:D")) {
          return json(res, 200, {
            range: afterValues,
            majorDimension: "ROWS",
            values: state.rows.slice(1).map((row) => row.slice(0, 4)),
          });
        }
        if (cells.includes("A2:B")) {
          return json(res, 200, {
            range: afterValues,
            majorDimension: "ROWS",
            values: state.rows.slice(1).map((row) => row.slice(0, 2)),
          });
        }
        return json(res, 200, {
          range: afterValues,
          majorDimension: "ROWS",
          values: state.rows.slice(1),
        });
      }

      if (req.method === "PUT") {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        let body = {};
        try { body = JSON.parse(raw); } catch { body = {}; }
        if (body.values && body.values[0]) state.rows[0] = body.values[0];
        return json(res, 200, { updatedRows: 1 });
      }
    }

    return json(res, 404, { error: { message: `Mock Sheets route not found: ${req.method} ${path}` } });
  });

  return { server, state };
}

export function startMockSheets({ port = 0, state = createMockSheetsState() } = {}) {
  const { server } = createMockSheetsServer(state);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
        state,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

if (process.argv[1] && process.argv[1].endsWith("mock-sheets-server.mjs")) {
  const mock = await startMockSheets({ port: Number(process.env.MOCK_SHEETS_PORT || 8787) });
  console.log(`Mock Google Sheets listening at ${mock.url}`);
  console.log("This is an in-memory stub. No real spreadsheet is touched.");
}
