"""
Example: Integrating ephemeral image lifecycle into the /analyze endpoint.

Shows how to wire image deletion into your feature extraction pipeline.
"""

from typing import Optional
import logging
from datetime import datetime

from ephemeral_image_lifecycle import EphemeralImageLifecycle, ImageDeletionResult

logger = logging.getLogger(__name__)


def analyze_and_cleanup(
    image_id: str,
    storage_path: str,
    user_id: str,
    supabase_url: str,
    supabase_service_key: str,
    feature_extraction_fn,
) -> dict:
    """
    Analyze an image and securely delete it after extraction.

    This wrapper handles the full lifecycle: extraction → deletion.

    Args:
        image_id: ID from uploaded_images table
        storage_path: Path in skin-images bucket
        user_id: User ID
        supabase_url: Supabase URL
        supabase_service_key: Service role key
        feature_extraction_fn: Async function that extracts embeddings
                             Should accept (image_id, storage_path) and return
                             dict with 'embeddings', 'analysis', etc.

    Returns:
        dict with 'embeddings' and 'analysis' only (image deleted)

    Example:
        result = await analyze_and_cleanup(
            image_id="abc123",
            storage_path="user-id/file-id.jpg",
            user_id="user-id",
            supabase_url="https://xyz.supabase.co",
            supabase_service_key="sk-...",
            feature_extraction_fn=extract_features,
        )
        # Image is now deleted from storage, only embeddings remain
    """

    # Step 1: Extract features (embeddings, analysis results)
    logger.info(f"Starting analysis for image_id={image_id}")
    extraction_result = feature_extraction_fn(image_id, storage_path)
    if not extraction_result or extraction_result.get("error"):
        logger.error(
            f"Feature extraction failed for {image_id}: "
            f"{extraction_result.get('error') if extraction_result else 'None'}"
        )
        return {
            "success": False,
            "error": "Feature extraction failed",
            "image_id": image_id,
        }

    # Step 2: Delete image only after successful extraction
    logger.info(f"Extraction successful, now deleting image: {image_id}")
    lifecycle = EphemeralImageLifecycle(supabase_url, supabase_service_key)
    deletion_result = lifecycle.delete_image_after_extraction(
        image_id=image_id,
        storage_path=storage_path,
        user_id=user_id,
    )

    if not deletion_result.success:
        logger.warning(
            f"Image deletion failed: {deletion_result.error}. "
            f"Image remains in storage but is marked for cleanup."
        )
        return {
            "success": False,
            "error": deletion_result.error,
            "image_id": image_id,
        }

    # Step 3: Return only embeddings + anonymized metadata (NO image data)
    return {
        "success": True,
        "image_id": image_id,
        "deleted_at": deletion_result.deleted_at.isoformat()
        if deletion_result.deleted_at
        else None,
        "embeddings": extraction_result.get("embeddings"),
        "analysis": extraction_result.get("analysis"),
        "metadata": extraction_result.get("metadata"),
    }


# ============================================================================
# Integration point for FastAPI /analyze endpoint
# ============================================================================

async def analyze_endpoint_wrapper(
    image_id: str,
    user_id: str,
    current_user,  # From Depends(get_current_user)
    supabase_client,
    supabase_service_key: str,
):
    """
    Hook point: call this from your existing /analyze endpoint.

    Before:
        @router.post("/analyze")
        async def analyze(payload: AnalyzeRequest, user: CurrentUser = Depends(...)):
            # Fetch image info from database
            result = extract_features(payload.image_id)
            return result

    After:
        @router.post("/analyze")
        async def analyze(payload: AnalyzeRequest, user: CurrentUser = Depends(...)):
            # Fetch image info from database
            image_record = supabase.table("uploaded_images") \
                .select("*") \
                .eq("id", payload.image_id) \
                .eq("user_id", user.id) \
                .single() \
                .execute()

            result = await analyze_and_cleanup(
                image_id=payload.image_id,
                storage_path=image_record.data["storage_path"],
                user_id=user.id,
                supabase_url=os.environ["SUPABASE_URL"],
                supabase_service_key=os.environ["SUPABASE_SERVICE_KEY"],
                feature_extraction_fn=extract_features_async,
            )
            return result
    """
    if user_id != current_user.id:
        raise PermissionError("User mismatch: cannot analyze another user's image")

    # Fetch the image record
    try:
        image_record = (
            supabase_client.table("uploaded_images")
            .select("*")
            .eq("id", image_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
    except Exception as e:
        logger.error(f"Failed to fetch image record: {e}")
        return {"success": False, "error": "Image not found"}

    storage_path = image_record.data.get("storage_path")
    if not storage_path:
        return {"success": False, "error": "Image has no storage path"}

    # Perform analysis with automatic cleanup
    result = analyze_and_cleanup(
        image_id=image_id,
        storage_path=storage_path,
        user_id=user_id,
        supabase_url=current_user.supabase_url,  # Or from environment
        supabase_service_key=supabase_service_key,
        feature_extraction_fn=extract_features_async,
    )

    return result


async def extract_features_async(image_id: str, storage_path: str) -> dict:
    """
    Placeholder: your actual feature extraction logic.

    Should return dict with:
        {
            "embeddings": [...],           # Keep this (privacy-preserving)
            "analysis": {...},             # Keep this (anonymized results)
            "metadata": {...},             # Keep this (anonymized metadata)
            "error": None,                 # Or error message if failed
        }
    """
    pass
