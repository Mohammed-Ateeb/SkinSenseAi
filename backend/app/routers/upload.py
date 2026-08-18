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

@router.post("/request-url", response_model=UploadResponse)
async def request_upload_url(
    body: UploadRequest,
    user: CurrentUser = Depends(get_current_user),
):
    supabase = get_supabase()
    file_ext = body.filename.rsplit(".", 1)[-1] if "." in body.filename else "jpg"
    storage_path = f"{user.id}/{uuid.uuid4()}/{body.filename}"

    result = supabase.table("uploaded_images").insert({
        "user_id": user.id,
        "storage_path": storage_path,
    }).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create image record")

    image_id = result.data[0]["id"]

    signed = supabase.storage.from_("skin-images").create_signed_upload_url(storage_path)

    return UploadResponse(
        image_id=image_id,
        upload_url=signed["signedURL"],
        storage_path=storage_path,
    )
