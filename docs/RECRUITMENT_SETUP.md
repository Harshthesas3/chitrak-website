# Recruitment registration — setup and operations

The `/recruitment` page is a static Team Chitrak page with one server endpoint,
`POST /api/recruitment`. The endpoint validates every submission, rejects
duplicates and writes exactly one row to a private Google Sheet.

> **Verification status:** the endpoint has been tested end-to-end against an
> in-memory Google Sheets stub (`npm run dev:mock` and `npm test`). It has **not**
> yet been verified against a real Google spreadsheet, because no service-account
> key or shared spreadsheet was available during implementation. Do not announce
> that registrations are being saved until the checklist at the end of this
> document has been completed with a real test submission.

## Architecture

```
Browser (/recruitment)
  └─ native HTML form + js/recruitment.js
       └─ POST /api/recruitment  (JSON, idempotency key)
            ├─ origin check, body-size cap, honeypot, timing floor
            ├─ server-side validation (api/_lib/validation.js)
            ├─ rate limits (hashed IP + email; Upstash or in-memory)
            ├─ idempotency + identity locks
            ├─ duplicate email / USN check against the sheet
            └─ Google Sheets REST API (api/_lib/google.js)
                 └─ private spreadsheet, tab "Responses"
```

- No database, framework, or npm runtime dependency is used by the site.
- Google authentication is a service-account JWT signed with `node:crypto`.
- Credentials exist only in server-side environment variables. Nothing under
  `js/`, `css/`, `data/`, or the page HTML contains a secret.
- `data/recruitment.json` is public configuration (status, departments, years,
  retention). It is safe to commit.

## Files

| Path | Purpose |
| --- | --- |
| `recruitment/index.html` | Page markup, metadata, three-step form |
| `css/recruitment.css` | Page-specific styles on top of `css/styles.css` |
| `js/recruitment.js` | Config loading, client validation, steps, review, submit |
| `api/recruitment.js` | Vercel Node function: POST handler and anti-abuse |
| `api/_lib/validation.js` | Server validation, 19-column schema, row builder |
| `api/_lib/google.js` | Service-account JWT, sheet setup, read, append, delete |
| `data/recruitment.json` | Public recruitment configuration |
| `scripts/setup-recruitment-sheet.js` | Creates/repairs the tab and header row |
| `scripts/purge-recruitment.js` | Retention purge and email deletion (dry-run by default) |
| `scripts/dev-server.mjs` | Local static + API server |
| `scripts/mock-sheets-server.mjs` | In-memory Sheets stub, never contacts Google |
| `tests/validation.test.js` | Validation and spreadsheet-row tests |
| `tests/api.test.js` | Endpoint integration tests against the stub |
| `vercel.json` | Clean URLs and security headers/CSP |

## Public configuration

Edit `data/recruitment.json` and redeploy.

```json
{
  "status": "open",
  "statusLabel": "REGISTRATION OPEN",
  "cycleLabel": "RECRUITMENT — NEXT CYCLE",
  "cycleNote": "Cycle dates, eligibility and open positions will be confirmed by Team Chitrak.",
  "departments": [],
  "openDepartmentLabel": "Open application — placement discussed with the team",
  "years": ["1st year", "2nd year", "3rd year", "4th year", "Other"],
  "commitment": null,
  "consentVersion": "v1",
  "contactEmail": "chitrak@rvce.edu.in",
  "retentionDays": 180
}
```

- `status`: set to `"closed"` to stop accepting submissions. The endpoint then
  returns `503` and the page shows the closed state.
- `departments`: leave empty until Team Chitrak confirms the open positions.
  Empty means the form offers one “Open application” option. When confirmed, add
  the exact department names here; both the form and the server validation use
  this list, so invented values are rejected.
- `commitment`: `null` hides the commitment checkbox. Set an object such as
  `{ "required": true, "label": "..." }` only when the requirement is verified.
- Dates, eligibility, benefits, and deadlines are intentionally not invented.
  `cycleNote` and the “before you register” section state that these will be
  confirmed by the team.

## Environment variables

Copy `.env.example` to `.env.local` for local work, or add the same names in
Vercel → Project → Settings → Environment Variables. Never commit real values.

| Variable | Required | Notes |
| --- | --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Yes | Service-account address, e.g. `chitrak-recruitment@project.iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | Yes | Full private key, including `BEGIN/END` lines. Literal `\n` is accepted. |
| `GOOGLE_SHEET_ID` | Yes | ID between `/d/` and `/edit` in the spreadsheet URL |
| `GOOGLE_SHEET_TAB` | No | Defaults to `Responses` |
| `UPSTASH_REDIS_REST_URL` | Strongly recommended | Shared rate limits, idempotency, and identity locks across serverless instances |
| `UPSTASH_REDIS_REST_TOKEN` | Strongly recommended | Upstash REST token |
| `RECRUITMENT_ALLOWED_ORIGINS` | No | Comma-separated extra origins, e.g. a custom domain or preview URL. Same-origin is always allowed. |
| `RECRUITMENT_RATE_LIMIT_PER_HOUR` | No | Valid submissions per hashed IP per hour; default `8` |
| `RECRUITMENT_RATE_LIMIT_PER_DAY` | No | Valid submissions per hashed email per day; default `3` |

Without Upstash the limits and locks live in process memory. That is correct on a
single long-lived process, but on Vercel it is best-effort because instances are
short-lived and may scale out. Use Upstash before a public launch.

## Google Cloud and spreadsheet setup

1. Create or select a Google Cloud project.
2. Enable the **Google Sheets API**.
3. Create a **service account** (no project roles are needed).
4. Create a **JSON key** for that service account and download it once.
5. Create a new Google Sheet. Keep link sharing **off**.
6. Share the sheet with the service-account email as **Editor**.
7. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, and
   `GOOGLE_SHEET_ID` in `.env.local` (or in Vercel).
8. Create/repair the tab and headers:
   ```bash
   npm run setup:sheet
   ```
   This creates the `Responses` tab if missing and writes the exact header row.
   If an existing tab has a different header row, the API refuses to write until
   the script is run; this protects existing data.

The spreadsheet must stay private. Only the service account and authorised team
members should have access. Do not turn on “anyone with the link”.

## Sheet schema

The header row is stable and enforced server-side. `setup:sheet` repairs it.

| # | Header | Source |
| --- | --- | --- |
| 1 | `Submission ID` | Server, `CHK-YYYYMMDD-XXXXXXXX` |
| 2 | `Timestamp` | Server, ISO 8601 UTC |
| 3 | `Full Name` | Applicant |
| 4 | `Email` | Applicant, lowercased |
| 5 | `Phone` | Applicant, normalized |
| 6 | `USN` | Applicant, uppercased |
| 7 | `Year` | Applicant, from configured list |
| 8 | `Branch` | Applicant |
| 9 | `Preferred Department` | Applicant, from configured list |
| 10 | `Skills` | Applicant |
| 11 | `Experience` | Applicant, optional |
| 12 | `Projects` | Applicant, optional |
| 13 | `Motivation` | Applicant |
| 14 | `Portfolio` | Applicant, optional URL |
| 15 | `GitHub` | Applicant, optional URL |
| 16 | `LinkedIn` | Applicant, optional URL |
| 17 | `Availability` | `Yes`/`No` from the commitment checkbox when configured; `No` when the checkbox is hidden |
| 18 | `Consent` | Server, `Yes — privacy notice v1` |
| 19 | `Application Status` | Server, `New` |

The API checks that the header row matches exactly before appending. Accepted
submissions append one row; failed submissions append nothing.

## Security and privacy behaviour

- **Validation:** both client and server validate required fields, lengths,
  email/phone/USN formats, configured year/department values, and URLs. Server
  validation is authoritative and preserves submitted values in the browser when
  it fails.
- **Duplicates:** an existing email or USN in the sheet returns `409
  already_registered`. A short-lived identity lock (one for email, one for USN)
  closes the read-then-write race between different idempotency keys.
- **Retries:** the browser sends an idempotency UUID. A replay returns the
  original submission ID instead of adding a row. In-progress duplicate requests
  receive `409 in_progress` with `Retry-After: 2`.
- **Rate limits:** valid submissions are limited per hashed IP and per hashed
  email. Raw IPs and emails are not stored in Redis keys.
- **Spam:** hidden honeypot field, a 2.5-second minimum completion time, a 24-hour
  form expiry, same-origin check, and a 32 KB body cap.
- **Logging:** the endpoint logs only error classes, status codes, and generic
  messages. Applicant names, emails, phone numbers, and free-text answers are
  never logged or returned in errors.
- **Formula injection:** cells beginning with `=`, `+`, `-`, `@`, or a tab are
  prefixed with an apostrophe. Normal international phone numbers (`+<digits>`)
  are exempt so they display cleanly.
- **Headers:** `/recruitment` receives a CSP, HSTS, `X-Frame-Options: DENY`,
  `nosniff`, a referrer policy, and a restrictive permissions policy.
- **Retention:** `retentionDays` is `180`. Run the purge tool on a schedule.

## Local development and tests

```bash
npm run dev:mock     # http://127.0.0.1:8123 — in-memory Sheets, no credentials
npm test             # validation + endpoint integration tests
```

`npm run dev` uses the real API and therefore needs Google credentials for a
successful submission. The mock server is in-memory: restart it to reset rows.

The automated suite covers:

- accepted submission and exact 19-column row;
- validation failures before any write;
- duplicate email and USN rejection;
- idempotent replay;
- concurrent repeat clicks with the same key;
- concurrent submissions with different keys (identity lock);
- storage failure returning `503` and a successful retry;
- rate limiting, origin rejection, wrong method/content type, malformed JSON,
  oversized bodies, and honeypot rejection;
- schema shape, phone storage, and formula injection escaping.

## Deployment

1. Set the required environment variables in Vercel for Production (and Preview
   if you want preview submissions to work).
2. Set `RECRUITMENT_ALLOWED_ORIGINS` if the site is served from a custom domain
   or a different preview host.
3. Deploy. `vercel.json` keeps `cleanUrls`, so the page is `/recruitment`.
4. Run `npm run setup:sheet` once against the production spreadsheet.
5. Submit a real test registration on the deployed page.
6. Open the spreadsheet and confirm exactly one new row with the same submission
   ID shown on the success screen.
7. Delete that test row (or use `npm run purge:recruitment -- --email=... --confirm`).
8. Only then announce that registration is open.

## Retention and deletion

Dry run first; nothing is deleted without `--confirm`.

```bash
# Rows older than 180 days
npm run purge:recruitment -- --days=180
npm run purge:recruitment -- --days=180 --confirm

# One applicant, by exact email (case-insensitive)
npm run purge:recruitment -- --email=name@rvce.edu.in
npm run purge:recruitment -- --email=name@rvce.edu.in --confirm
```

Schedule the age purge (for example, monthly) with a trusted operator or a
protected job. The script prints submission IDs, never applicant names, phones,
or emails.

## Verification checklist (required before launch)

- [ ] Sheets API enabled and service account created
- [ ] Spreadsheet created, link sharing off, service account added as Editor
- [ ] `npm run setup:sheet` succeeds and prints 19 headers
- [ ] `GOOGLE_*` variables set in Vercel (Production)
- [ ] Upstash configured (recommended)
- [ ] Deployed `/recruitment` loads with no console errors
- [ ] Real test submission returns a success screen with a submission ID
- [ ] The same ID and row appear in the real spreadsheet
- [ ] A second submission with the same email is rejected as a duplicate
- [ ] A forced storage failure shows the retry message, not a false success
- [ ] Test row deleted after verification
- [ ] Team has confirmed the public status, departments, and cycle wording
