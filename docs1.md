Below is a clear frontend implementation plan for the archive/delete flow. It covers auth, endpoints, payloads/responses, UX recommendations, and data access paths. Assumes: user logs into main backend to obtain a JWT; that JWT includes restaurant_id and is used for FastAPI-2.

1) Auth Flow
Login via main backend, store access_token (Bearer JWT).
Ensure token contains restaurant_id and sub/user_id.
Include Authorization: Bearer <token> on all FastAPI-2 requests.
2) Primary Data Sources (main backend)
List days with orders (API from main backend; adjust to your actual endpoint/shape):
GET /orders/days?restaurant_id=... (example)
Response example: { days: [{ date: "2026-01-11", order_count: 21, total_amount: 12345 }, ...] }
List orders for a day (main backend):
orders?restaurant_id=...&date=YYYY-MM-DD
Response example: { orders: [{ id: 218, created_at: "...", total: 123, status: "completed", ... }], total: ... }
Use these to drive UI selection (by day or specific orders).

3) Archive API (FastAPI-2)
Create archive job
POST /jobs/archive
Headers: Authorization: Bearer <token>
Body (one of):
By order IDs: {"restaurant_id": 52, "order_ids": [218, 219]}
By date range (restaurant-local time is handled server-side): {"restaurant_id": 52, "start_date": "2026-01-11T00:00:00Z", "end_date": "2026-01-11T23:59:59Z"}
Response: {"job_id": "...", "status": "PENDING", "matched_count": <int|null>}
Get archive job
GET /jobs/archive/{job_id}
Response: {"job_id": "...", "status": "PENDING|EXPORTING|EXPORTED|FAILED", "restaurant_id": 52, "created_at": "...", "manifest_path": "<path or null>"}
Get manifest
GET /archive/{job_id}/manifest
Response includes datasets (file metadata), row_counts, total_checksum, restaurant_timezone, criteria.
4) Delete API (FastAPI-2) — irreversible
Create delete job
POST /jobs/delete
Headers: Bearer token
Body: {"archive_job_id": "<job_id>", "restaurant_id": 52}
Response: {"delete_job_id": "...", "status": "DELETED|..."}
Preconditions: archive job must be EXPORTED; manifest must exist.
5) Archive Viewer API (FastAPI-2)
Query archived table via DuckDB (server-side)
GET /archive/{job_id}/query/{table_name}?limit=...&offset=...&start_date=...&end_date=...&sort_by=...&sort_desc=...
Example: /archive/<job_id>/query/orders?limit=50&offset=0&sort_by=created_at&sort_desc=true
Response: {"data": [ {row...} ], "meta": { "limit": 50, "offset": 0, "count": 50, "filters": {...} }}
(Optionally, add a “download CSV” endpoint that uses the same query and streams CSV.)

6) UI Flow & Recommendations
Auth Guard: On app load, ensure access_token exists; if missing/expired, redirect to main login.
Home / Dashboard
Show date picker/list of days (from main backend) with counts and totals.
Let user toggle “by day” or “by specific orders” selection.
Selection Pane
By day: choose a day -> fetch orders for that day to show a list (with checkboxes).
By orders: show list with filters/sort; allow multi-select.
Review & Confirm
Show a summary: restaurant, selected date range or order IDs, count.
Warn this is export-first; deletion is irreversible.
Button: “Start Archive”.
Job Status
After POST /jobs/archive, show job_id and poll /jobs/archive/{job_id} until EXPORTED or FAILED.
On EXPORTED, fetch manifest; show row counts and checksum.
Offer:
“View archive data” -> use /archive/{job_id}/query/orders etc.
“Download CSV” (call query endpoint and convert server-side/client-side).
“Proceed to Delete” (if user confirms irreversible delete).
Delete Confirmation
Hard warning modal: “This will permanently delete N orders. Continue?”
On confirm, POST /jobs/delete.
Show resulting status DELETED or FAILED.
Archive Viewer
Table selector (orders, order_items, notifications, etc.).
Data table with pagination; columns aligned to returned JSON.
Filters: date range, sort by created_at/other columns.
Actions: Export to CSV (query endpoint), View JSON, optionally download manifest.
States & Error Handling
PENDING/EXPORTING: spinner and poll.
FAILED: show error and allow retry (create new archive job).
EXPORTED: show manifest summary.
Access to Parquet files
For UI display, rely on /archive/{job_id}/query/{table} (JSON).
For direct download, add a backend endpoint to pre-sign S3 keys in manifest (future work).
7) Request/Response Examples (FastAPI-2)
Create archive by date:
POST /jobs/archive
Headers: Authorization: Bearer <token>
Body: {
  "restaurant_id": 52,
  "start_date": "2026-01-11T00:00:00Z",
  "end_date": "2026-01-11T23:59:59Z"
}
Response: {
  "job_id": "4e880b53-26cb-458f-813f-154e318ac322",
  "status": "PENDING",
  "matched_count": null
}
Manifest:
GET /archive/4e880b53-26cb-458f-813f-154e318ac322/manifest
Response: {
  "job_id": "...",
  "restaurant_id": 52,
  "datasets": { "orders": [ { "path": "...", "checksum": "...", "rows": 21 }, ... ] },
  "row_counts": { "orders": 21, "order_items": 40, ... },
  "total_checksum": "...",
  "restaurant_timezone": "Asia/Kathmandu",
  "criteria": { "order_ids": null, "start_date": "2026-01-11T00:00:00+00:00", "end_date": "2026-01-11T23:59:59+00:00" }
}
Query:
GET /archive/<job_id>/query/orders?limit=50&offset=0&sort_by=created_at&sort_desc=true
Response: {
  "data": [ { "id": 123, "created_at": "2026-01-11T10:05:00", ... }, ... ],
  "meta": { "limit": 50, "offset": 0, "count": 50, "filters": { "start": null, "end": null } }
}
Delete:
POST /jobs/delete
Headers: Authorization: Bearer <token>
Body: { "archive_job_id": "4e880b53-26cb-458f-813f-154e318ac322", "restaurant_id": 52 }
Response: { "delete_job_id": "...", "status": "DELETED" }
8) UI Design Recommendations
Use a split layout: left pane for selection (date/orders), right pane for job status/logs.
Provide clear, bold warning for deletion; require explicit confirmation text.
Show manifest summary cards: total rows per table, checksum, exported_at, timezone.
Archive Viewer table with sticky headers, pagination, and CSV export button.
Use clear “states” chips (PENDING/EXPORTING/EXPORTED/FAILED/DELETED).
Keep the JWT in memory or secure storage; refresh if needed per main backend policy.
9) Edge Cases / Notes
If date range returns > MAX_ORDERS_PER_JOB, backend returns an error; handle and ask user to narrow filters.
Timezone: server now applies restaurant timezone to date ranges; display the timezone in the UI (from manifest.restaurant_timezone).
S3 is the source of truth for files; /tmp is ephemeral. Viewer should use the query endpoint rather than assuming local disk.