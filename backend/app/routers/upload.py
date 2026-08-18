import os
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.auth import get_current_user, CurrentUser
from app.services.supabase_client import get_supabase

router = APIRouter(prefix="/upload", tags=["upload"])

class UploadRequest(BaseModel):
    filename: str
    content_type: str = "image/jpeg"

class UploadResponse(BaseModel):
    image_id: str
    upload_url: str
    storage_path: str
    token: str

@router.post("/request-url", response_model=UploadResponse)
async def request_upload_url(
    body: UploadRequest,
    user: CurrentUser = Depends(get_current_user),
):
    supabase = get_supabase()
    storage_path = f"{user.id}/{uuid.uuid4()}/{body.filename}"

    result = supabase.table("uploaded_images").insert({
        "user_id": user.id,
        "storage_path": storage_path,
    }).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create image record")

    image_id = result.data[0]["id"]

    try:
        signed = supabase.storage.from_("skin-images").create_signed_upload_url(storage_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create signed upload URL: {e}")

    # supabase-py returns snake_case keys ("signed_url", "token", "path").
    # Accept camelCase too in case of client-version differences.
    signed_url = signed.get("signed_url") or signed.get("signedURL") or signed.get("signedUrl")
    token = signed.get("token")
    if not signed_url or not token:
        raise HTTPException(status_code=500, detail=f"Malformed signed upload response: {list(signed.keys())}")

    return UploadResponse(
        image_id=image_id,
        upload_url=signed_url,
        storage_path=storage_path,
        token=token,
    )
