# DU BUS FINDER — Safe Implementation & Migration Plan

Updated: 2026-11-05
Repository: `dubusfinder/dubusfinder.github.io`
Working branch: `autonomous-du-bus-finder`

## Source of truth and scope

This plan follows `DU_BUS_FINDER_Project_Guide.html` in the project Library. Existing website and spreadsheet data must be preserved. No schedule time or geographic coordinate may be invented. The public website must only read approved database rows. Contributor email is private and format validation is not identity verification.

## Audit snapshot

The latest committed snapshot inspected for this plan is `data/database.json` (commit at the start of this branch). It contains:

- Buses: 8
- Stops: 83
- BusSchedule: 1,225 rows
- ServiceDays: 133 rows
- Trip groups: 129
- All 129 trip groups have internally consistent bus name, direction and trip_time.
- No orphan ServiceDays trip IDs and no schedule trip without a ServiceDays record.
- 1,209 schedule rows have a unique normalized-name candidate in Stops; 15 schedule rows are explicitly `UNKNOWN`; one row already has a stop_id.
- 18 schedule rows have unknown/non-numeric sequence values (15 Boishakhi, 3 Taranga).
- All 83 stop records have blank coordinates in this snapshot.
- 1,224 schedule rows have blank stop_id; stopage_time is blank for 1,224 rows.
- Bus image URLs are blank in the snapshot; no bus code column exists.

The GitHub JSON file is a periodic public snapshot, not a live Sheets connector. Live Contributions/AdminLog headers and live API POST/CORS behavior cannot be independently verified from this workspace.

## Architecture decisions

1. Keep the existing sheets and columns. Do not create a normalized Trips sheet now: `trip_id` already groups each trip, and ServiceDays refers to that same ID.
2. Keep `BusSchedule` as the trip-stopage relationship table. `stopage_time` remains nullable.
3. Keep coordinates in `Stops`. A new stop proposal carries proposed coordinates in the pending contribution row; it is not public until approval.
4. Treat exact unique normalized stop-name matches as migration candidates only. Do not auto-map `UNKNOWN`, ambiguous or unmatched names.
5. Migration must be copy-only: create a separate candidate sheet/report and never overwrite the original BusSchedule. No migration is executed automatically by this website branch.
6. Preserve rows with unknown sequence and never draw an ordered route line when the sequence is unverified.
7. Pending submissions are isolated in Contributions. Only an authenticated admin approval applies them to Stops/BusSchedule.
8. Public contribution requests use form-encoded POST (`e.parameter.payload`) because the current Apps Script endpoint is not configured as a JSON REST API. A short-lived one-time nonce, payload limit, honeypot, rate limit and duplicate fingerprint protect submissions.
9. Admin identity remains server-side via `getAdminIdentity_()`; do not place credentials in browser code.
10. Contributor email is shown only in the authenticated admin dashboard and is not returned by public status endpoints.

## Migration dry-run

| Check | Result | Action |
|---|---:|---|
| Unique normalized Stops name candidate | 1,209 schedule rows | Candidate only; apply only to a copy after review |
| Explicit UNKNOWN stopage | 15 rows | Leave stop_id blank |
| Existing populated stop_id | 1 row | Preserve |
| Unknown/non-numeric sequence | 18 rows | Preserve; do not infer order |
| Stop coordinates | 83/83 blank | Map pins remain unavailable until verified locations are submitted |
| stopage_time | 1,224/1,225 blank | Keep blank; never copy trip_time |

## Development TODO / progress

- [x] Phase 1 — Audit current GitHub source, snapshot, feature set and Apps Script implementation.
- [x] Phase 2 — Finalize non-destructive architecture and migration rules.
- [x] Phase 3 — Searchable Bus Directory and Bus Details navigation preserved; “লাল বাস” now focuses the directory search.
- [x] Phase 4 — Bus Details now shows trip-specific stopage time, sequence status, route-map area and contribution entry point. Missing bus_code/image data is not fabricated.
- [x] Phase 5 — Each trip renders its own UP or DOWN map. Pins require verified coordinates; a route line is drawn only when every stop has coordinates and every sequence is numeric.
- [x] Phase 6 — Multi-stopage contribution UI supports ADD/UPDATE/REMOVE proposals, existing/new stopage choice, optional time, per-stop map search/click/drag and manual coordinate entry.
- [x] Phase 7 — Public POST now supports optional stopage_time, exact bus/trip checks, one-time nonce, payload size limit, honeypot, rate limit, duplicate fingerprint and public batch-status verification without exposing contributor email.
- [x] Phase 8 — Admin wrappers added; edit map fixed; REJECT and REQUEST_CORRECTION update status/log only and never apply schedule/stop changes. Admin can set existing stop coordinates through the authenticated dashboard. Formula-safe rollback added.
- [x] Phase 9 — Approved contribution apply engine and website database refresh path retained; copy-only stop_id migration preview/copy tool added. No unapproved or live spreadsheet migration was run.
- [~] Phase 10 — GitHub Actions JavaScript syntax validation passed for app.js, Code.js, GitHubSync.js and AdminDashboard inline scripts (run 41901613935). Browser interaction, live Apps Script POST/CORS, live spreadsheet approvals, mobile/desktop and offline regression tests remain unverified in this environment.

## Decisions made during implementation

- Keep the current sheet schema and `trip_id`; no new Trips sheet.
- Keep unknown sequence rows in source order and visibly mark sequence as unverified. Do not connect an ordered route line for those trips.
- Show “Not recorded” in the public stopage-time label when the stored value is blank; the database field remains blank.
- Use a form-encoded hidden-iframe POST because Apps Script currently reads `e.parameter.payload`; confirm receipt with a public batch-ID status endpoint that reveals no contributor email.
- Use Leaflet 1.9.4 and OpenStreetMap tiles with attribution. Public route maps are lazy-loaded to avoid unnecessary tile requests.
- Use Nominatim only on explicit search-button action, with a minimum query length and at least one second between public map searches.
- “Request Correction” changes the pending status and writes an audit log; it does not apply data. A contributor can submit a corrected proposal separately because no account/login workflow exists.
- Admin existing-location edits are server-authenticated and write only the selected Stops latitude/longitude cells.
- Stop ID migration is copy-only: `adminCreateStopIdMigrationCopy()` creates a separate copy and fills only unique exact-normalized name matches in its stop_id column.

## Known blockers / review items

- Google Drive/Sheets connector is disabled by the workspace administrator. This branch cannot inspect or edit the live Contributions/AdminLog tabs or run a live spreadsheet migration.
- Apps Script endpoint requests are not readable through the available web fetch path. POST/CORS must be validated in the deployed Apps Script test page after deployment.
- Existing `Code.js` calls missing `adminReviewBatch` / `adminReviewContribution` wrappers; the dashboard calls missing `adminEditApplyBatch`. `adminReview_` references an undefined `editMap`. This is a real source-level defect in the tracked Apps Script source.
- Current `adminReview_` calls the approval apply engine even for REJECT. This must be fixed so reject/correction only updates contribution status and audit log.
- Existing public POST rejects blank stopage_time despite the approval engine already treating it as optional.
- Existing schedule has no reliable coordinates; maps must display an unavailable state until actual coordinates are provided and approved.


## Progress log and release references

- Working branch: `autonomous-du-bus-finder`
- Pull request: https://github.com/dubusfinder/dubusfinder.github.io/pull/1
- Latest static validation run: https://github.com/dubusfinder/dubusfinder.github.io/actions/runs/41901613935 (success)
- No changes were made to `data/database.json`, the original Sheets, or existing schedule times/coordinates.
- `sw.js` cache version advanced from v30 to v31.

## Integrity rules for release

- No original database rows or columns are deleted by the frontend/backend feature changes.
- No migration changes the original BusSchedule.
- No unapproved contribution affects public `getDatabase()`.
- Reject and correction-request paths do not write to Stops or BusSchedule.
- Blank stopage_time remains blank.
- Invalid or missing coordinates are not plotted.
- No route line is drawn if any sequence in that trip is unknown/non-numeric or coordinates are incomplete.
- All existing search, time-window, favorites, recent-search, theme and PWA/offline code paths remain in place.
