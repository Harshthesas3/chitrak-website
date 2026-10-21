# Recruitment registration — setup and operations

The `/recruitment` page is a static Team Chitrak page. Registrations are
validated in the browser and again by a Google Apps Script web app, which writes
one row to a private Google Sheet.

**No Google Cloud project, API key, service account, Vercel backend, or billing
is required.**

> **Verification status:** verified on 21 October 2026 against the real Apps
> Script deployment and spreadsheet. A test registration was written
> (`CHK-20261021-772B5DC9`) and a repeat submission was rejected as a duplicate,
> proving the first row was read back from the sheet. Delete that test row before
> launch (see the end of this document).

## How it works

```
Browser (/recruitment)
  └─ native form + js/recruitment.js
       └─ hidden iframe POST → Google Apps Script web app
            ├─ honeypot + minimum completion time
            ├─ server-side validation
            ├─ per-email rate limit
            ├─ duplicate email / USN check
            ├─ script lock (prevents simultaneous duplicates)
            └─ appends one row to the private "Responses" tab
       ← postMessage with the result
```

Apps Script web apps do not send CORS headers, so the page posts the form into a
hidden iframe. The Apps Script response is a tiny page that sends the result back
with `postMessage`. A random nonce ties the response to the submission.

The spreadsheet stays private. The web app runs as the sheet owner and has no
read API exposed to the browser.

## One-time setup (about 10 minutes)

1. Create a new Google Sheet, for example `Chitrak Recruitment`.
2. In the sheet, open **Extensions → Apps Script**.
3. Delete the default `Code.gs` content and paste the contents of
   [`apps-script/Code.gs`](../apps-script/Code.gs).
4. Save the project.
5. Click **Deploy → New deployment**.
6. Select **Web app**.
7. Set:
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
8. Click **Deploy** and authorize the script when Google asks.
9. Copy the **Web app URL**. It looks like:
   ```text
   https://script.google.com/macros/s/AKfycb.../exec
   ```
10. Paste it into `data/recruitment.json`:
    ```json
    "endpoint": "https://script.google.com/macros/s/AKfycb.../exec"
    ```
11. Commit and push, or redeploy the site.

The script creates the `Responses` tab and the 19-column header row on the first
submission if they do not exist. Keep the sheet private; only authorised team
members should have access.

## Form fields

Personal: full name, college email, phone, USN/student ID, year, branch.

Preferences: preferred department, technical skills, experience (optional),
projects (optional), motivation, portfolio/GitHub/LinkedIn (optional).

Review/consent: commitment checkbox only when configured, privacy consent
required.

## Sheet schema

The header row is validated before every write. A mismatch is refused rather
than writing into the wrong columns.

| # | Header | Source |
| --- | --- | --- |
| 1 | `Submission ID` | Script, `CHK-YYYYMMDD-XXXXXXXX` |
| 2 | `Timestamp` | Script, ISO 8601 UTC |
| 3 | `Full Name` | Applicant |
| 4 | `Email` | Applicant, lowercased |
| 5 | `Phone` | Applicant, normalized |
| 6 | `USN` | Applicant, uppercased |
| 7 | `Year` | Applicant |
| 8 | `Branch` | Applicant |
| 9 | `Preferred Department` | Applicant |
| 10 | `Skills` | Applicant |
| 11 | `Experience` | Applicant, optional |
| 12 | `Projects` | Applicant, optional |
| 13 | `Motivation` | Applicant |
| 14 | `Portfolio` | Applicant, optional URL |
| 15 | `GitHub` | Applicant, optional URL |
| 16 | `LinkedIn` | Applicant, optional URL |
| 17 | `Availability` | `Yes`/`No` from the commitment checkbox |
| 18 | `Consent` | Script, `Yes — privacy notice v1` |
| 19 | `Application Status` | Script, `New` |

Capacity: 1,000 registrations use about 19,000 cells. Google Sheets allows up to
10 million cells per spreadsheet, so this is well within the free limit.

## Public configuration

Edit `data/recruitment.json` and redeploy.

```json
{
  "status": "open",
  "endpoint": "https://script.google.com/macros/s/.../exec",
  "statusLabel": "REGISTRATION OPEN",
  "cycleLabel": "RECRUITMENT — NEXT CYCLE",
  "cycleNote": "Cycle dates, eligibility and open positions will be confirmed by Team Chitrak.",
  "departments": [
    "Mechanical",
    "Electrical",
    "Social Media & Sponsorships"
  ],
  "openDepartmentLabel": "Open application — placement discussed with the team",
  "years": ["1st year", "2nd year", "3rd year", "4th year", "Other"],
  "commitment": null,
  "consentVersion": "v1",
  "contactEmail": "chitrak@rvce.edu.in",
  "retentionDays": 180
}
```

- `status`: `"open"` accepts registrations; `"closed"` hides the form and shows
  the closed message.
- `endpoint`: the deployed Apps Script web app URL. Leave empty to disable
  submission with a clear error.
- `departments`: the confirmed preference list shown in the dropdown. The browser
  validates against these exact values. If the list is empty, the form falls back
  to a single “Open application” option.
- `commitment`: `null` hides the commitment checkbox. Set an object such as
  `{ "required": true, "label": "..." }` only when the requirement is verified.
- `retentionDays`: displayed in the privacy notice. Deletion is manual (see
  below).
- Dates, eligibility, benefits and deadlines are intentionally not invented.
  The page states that these will be confirmed by the team.

If you change `consentVersion`, also update `CONSENT_VERSION` in
`apps-script/Code.gs` and redeploy the web app.

## Security and privacy

- **Private storage:** the spreadsheet is not public. Only the owner and people
  the owner shares it with can read it.
- **Server-side validation:** the Apps Script repeats the browser validation and
  checks lengths, email, phone, USN, URLs and consent.
- **Duplicates:** existing email or USN returns `already_registered`. A script
  lock prevents two simultaneous requests from both passing the check.
- **Retries:** the page sends an idempotency key. A repeat returns the original
  submission ID for up to 6 hours instead of adding a row.
- **Spam:** hidden honeypot field, 2.5-second minimum completion time, 24-hour
  form expiry, and 5 valid attempts per email per 6 hours.
- **No PII in logs:** the script logs only an error class, never names, emails,
  phone numbers or answers.
- **No PII in URLs:** submissions use a POST body, not query strings.
- **Formula injection:** cells starting with `=`, `+`, `-`, `@` or a tab are
  prefixed with an apostrophe. International phone numbers are exempt so they
  display normally.
- **Page headers:** `/recruitment` receives a CSP that allows only the Apps
  Script frame and form target, plus HSTS, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, and a restrictive referrer policy.
- **Data use:** the privacy notice states who can access registrations and the
  retention period.

Limitations to be aware of:

- Apps Script does not expose a reliable client IP, so rate limiting is per email,
  not per connection.
- A public web app can still be targeted by a determined spammer. The honeypot,
  timing floor and duplicate check stop ordinary bots.
- Free Apps Script quotas are far above 1,000 submissions, but extremely high
  traffic in one day could hit daily execution limits.

## Local development and tests

```bash
npm run dev:mock     # http://127.0.0.1:8123 — in-memory mock, no Google account
npm test             # validation, schema and Apps Script pipeline tests
```

`npm run dev:mock` injects a local mock endpoint into the page and never contacts
Google. Mock rows are available at `http://127.0.0.1:8123/mock/rows` while the
server runs.

To test the real Apps Script locally, put the deployed URL in
`data/recruitment.json` and run:

```bash
npm run dev
```

The automated suite covers:

- complete valid submission and exact 19-column row;
- validation failures before any write;
- duplicate email and USN rejection;
- idempotent replay;
- busy script lock;
- honeypot, fast submissions and expired forms;
- per-email rate limiting;
- mismatched header row;
- empty tab header creation;
- schema, phone storage and formula-injection escaping.

## Deployment

1. Set the Apps Script URL in `data/recruitment.json`.
2. Push to the branch connected to Vercel, or redeploy from the Vercel dashboard.
3. `vercel.json` keeps clean URLs, so the page is `/recruitment`.
4. Open the deployed page and submit a real test registration.
5. Confirm the row and submission ID in the real spreadsheet.
6. Delete the test row.
7. Only then announce that registration is open.

No environment variables are required.

## Retention and deletion

Delete records by selecting the rows in the `Responses` tab and choosing
**Delete rows**. Google Sheets version history keeps a recoverable copy for a
limited time.

Suggested process:

- Review and remove expired registrations after `retentionDays` (180 by default).
- If an applicant asks for deletion, search for their email in column D, delete
  the row, and confirm by email.
- Do not export the sheet to a public location or enable “anyone with the link”.

## Verification checklist

- [ ] Apps Script pasted and saved
- [ ] Web app deployed as **Me**, access **Anyone**
- [ ] Web app URL added to `data/recruitment.json`
- [ ] Site redeployed
- [ ] `/recruitment` loads with no console errors
- [ ] Real test submission shows a success screen with a submission ID
- [ ] The same ID and row appear in the real spreadsheet
- [ ] A second submission with the same email is rejected as a duplicate
- [ ] Test row deleted after verification
- [ ] Team confirmed status, departments and cycle wording
