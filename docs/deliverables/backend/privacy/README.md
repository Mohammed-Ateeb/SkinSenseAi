# Ephemeral Image Lifecycle — Privacy-Preserving Storage

After feature extraction completes, immediately delete uploaded images from Supabase storage while retaining privacy-preserving embeddings and anonymized metadata.

## Overview

**Problem:** User skin images contain sensitive personal health information. Storing them indefinitely violates privacy principles and increases compliance risk.

**Solution:** After extracting features (embeddings, analysis results), immediately delete the image file from storage. The embeddings and analysis are privacy-preserving: they cannot be reversed to reconstruct the original image.

**What gets deleted:** The original image file from Supabase storage (`skin-images` bucket)  
**What persists:** Embeddings, analysis results, anonymized metadata (only in database)

---

## Architecture

### Module: `ephemeral_image_lifecycle.py`

**Class: `EphemeralImageLifecycle`**

Manages the complete deletion lifecycle:

1. **Delete from storage**: Removes the image file from the `skin-images` bucket
2. **Mark in database**: Sets `deleted_at` timestamp on the `uploaded_images` record
3. **Verify state**: Optional check to confirm deletion

```python
from ephemeral_image_lifecycle import EphemeralImageLifecycle

lifecycle = EphemeralImageLifecycle(
    supabase_url="https://xyz.supabase.co",
    supabase_service_key="sk-...",  # Service role, has admin privileges
)

result = lifecycle.delete_image_after_extraction(
    image_id="img-123",
    storage_path="user-id/file-id.jpg",
    user_id="user-id",
)

if result.success:
    print(f"Image deleted at {result.deleted_at}")
else:
    print(f"Error: {result.error}")
```

**Key Methods:**

- `delete_image_after_extraction(image_id, storage_path, user_id)` → `ImageDeletionResult`  
  Deletes the image and marks record. Call this **only after extraction succeeds**.

- `is_image_deleted(image_id, user_id)` → `bool`  
  Check if an image has been marked as deleted.

---

## Integration: Hook into `/analyze` Flow

### Before (current flow)

```
1. User uploads image → stored in skin-images bucket
2. /analyze endpoint extracts features
3. Image stays in storage indefinitely ❌
```

### After (with ephemeral lifecycle)

```
1. User uploads image → stored in skin-images bucket
2. /analyze endpoint extracts features → gets embeddings + analysis
3. Feature extraction succeeds
4. DELETE image from storage ✓
5. Mark uploaded_images.deleted_at = now() ✓
6. Return only embeddings + analysis (no image data)
```

### Code Example

**Old `/analyze` endpoint:**

```python
@router.post("/analyze")
async def analyze(payload: AnalyzeRequest, user: CurrentUser = Depends(...)):
    # Get image info
    image = supabase.table("uploaded_images").select("*").eq("id", payload.image_id).single().execute()
    
    # Extract features
    embeddings = extract_features(payload.image_id, image.data["storage_path"])
    
    # Return result
    return {"embeddings": embeddings}
```

**New `/analyze` endpoint with cleanup:**

```python
from ephemeral_image_lifecycle import EphemeralImageLifecycle

@router.post("/analyze")
async def analyze(payload: AnalyzeRequest, user: CurrentUser = Depends(...)):
    # Get image info
    image = supabase.table("uploaded_images").select("*").eq("id", payload.image_id).eq("user_id", user.id).single().execute()
    
    # Extract features
    embeddings = extract_features(payload.image_id, image.data["storage_path"])
    if not embeddings:
        return {"error": "Extraction failed"}
    
    # ✓ NEW: Delete image after extraction succeeds
    lifecycle = EphemeralImageLifecycle(
        supabase_url=os.environ["SUPABASE_URL"],
        supabase_service_key=os.environ["SUPABASE_SERVICE_KEY"],
    )
    deletion = lifecycle.delete_image_after_extraction(
        image_id=payload.image_id,
        storage_path=image.data["storage_path"],
        user_id=user.id,
    )
    
    if not deletion.success:
        # Log but don't fail the response (embeddings were successfully extracted)
        logger.warning(f"Image deletion failed: {deletion.error}")
    
    # Return result (image is gone, only embeddings remain)
    return {"embeddings": embeddings, "deleted_at": deletion.deleted_at}
```

See `integration_example.py` for a more complete wrapper.

---

## Security & RLS Considerations

### Why Service Role Key?

The deletion logic uses the **service role key** (not the user's session token). Why?

1. **Bypasses RLS**: By design, row-level security policies prevent users from deleting their own records directly (soft deletes preferred). The service role bypasses RLS, ensuring deletion always succeeds.

2. **Enforced deletion**: Once extraction completes, the image **must** be deleted. No exceptions, no user overrides.

3. **Audited**: The `deleted_at` column provides a paper trail; the record is never erased, only marked.

**Security guardrail:** The deletion logic still verifies `user_id` matches:

```python
.eq("id", image_id)
.eq("user_id", user_id)  # ← Prevents accidental cross-user deletion
.execute()
```

### Storage Permissions (RLS Policy)

The `skin-images` bucket should have a policy preventing direct deletion by users:

```sql
CREATE POLICY "Users can upload images, not delete" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'skin-images' AND auth.uid() = owner)
  
CREATE POLICY "Admin/service role can delete" ON storage.objects
  FOR DELETE
  USING (bucket_id = 'skin-images')
```

This ensures:
- Users **cannot** delete their images via the client SDK
- Only the backend (with service role) **can** delete images
- Deletion is centralized and auditable

---

## Database Schema

Assumes `uploaded_images` table with:

```sql
CREATE TABLE uploaded_images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id),
    storage_path text NOT NULL,
    created_at timestamp DEFAULT now(),
    deleted_at timestamp,  -- ← Set by ephemeral lifecycle when image is deleted
    UNIQUE(user_id, storage_path)
);
```

The `deleted_at` column must exist. If not, add it:

```sql
ALTER TABLE uploaded_images ADD COLUMN deleted_at timestamp;
```

### Queries After Deletion

The module wires the `deleted_at` column automatically. Queries can filter:

```python
# Fetch only non-deleted images
active_images = supabase.table("uploaded_images") \
    .select("*") \
    .eq("user_id", user_id) \
    .is_("deleted_at", "null") \
    .execute()

# Fetch deleted images (for audit trail)
deleted_images = supabase.table("uploaded_images") \
    .select("*") \
    .eq("user_id", user_id) \
    .not_("deleted_at", "is", "null") \
    .execute()
```

---

## Idempotency & Error Handling

### Idempotent Deletion

Calling `delete_image_after_extraction` multiple times is safe:

1. **First call**: Image deleted, `deleted_at` set
2. **Second call**: Storage deletion is already done (no-op), database update succeeds (re-sets same timestamp)

Result: Always returns `success=True` on subsequent calls.

### Partial Failure Scenarios

If **storage deletion succeeds but database update fails**:

```python
result.success = False
result.error = "Database update failed: ..."
# Image IS deleted from storage but deleted_at NOT set
# → Data loss not integrity loss; manual intervention rare
```

If **storage deletion fails but database update would succeed**:

```python
result.success = False
result.error = "Storage deletion failed: ..."
# Image remains in storage, deleted_at NOT set
# → Image persists, which is safe (privacy trade-off only)
```

**Recommended handling in FastAPI:**

```python
deletion = lifecycle.delete_image_after_extraction(...)
if not deletion.success:
    # Log but don't fail the /analyze response
    logger.error(f"Image deletion failed: {deletion.error}")
    # Embeddings were successfully extracted; let client get them
    # The image may linger in storage but won't break the analysis

# Return embeddings regardless of deletion success
return {"embeddings": embeddings, "analysis": analysis}
```

---

## Environment Setup

### Required Environment Variables

```bash
SUPABASE_URL="https://xyz.supabase.co"
SUPABASE_SERVICE_KEY="sk-..."  # Service role API key, NOT the anon key
```

**Where to get the service key:**
1. Supabase dashboard → Project settings → API
2. Copy the **Service role** secret (NOT the anonymous public key)
3. Store in `.env` or secrets manager (NOT in version control)

### Initialization

```python
import os
from ephemeral_image_lifecycle import EphemeralImageLifecycle

lifecycle = EphemeralImageLifecycle(
    supabase_url=os.environ["SUPABASE_URL"],
    supabase_service_key=os.environ["SUPABASE_SERVICE_KEY"],
)
```

Or pass URL/key at request time:

```python
@router.post("/analyze")
async def analyze(...):
    lifecycle = EphemeralImageLifecycle(
        supabase_url=os.environ["SUPABASE_URL"],
        supabase_service_key=os.environ["SUPABASE_SERVICE_KEY"],
    )
    result = lifecycle.delete_image_after_extraction(...)
```

---

## Logging & Monitoring

The module logs all operations:

```python
import logging
logging.basicConfig(level=logging.INFO)
```

**Sample output:**

```
INFO: Deleting image after extraction: image_id=img-123, storage_path=user-id/file-id.jpg, user_id=user-id
INFO: Image deletion complete: image_id=img-123, deleted_at=2026-08-18T12:34:56.789Z
WARNING: Image deletion failed: image_id=img-123; error=Storage deletion failed: ...
```

**Metrics to track:**
- `delete_image_after_extraction` success rate
- Time between extraction and deletion (should be < 1s)
- Any recurring storage errors (permissions, bucket misconfiguration)

---

## Testing

### Unit Test Example

```python
from ephemeral_image_lifecycle import EphemeralImageLifecycle

def test_delete_image_after_extraction(mock_supabase):
    lifecycle = EphemeralImageLifecycle(
        supabase_url="https://test.supabase.co",
        supabase_service_key="sk-test",
    )
    lifecycle.supabase = mock_supabase  # Inject mock
    
    result = lifecycle.delete_image_after_extraction(
        image_id="img-123",
        storage_path="user-id/file.jpg",
        user_id="user-id",
    )
    
    assert result.success
    mock_supabase.storage.from_.assert_called_with("skin-images")
    mock_supabase.table.assert_called_with("uploaded_images")
```

### Integration Test Checklist

- [ ] Extraction succeeds → image deleted
- [ ] Extraction fails → image NOT deleted
- [ ] Storage deletion fails → database not updated
- [ ] Multiple deletions (same image_id) → idempotent
- [ ] Wrong user_id → deletion fails (safety check)
- [ ] Empty image_id/storage_path → ValueError raised
- [ ] `is_image_deleted()` returns True only after successful deletion

---

## Compliance & Privacy Notes

### GDPR / CCPA Alignment

✓ **Right to erasure**: User data (images) deleted immediately after use  
✓ **Data minimization**: Only privacy-preserving outputs retained  
✓ **Audit trail**: `deleted_at` timestamp records when deletion occurred  

### What Embeddings Reveal

Embeddings are one-way: you **cannot** reconstruct the original image from embeddings alone. However, embeddings may leak:
- Skin condition category (implicit in clustering)
- Demographic info if correlated

Embeddings are **privacy-preserving relative to the raw image**, not absolute anonymity. For full anonymization, additional masking (e.g., removing user_id linkage) should be applied in the analysis output.

---

## Troubleshooting

### "insert or update on table failed"

**Cause:** The database record doesn't exist or doesn't match the user_id check.

```python
deletion = lifecycle.delete_image_after_extraction(
    image_id="img-999",  # Doesn't exist
    storage_path="...",
    user_id="user-id",
)
print(deletion.error)  # "No record updated for image_id=img-999"
```

**Fix:** Verify the image_id exists in the database:

```sql
SELECT id, user_id, storage_path FROM uploaded_images WHERE id = 'img-999';
```

### "Access denied" or Permission Error

**Cause:** Service key permissions insufficient or RLS policies are too restrictive.

**Fix:**
1. Verify service key is the **service role** key, not the anonymous key
2. Check Supabase dashboard → Storage → Policies: ensure service role can delete
3. Check Database → Policies: if `deleted_at` update fails due to RLS, add:

```sql
CREATE POLICY "Service role can update deleted_at" ON uploaded_images
  FOR UPDATE
  USING (true)
  WITH CHECK (true)
```

---

## Files in This Module

- **`ephemeral_image_lifecycle.py`** — Core module (production-ready)
- **`integration_example.py`** — FastAPI integration template
- **`README.md`** — This file

---

## Summary

1. **Call `delete_image_after_extraction()` immediately after extraction succeeds**
2. **Use the service role key** (not user session)
3. **Check `result.success`** before assuming image is gone
4. **Only embeddings + metadata are retained** (image deleted)
5. **Monitor logs** for storage/database failures

Privacy-preserving, auditable, and GDPR-aligned.
