# Frontend API Changes Guide (Jan 14, 2026)

## ⚠️ Breaking Change: Smart Append Strategy

The `POST /jobs/archive` endpoint now uses a **Smart Append** strategy instead of always creating new jobs.

---

## New Response Statuses

Update your status handling to include:

| Status | Meaning | Action |
|--------|---------|--------|
| `PENDING` | Fresh job created, export starting | Poll for completion |
| `APPENDING` | Adding new orders to existing archive | Poll for completion |
| `SYNCED` | Already up-to-date, no action needed | Show success immediately |
| `IN_PROGRESS` | Export task running | Poll for completion |
| `EXPORTING` | Data export in progress | Poll for completion |
| `EXPORTED` | Complete and ready | Fetch archived data |
| `FAILED` | Job failed | Show error |

---

## Response Structure Changes

### Before:
```json
{
  "jobs": [{
    "job_id": "uuid",
    "status": "PENDING",
    "created": true
  }]
}
```

### After:
```json
{
  "jobs": [{
    "archive_day": "2026-01-14",
    "job_id": "uuid",
    "status": "PENDING | APPENDING | SYNCED",
    "created": true,
    "appended": false,
    "message": "Full fresh backup triggered"
  }]
}
```

---

## Required Frontend Changes

### 1. Status Handling
```javascript
// Handle new statuses in your polling/display logic
const isComplete = ['EXPORTED', 'SYNCED'].includes(status);
const isLoading = ['PENDING', 'APPENDING', 'IN_PROGRESS', 'EXPORTING'].includes(status);
const isFailed = status === 'FAILED';
```

### 2. New `appended` Field
```javascript
// Check if this was an append vs fresh creation
if (job.appended) {
  showToast(`Appending new orders: ${job.message}`);
} else if (job.created) {
  showToast("Creating fresh backup...");
} else if (job.status === 'SYNCED') {
  showToast("Already synced!");
}
```

### 3. Fetch Archives After These Statuses
```javascript
// Only fetch archived orders when status is:
if (status === 'EXPORTED' || status === 'SYNCED') {
  await fetchArchivedOrders(jobId);
}
```

---

## Quick Fix Checklist

- [ ] Update status constants/enums to include: `APPENDING`, `SYNCED`, `IN_PROGRESS`
- [ ] Update archive fetch logic to trigger on `SYNCED` status (not just `EXPORTED`)
- [ ] Handle `message` field for user-friendly notifications
- [ ] Update any status polling to recognize new intermediate states
