# Backend Requirements: Selective Order Deletion

## ⚠️ CRITICAL: Manifest Schema Update Needed

**Before frontend can use this approach, the manifest MUST include `delete_order_ids`:**

### Current Manifest Response (Missing Field):
```json
{
  "job_id": "abc-123",
  "criteria": {
    "order_ids": [1001, 1002, 1003]  // Orders requested
  },
  "row_counts": { "orders": 4 }
  // ❌ Missing: delete_order_ids
}
```

### Required Manifest Response:
```json
{
  "job_id": "abc-123",
  "criteria": {
    "order_ids": [1001, 1002, 1003]
  },
  "delete_order_ids": [1001, 1002],  // ✅ NEW: Orders marked for deletion
  "row_counts": { "orders": 4 }
}
```

**Update `second_backend_api.json` line ~306 to add:**
```json
"delete_order_ids": "array[integer] or null - Orders marked for deletion from main DB. null = delete all."
```

---

## Goal
Support **both** approaches for specifying which orders to delete:
1. **Stored in manifest** (NirajAdh's approach - more robust)
2. **Explicit in request** (Your approach - more flexible)

---

## Changes Needed

### 1. Archive Endpoint: Store `delete_order_ids`

**Endpoint:** `POST /jobs/archive`

**When `order_ids` is provided in archive request:**
```python
# Request
{
  "restaurant_id": 52,
  "order_ids": [1001, 1002, 1003]  # User selected these
}

# What to do:
# 1. Determine which day(s) these orders belong to
# 2. For each day, create archive of ALL orders
# 3. In manifest.json, store:
manifest = {
  "criteria": {
    "order_ids": [1001, 1002, 1003],  # All orders requested
    "archive_day": "2026-01-13"
  },
  "delete_order_ids": [1001, 1002, 1003],  # NEW: Which to delete
  ...
}
```

**When `start_date`/`end_date` is provided:**
```python
# Request
{
  "restaurant_id": 52,
  "start_date": "2026-01-13T00:00:00Z",
  "end_date": "2026-01-13T23:59:59Z"
}

# In manifest.json:
manifest = {
  "criteria": {
    "start_date": "2026-01-13T00:00:00Z",
    "end_date": "2026-01-13T23:59:59Z"
  },
  "delete_order_ids": null,  # Delete ALL archived orders
  ...
}
```

---

### 2. Delete Endpoint: Support Both Approaches

**Endpoint:** `POST /jobs/delete`

**Request Schema (updated):**
```python
class DeleteJobRequest(BaseModel):
    archive_job_id: str
    restaurant_id: int
    order_ids: Optional[List[int]] = None  # NEW: Optional override
    user: Optional[str] = None
```

**Logic:**
```python
def handle_delete_request(request: DeleteJobRequest):
    # 1. Load manifest
    manifest = load_manifest(request.archive_job_id)
    
    # 2. Determine which orders to delete (PRIORITY ORDER)
    if request.order_ids:
        # Use explicit order_ids from request (highest priority)
        orders_to_delete = request.order_ids
        print(f"Using explicit order_ids from request: {orders_to_delete}")
    
    elif manifest.get("delete_order_ids"):
        # Use delete_order_ids from manifest (NirajAdh's approach)
        orders_to_delete = manifest["delete_order_ids"]
        print(f"Using delete_order_ids from manifest: {orders_to_delete}")
    
    else:
        # Delete ALL archived orders (fallback)
        orders_to_delete = manifest["criteria"].get("order_ids", None)
        if not orders_to_delete:
            # Get all order IDs from manifest's row_counts or parquet files
            orders_to_delete = get_all_archived_order_ids(request.archive_job_id)
        print(f"Deleting ALL archived orders: {len(orders_to_delete)} orders")
    
    # 3. Validate order_ids exist in archive
    archived_order_ids = get_all_archived_order_ids(request.archive_job_id)
    invalid_ids = set(orders_to_delete) - set(archived_order_ids)
    if invalid_ids:
        raise ValueError(f"Orders not in archive: {invalid_ids}")
    
    # 4. Call delete stored procedure
    delete_orders_batch(
        restaurant_id=request.restaurant_id,
        order_ids=orders_to_delete
    )
    
    # 5. Create deletion receipt
    create_deletion_receipt(
        archive_job_id=request.archive_job_id,
        deleted_order_ids=orders_to_delete,
        total_deleted=len(orders_to_delete)
    )
    
    return {
        "delete_job_id": generate_uuid(),
        "status": "DELETED",
        "deleted_count": len(orders_to_delete)
    }
```

---

### 3. Append Mode: Merge `delete_order_ids`

**When appending:**
```python
# Request
{
  "restaurant_id": 52,
  "order_ids": [1004, 1005],  # New orders
  "append": true
}

# What to do:
# 1. Load existing manifest
existing_manifest = load_manifest(job_id)

# 2. Merge delete_order_ids
existing_delete_ids = existing_manifest.get("delete_order_ids", []) or []
new_delete_ids = request.order_ids

updated_manifest = {
  ...existing_manifest,
  "delete_order_ids": existing_delete_ids + new_delete_ids,  # Merge
  "updated_at": now()
}
```

---

### 4. Response: Return `delete_order_ids` in Manifest

**Endpoint:** `GET /archive/{job_id}/manifest`

**Response:**
```json
{
  "job_id": "abc-123",
  "criteria": {
    "order_ids": [1001, 1002, 1003, 1004],
    "archive_day": "2026-01-13"
  },
  "delete_order_ids": [1001, 1002],  // NEW: Which orders marked for deletion
  "row_counts": { "orders": 4 },
  ...
}
```

---

## API Spec Updates Needed

Update `second_backend_api.json`:

1. **Add to manifest response (line ~290):**
```json
"delete_order_ids": "array[integer] or null - Orders marked for deletion. If null, all orders will be deleted."
```

2. **Add to delete request body (after line 182):**
```json
{
  "name": "order_ids",
  "type": "array[integer]",
  "required": false,
  "description": "Optional: Specific orders to delete. Overrides manifest's delete_order_ids."
}
```

---

## Summary

| Scenario | Archive Request | Manifest `delete_order_ids` | Delete Behavior |
|----------|----------------|----------------------------|-----------------|
| **Select specific orders** | `order_ids: [1,2,3]` | `[1,2,3]` | Delete only 1,2,3 |
| **Archive full day** | `start_date`, `end_date` | `null` | Delete all |
| **Append selected** | `order_ids: [4,5]`, `append: true` | `[1,2,3,4,5]` | Delete 1,2,3,4,5 |
| **Override at delete** | Any | Any | Use `order_ids` from delete request |

This gives you **maximum flexibility** while maintaining **backward compatibility**.
