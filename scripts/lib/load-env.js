/* Tiny .env loader for local scripts. No dependency, no output of values.
   Existing environment variables always win over file values. */

const fs = require("node:fs");
const path = require("node:path");

function parseValue(raw) {
  let value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value.replace(/\\n/g, "\n");
}

function loadEnv(fileNames = [".env.local", ".env"]) {
  for (const name of fileNames) {
    const file = path.join(process.cwd(), name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index < 1) continue;
      const key = trimmed.slice(0, index).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (process.env[key] !== undefined) continue;
      process.env[key] = parseValue(trimmed.slice(index + 1));
    }
  }
}

module.exports = { loadEnv };
