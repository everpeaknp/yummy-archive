# Frontend Implementation Guide: Archive & Delete Flow

## Overview

The archive/delete system allows users to:
1. **Archive** orders (creates full-day backup)
2. **Delete** specific orders from the main database (after archiving)

> **Key Concept**: Archive backs up the ENTIRE day, but delete only removes the specific orders selected by the user.

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/jobs/archive` | POST | Create archive job |
| `/jobs/archive/{job_id}` | GET | Get archive job status |
| `/jobs/delete` | POST | Delete archived orders from main DB |
| `/jobs/archive/{job_id}` | DELETE | Remove archive job record |

---

## Flow 1: Archive Specific Orders

### Request
```http
POST /jobs/archive
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "restaurant_id": 52,
  "order_ids": [1001, 1002, 1003],   // Orders to delete later
  "user": "admin@restaurant.com"     // Optional, uses token if not provided
}
```

### Response
```json
{
  "jobs": [
    {
      "archive_day": "2025-01-13",
      "job_id": "abc-123-uuid",
      "status": "PENDING",
      "created": true
    }
  ]
}
```

### What Happens
1. System determines which day(s) the orders belong to
2. For each day, creates an archive of **ALL orders** (full backup)
3. Stores `delete_order_ids = [1001, 1002, 1003]` (user's selection)
4. Export runs in background

---

## Flow 2: Archive by Date Range

### Request
```http
POST /jobs/archive
Authorization: Bearer {access_token}

{
  "restaurant_id": 52,
  "start_date": "2025-01-13T00:00:00",
  "end_date": "2025-01-13T23:59:59",
  "user": "admin@restaurant.com"
}
```

### Response
```json
{
  "jobs": [
    {
      "archive_day": "2025-01-13",
      "job_id": "xyz-456-uuid",
      "status": "PENDING",
      "created": true
    }
  ]
}
```

### What Happens
- Archives ALL orders in the date range
- `delete_order_ids = null` (will delete all archived orders)

---

## Flow 3: Check Archive Status

### Request
```http
GET /jobs/archive/{job_id}
Authorization: Bearer {access_token}
```

### Response
```json
{
  "job_id": "abc-123-uuid",
  "status": "EXPORTED",          // PENDING | EXPORTING | EXPORTED | FAILED
  "restaurant_id": 52,
  "created_at": "2025-01-13T10:30:00Z",
  "manifest_path": "archives/restaurant_52/jobs/job_abc-123/manifest.json"
}
```

### Status Values
| Status | Meaning | UI Action |
|--------|---------|-----------|
| `PENDING` | Job created, waiting | Show spinner |
| `EXPORTING` | Export in progress | Show progress |
| `EXPORTED` | Ready for deletion | Enable delete button |
| `FAILED` | Export failed | Show error, allow retry |

---

## Flow 4: Delete Archived Orders

### Request
```http
POST /jobs/delete
Authorization: Bearer {access_token}

{
  "archive_job_id": "abc-123-uuid",
  "restaurant_id": 52,
  "user": "admin@restaurant.com"
}
```

### Response
```json
{
  "delete_job_id": "del-789-uuid",
  "status": "DELETED"            // PENDING | DELETING | DELETED | FAILED
}
```

### What Gets Deleted
- **If `delete_order_ids` was set**: Only those specific orders
- **If `delete_order_ids` is null**: All archived orders

---

## Flow 5: Append New Orders

When new orders arrive after initial archive:

### Request
```http
POST /jobs/archive
Authorization: Bearer {access_token}

{
  "restaurant_id": 52,
  "order_ids": [1004, 1005],    // New orders to delete
  "append": true                 // Key flag!
}
```

### Response
```json
{
  "jobs": [
    {
      "archive_day": "2025-01-13",
      "job_id": "abc-123-uuid",   // Same job ID
      "status": "EXPORTING",
      "created": false,
      "appended": true,
      "new_orders": 4             // All new orders backed up
    }
  ]
}
```

### What Happens
1. Fetches ALL new orders for the day (full backup)
2. Adds specified `[1004, 1005]` to `delete_order_ids`
3. Result: Full backup, but only user-selected orders will be deleted

---

## Recommended UI Flow

```
┌─────────────────────────────────────────────────────────────┐
│  SELECT ORDERS TO DELETE                                    │
├─────────────────────────────────────────────────────────────┤
│  □ Order #1001  |  Jan 13  |  Rs. 500  |  Completed         │
│  ☑ Order #1002  |  Jan 13  |  Rs. 750  |  Completed         │
│  ☑ Order #1003  |  Jan 13  |  Rs. 300  |  Completed         │
│  □ Order #1004  |  Jan 13  |  Rs. 450  |  Completed         │
├─────────────────────────────────────────────────────────────┤
│  Selected: 2 orders                                         │
│  [Archive & Delete]                                         │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  ARCHIVING IN PROGRESS                                      │
├─────────────────────────────────────────────────────────────┤
│  Creating backup of 4 orders for Jan 13...                  │
│  [████████████░░░░░░░░] 60%                                 │
│                                                             │
│  Note: Full day backup is created for data safety.          │
│  Only your selected orders (2) will be deleted.             │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  CONFIRM DELETION                                           │
├─────────────────────────────────────────────────────────────┤
│  ✅ Backup complete!                                        │
│                                                             │
│  Ready to delete 2 orders:                                  │
│    • Order #1002 - Rs. 750                                  │
│    • Order #1003 - Rs. 300                                  │
│                                                             │
│  ⚠️ This action cannot be undone.                           │
│                                                             │
│  [Cancel]                    [Delete Orders]                │
└─────────────────────────────────────────────────────────────┘
```

---

## Error Handling

| Error Code | Message | UI Action |
|------------|---------|-----------|
| `400` | "Provide order_ids or start_date+end_date" | Show validation error |
| `400` | "Archive job not ready (not EXPORTED)" | Wait for export |
| `403` | "Restaurant mismatch" | Auth error, re-login |
| `404` | "Archive job not found" | Invalid job ID |
| `409` | "Archive job already deleted" | Already processed |
| `429` | "A deletion job is already in progress" | Wait and retry |
| `500` | "Manifest missing" | Export failed, retry |

---

## Polling Strategy

```typescript
async function waitForExport(jobId: string): Promise<void> {
  const maxAttempts = 30;
  const pollInterval = 2000; // 2 seconds
  
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(`/jobs/archive/${jobId}`);
    const data = await response.json();
    
    if (data.status === 'EXPORTED') {
      return; // Ready for deletion
    }
    if (data.status === 'FAILED') {
      throw new Error('Export failed');
    }
    
    await sleep(pollInterval);
  }
  
  throw new Error('Export timeout');
}
```

---

## Complete Frontend Flow

```typescript
async function archiveAndDelete(orderIds: number[], restaurantId: number) {
  // Step 1: Create archive
  const archiveRes = await fetch('/jobs/archive', {
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      restaurant_id: restaurantId,
      order_ids: orderIds
    })
  });
  
  const archiveData = await archiveRes.json();
  const jobId = archiveData.jobs[0].job_id;
  
  // Step 2: Wait for export
  await waitForExport(jobId);
  
  // Step 3: Confirm with user
  const confirmed = await showConfirmDialog(orderIds);
  if (!confirmed) return;
  
  // Step 4: Delete
  const deleteRes = await fetch('/jobs/delete', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      archive_job_id: jobId,
      restaurant_id: restaurantId
    })
  });
  
  const deleteData = await deleteRes.json();
  if (deleteData.status === 'DELETED') {
    showSuccess('Orders deleted successfully');
  }
}
```