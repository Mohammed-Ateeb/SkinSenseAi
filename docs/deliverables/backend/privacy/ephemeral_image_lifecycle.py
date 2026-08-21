"""
Privacy-preserving ephemeral image lifecycle management.

After feature extraction completes successfully, immediately deletes the uploaded
image from Supabase storage, retaining only privacy-preserving embeddings and
anonymized metadata.
"""

from datetime import datetime, timezone
from typing import Optional
from dataclasses import dataclass
import logging

from postgrest.exceptions import APIError
from supabase import create_client
from supabase.lib.client_options import ClientOptions

logger = logging.getLogger(__name__)


@dataclass
class ImageDeletionResult:
    """Result of attempting to delete an image."""
    success: bool
    image_id: str
    storage_path: str
    deleted_at: Optional[datetime] = None
    error: Optional[str] = None


class EphemeralImageLifecycle:
    """Manages secure deletion of images after extraction succeeds."""

    def __init__(
        self,
        supabase_url: str,
        supabase_service_key: str,
        storage_bucket: str = "skin-images",
        images_table: str = "uploaded_images",
    ):
        """
        Initialize the ephemeral image lifecycle manager.

        Args:
            supabase_url: Supabase project URL
            supabase_service_key: Supabase service role key (has admin privileges)
            storage_bucket: Name of the storage bucket (default: 'skin-images')
            images_table: Name of the images table (default: 'uploaded_images')

        Note:
            Uses the service role key to bypass RLS policies. This is intentional:
            deletion must succeed regardless of row-level security policies, which
            typically prevent direct record deletion. The service role ensures
            deletion happens even if the user's normal session would be blocked.
        """
        self.storage_bucket = storage_bucket
        self.images_table = images_table

        # Initialize with service role for deletion privileges
        options = ClientOptions(postgrest_client_timeout=10)
        self.supabase = create_client(supabase_url, supabase_service_key, options)

    def delete_image_after_extraction(
        self,
        image_id: str,
        storage_path: str,
        user_id: str,
    ) -> ImageDeletionResult:
        """
        Delete an image from storage after extraction succeeds.

        This function is designed to be called ONLY after feature extraction
        completes successfully. It deletes the image from storage and marks
        the record with deleted_at timestamp.

        Args:
            image_id: ID of the record in uploaded_images table
            storage_path: Path to the image in storage (e.g. 'user-uuid/file-id.jpg')
            user_id: User ID (used for verification and logging)

        Returns:
            ImageDeletionResult with success status, timestamps, and errors

        Raises:
            ValueError: If inputs are missing or invalid
        """
        if not all([image_id, storage_path, user_id]):
            raise ValueError(
                "image_id, storage_path, and user_id are required"
            )

        logger.info(
            f"Deleting image after extraction: image_id={image_id}, "
            f"storage_path={storage_path}, user_id={user_id}"
        )

        # Step 1: Delete from storage
        storage_error = self._delete_from_storage(storage_path)
        if storage_error:
            logger.error(
                f"Storage deletion failed for {storage_path}: {storage_error}"
            )
            return ImageDeletionResult(
                success=False,
                image_id=image_id,
                storage_path=storage_path,
                error=f"Storage deletion failed: {storage_error}",
            )

        # Step 2: Mark record with deleted_at timestamp
        deleted_at = datetime.now(timezone.utc)
        db_error = self._mark_as_deleted(image_id, user_id, deleted_at)
        if db_error:
            logger.error(
                f"Database update failed for image_id {image_id}: {db_error}"
            )
            return ImageDeletionResult(
                success=False,
                image_id=image_id,
                storage_path=storage_path,
                deleted_at=deleted_at,
                error=f"Database update failed: {db_error}",
            )

        logger.info(
            f"Image deletion complete: image_id={image_id}, deleted_at={deleted_at}"
        )
        return ImageDeletionResult(
            success=True,
            image_id=image_id,
            storage_path=storage_path,
            deleted_at=deleted_at,
        )

    def _delete_from_storage(self, storage_path: str) -> Optional[str]:
        """
        Delete the image from Supabase storage.

        Args:
            storage_path: Path to the image in storage

        Returns:
            Error message if deletion failed, None on success
        """
        try:
            self.supabase.storage.from_(self.storage_bucket).remove([storage_path])
            logger.debug(f"Storage deletion successful: {storage_path}")
            return None
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Storage deletion error for {storage_path}: {error_msg}")
            return error_msg

    def _mark_as_deleted(
        self,
        image_id: str,
        user_id: str,
        deleted_at: datetime,
    ) -> Optional[str]:
        """
        Update the database record to mark image as deleted.

        Args:
            image_id: ID of the record in uploaded_images table
            user_id: User ID (used for safety verification)
            deleted_at: Timestamp to record

        Returns:
            Error message if update failed, None on success
        """
        try:
            # Update with user_id check for safety (prevents accidental
            # deletion of someone else's record even with service role)
            response = (
                self.supabase.table(self.images_table)
                .update({"deleted_at": deleted_at.isoformat()})
                .eq("id", image_id)
                .eq("user_id", user_id)
                .execute()
            )

            if not response.data:
                error = (
                    f"No record updated for image_id={image_id}; "
                    f"verify image exists and belongs to user_id={user_id}"
                )
                logger.warning(error)
                return error

            logger.debug(f"Database update successful: image_id={image_id}")
            return None
        except APIError as e:
            error_msg = f"APIError: {e.message}"
            logger.error(f"Database update error for image_id {image_id}: {error_msg}")
            return error_msg
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Unexpected error updating image_id {image_id}: {error_msg}")
            return error_msg

    def is_image_deleted(self, image_id: str, user_id: str) -> bool:
        """
        Check if an image has been marked as deleted.

        Args:
            image_id: ID of the record in uploaded_images table
            user_id: User ID

        Returns:
            True if deleted_at is set, False otherwise
        """
        try:
            response = (
                self.supabase.table(self.images_table)
                .select("deleted_at")
                .eq("id", image_id)
                .eq("user_id", user_id)
                .execute()
            )
            if response.data and len(response.data) > 0:
                return response.data[0].get("deleted_at") is not None
            return False
        except Exception as e:
            logger.error(f"Error checking deletion status for {image_id}: {e}")
            return False
