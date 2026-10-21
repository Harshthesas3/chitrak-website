/* Retention / deletion tool for recruitment records.
   Default mode is a dry run. Nothing is deleted without --confirm.

   Retention purge (older than N days):
     npm run purge:recruitment -- --days=180
     npm run purge:recruitment -- --days=180 --confirm

   Data-subject deletion (exact email match):
     npm run purge:recruitment -- --email=name@rvce.edu.in
     npm run purge:recruitment -- --email=name@rvce.edu.in --confirm

   The script reads credentials from the server environment or .env.local.
   It never prints applicant names, phone numbers or emails.
*/

const { loadEnv } = require("./lib/load-env");
loadEnv();

const recruitmentConfig = require("../data/recruitment.json");
const {
  ensureSheet,
  spreadsheetMeta,
  readValues,
  deleteRows,
  tabName,
} = require("../api/_lib/google");

function parseArgs(argv) {
  const args = { confirm: false, dryRun: true, days: null, email: "" };
  for (const arg of argv) {
    if (arg === "--confirm") {
      args.confirm = true;
      args.dryRun = false;
    } else if (arg.startsWith("--days=")) {
      args.days = Number(arg.slice("--days=".length));
    } else if (arg.startsWith("--email=")) {
      args.email = arg.slice("--email=".length).trim().toLowerCase();
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }
  return args;
}

function groupRowRanges(rows) {
  const sorted = Array.from(new Set(rows)).sort((a, b) => a - b);
  const ranges = [];
  for (const row of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && row - 1 === last.endIndex) last.endIndex = row;
    else ranges.push({ startIndex: row - 1, endIndex: row });
  }
  return ranges;
}

async function sheetIdForTab(tab) {
  const meta = await spreadsheetMeta();
  const sheet = (meta.sheets || []).find((item) => item && item.properties && item.properties.title === tab);
  if (!sheet) throw new Error(`Tab "${tab}" not found. Run npm run setup:sheet first.`);
  return sheet.properties.sheetId;
}

async function purgeByEmail(email, tab, confirm) {
  const rows = await readValues(`${tab}!A2:D`);
  const matches = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => String((row && row[3]) || "").trim().toLowerCase() === email);

  if (!matches.length) {
    console.log("No registration found for that email address.");
    return;
  }

  console.log(`Found ${matches.length} registration(s) for that email.`);
  console.log(matches.map(({ row }) => String(row[0] || "(no ID)")).join("\n"));

  if (!confirm) {
    console.log("\nDry run only. Re-run with --confirm to delete these records.");
    return;
  }

  const id = await sheetIdForTab(tab);
  const ranges = groupRowRanges(matches.map(({ index }) => index + 2));
  await deleteRows(id, ranges.reverse());
  console.log(`Deleted ${matches.length} row(s).`);
}

async function purgeByAge(days, tab, confirm) {
  if (!Number.isFinite(days) || days < 1) {
    throw new Error("Use --days with a positive number, for example --days=180.");
  }

  const rows = await readValues(`${tab}!A2:B`);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const matches = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const timestamp = Date.parse(String((row && row[1]) || ""));
    if (Number.isFinite(timestamp) && timestamp < cutoff) {
      matches.push({ index, timestamp, id: String((row && row[0]) || "") });
    }
  }

  if (!matches.length) {
    console.log(`No records older than ${days} days.`);
    return;
  }

  const oldest = new Date(Math.min(...matches.map((item) => item.timestamp))).toISOString().slice(0, 10);
  const newest = new Date(Math.max(...matches.map((item) => item.timestamp))).toISOString().slice(0, 10);
  console.log(`${matches.length} record(s) older than ${days} days (${oldest} to ${newest}).`);
  console.log(matches.map((item) => item.id || "(no ID)").slice(0, 20).join("\n")
    + (matches.length > 20 ? `\n…and ${matches.length - 20} more` : ""));

  if (!confirm) {
    console.log("\nDry run only. Re-run with --confirm to delete these rows.");
    return;
  }

  const id = await sheetIdForTab(tab);
  const ranges = groupRowRanges(matches.map((item) => item.index + 2));
  await deleteRows(id, ranges.reverse());
  console.log(`Deleted ${matches.length} row(s).`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/purge-recruitment.js [--days=180 | --email=address] [--confirm]");
    return;
  }

  const tab = tabName();
  await ensureSheet(tab);

  if (args.email) {
    await purgeByEmail(args.email, tab, args.confirm);
    return;
  }

  const days = args.days || Number(recruitmentConfig.retentionDays || 180);
  await purgeByAge(days, tab, args.confirm);
}

main().catch((error) => {
  console.error(`Purge failed: ${error.message}`);
  process.exitCode = 1;
});
