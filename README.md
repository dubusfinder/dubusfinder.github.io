# DU BUS FINDER — starter frontend

This is the first frontend prototype. It is responsive and includes a PWA manifest/service worker.

## Run it
For a quick local preview, open `index.html` in a browser. For PWA installation and service-worker testing, deploy it to an HTTPS host such as GitHub Pages.

## Load the database
Use the **Load database** button at the bottom-right and select the Claude-generated Excel workbook. It must contain a sheet named `BusSchedule` with columns such as:
- `bus_name`
- `direction`
- `trip_time`
- `stopage` (or `stopage_name`)
- `arrival_time`
- `departure_time`
- `sequence`

The loader currently reads the `BusSchedule` sheet only. The other sheets will be used for validation and richer filtering in the next development step.

## Important limitations
- No real bus times are bundled; no schedules have been invented.
- The current search is a frontend prototype. The ±30-minute filter uses a stop-wise arrival/departure time if present.
- Scheduled-position estimation requires reliable stop order and stop-wise times.
- It is not live GPS tracking.
- The XLSX parser is loaded from a CDN, so the first database import requires an internet connection.

## Next step
Inspect the actual workbook headers and sample rows, then adapt the importer and connect the app to the live Google Sheets / Apps Script backend.
