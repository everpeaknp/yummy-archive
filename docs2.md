[19:40, 1/12/2026] Niraj: Below is a clear frontend implementation plan for the archive/delete flow. It covers auth, endpoints, payloads/responses, UX recommendations, and data access paths. Assumes: user logs into main backend to obtain a JWT; that JWT includes restaurant_id and is used for FastAPI-2.

1) Auth Flow
Login via main backend, store access_token (Bearer JWT).
Ensure token contains restaurant_id and sub/user_id.
Include Authorization: Bearer <token> on all FastAPI-2 requests.
2) Primary Data Sources (main backend)
List days with orders (API from main backend; adjust to your actual endpoint/shape):
GET /orders/days?restaurant_id=... (example)
Response example: { days: [{ date: "2026-01-11", order_count: 21, total_amount: 12345 }, ...] }
List orders for a day (main backend)…
[21:15, 1/12/2026] Niraj: Auth & Tokens
Obtain access token from main backend login (contains restaurant_id).
Store access_token securely (in-memory or secure storage); include Authorization: Bearer <token> on all FastAPI-2 calls.
Backend Endpoints to Use (FastAPI-2)
Job listing

GET /archive/jobs?start_day=YYYY-MM-DD&end_day=YYYY-MM-DD
Headers: Authorization: Bearer <token>
Response: { jobs: [{ job_id, archive_day, status, created_at }, ...] }
Archive creation (by day)

POST /jobs/archive
Headers: Authorization: Bearer <token>
Body: either
By day range: {"restaurant_id":<id>, "start_date":"2026-01-11T00:00:00Z", "end_date":"2026-01-11T23:59:59Z"}
(Internally resolves days; one job per day. Returns jobs array)
Response: { jobs: [{ archive_day, job_id, status, created }, ...] }
Archive status

GET /jobs/archive/{job_id} → { job_id, status, restaurant_id, created_at, manifest_path }
Manifest

GET /archive/{job_id}/manifest → includes datasets, row_counts, total_checksum, restaurant_timezone, archive_day, criteria.
Query archived data

By job_id: GET /archive/{job_id}/query/{table_name}?limit=..&offset=..&sort_by=..&sort_desc=..&start_date=..&end_date=..
By day: GET /archive/by-day/{archive_day}/query/{table_name}?limit=..&offset=..&...
Response: { data: [...], meta: { limit, offset, count, filters } }
Delete (irreversible)

POST /jobs/delete
Headers: Bearer token
Body: {"archive_job_id":"<job_id>","restaurant_id":<id>}
Response: { delete_job_id, status }
Frontend Flows
1) Archive Job Management (Daily)
Screen: Archive Dashboard

Fetch job list: GET /archive/jobs?start_day=<start>&end_day=<end>
Display calendar or list grouped by day with status chips (Not archived/In progress/Archived/Failed).
Actions per day:
If not archived: “Archive” → POST /jobs/archive (day range covering that day).
If archived: “View” → uses manifest/viewer endpoints.
Show last run timestamp and status.
Archive creation flow:

User picks a day (or date range). You submit a single POST /jobs/archive with that date range; backend creates one job per day.
Show returned jobs; poll each via /jobs/archive/{job_id} until EXPORTED/FAILED.
On EXPORTED, fetch manifest and show row counts/checksum/timezone.
2) Archive Viewer
Entry points:

From job list: click “View” for a day → use GET /archive/by-day/{day}/query/{table} or /manifest via job_id.
From a job detail: use job_id endpoints.
UI:

Show manifest summary cards: total rows per table, checksum, exported_at, archive_day, timezone.
Table selector (orders, order_items, notifications, audit_logs, etc.).
Data table: call query endpoint (by day or job_id) with pagination/sorting. Render data rows and meta.
Filters: start_date/end_date (use if the table has created_at), sort_by, sort_desc.
“Download CSV” button: either reuse the query endpoint with a high limit or add a CSV endpoint later.
3) Delete Flow (Irreversible)
From a job/day that is EXPORTED: show “Delete” button.
Confirmation modal: warn about permanent deletion and list date/job.
Call POST /jobs/delete with archive_job_id and restaurant_id.
Show delete status (DELETED/FAILED).
4) Error/Status Handling
Archive status: handle PENDING/EXPORTING with polling; FAILED shows reason (if exposed) and allow retrying archive.
Query errors: if 400, surface message (e.g., column missing when filtering) to user.
Auth errors: if 401/403, force re-login via main backend.
Request/Response Examples (for frontend)
List jobs

GET /archive/jobs?start_day=2026-01-01&end_day=2026-01-31
Headers: Authorization: Bearer <token>
Response: { "jobs": [ { "job_id": "...", "archive_day": "2026-01-11", "status": "EXPORTED", "created_at": "..." } ] }
Create archive (day)

POST /jobs/archive
Headers: Authorization: Bearer <token>
Body: { "restaurant_id": 52, "start_date": "2026-01-11T00:00:00Z", "end_date": "2026-01-11T23:59:59Z" }
Response: { "jobs": [ { "archive_day": "2026-01-11", "job_id": "...", "status": "PENDING", "created": true } ] }
Manifest

GET /archive/<job_id>/manifest
Response: { "datasets": {...}, "row_counts": {...}, "total_checksum": "...", "restaurant_timezone": "...", "archive_day": "2026-01-11", ... }
Query by day

GET /archive/by-day/2026-01-11/query/orders?limit=50&offset=0&sort_by=created_at&sort_desc=true
Response: { "data": [ ...rows... ], "meta": { "limit": 50, "offset": 0, "count": 50, "filters": { "start": null, "end": null } } }
Delete

POST /jobs/delete
Headers: Authorization: Bearer <token>
Body: { "archive_job_id": "<job_id>", "restaurant_id": 52 }
Response: { "delete_job_id": "...", "status": "DELETED" }
UI Recommendations
Dashboard: date picker or calendar with daily status; filters for status/date range.
Job detail pane: show manifest summary, dataset row counts, checksum, timezone, archive_day.
Viewer: table selector + data table with pagination/sort; display applied filters; export CSV action.
Delete action: double-confirm modal; show job/day being deleted.
Loading states: spinners for polling; status chips for jobs; error toasts on failures.
Auth: on 401/403, prompt re-login; ensure token refresh flow matches main backend.
Notes/Dependencies
Job IDs are needed for delete/manifest; listing endpoint allows picking by day without knowing job_id.
Internal DB is currently sqlite (ephemeral); for stable job history, move INTERNAL_DATABASE_URL to Postgres.
If you need direct Parquet downloads, add a pre-signed URL endpoint; otherwise, use the query endpoint for UI.