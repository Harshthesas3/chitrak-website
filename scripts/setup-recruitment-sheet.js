/* Create/verify the recruitment spreadsheet tab and its stable header row.
   Run after sharing the spreadsheet with the service account as Editor.

   Usage: node scripts/setup-recruitment-sheet.js
*/

const { loadEnv } = require("./lib/load-env");
loadEnv();

const { ensureSheet, tabName, HEADERS } = require("../api/_lib/google");

async function main() {
  const tab = tabName();
  console.log(`Preparing spreadsheet tab "${tab}"…`);
  const info = await ensureSheet(tab, { repairHeaders: true });
  console.log(`Sheet ready. Tab: ${info.tab}. Columns: ${HEADERS.length}.`);
  console.log("Headers:");
  console.log(HEADERS.map((header, index) => `${index + 1}. ${header}`).join("\n"));
  console.log("\nAccess reminder: share the spreadsheet only with the service account (Editor) and authorised team members. Do not enable public link sharing.");
}

main().catch((error) => {
  console.error(`Setup failed: ${error.message}`);
  if (error.name === "ConfigError") {
    console.error("Check GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY and GOOGLE_SHEET_TAB.");
  }
  process.exitCode = 1;
});
