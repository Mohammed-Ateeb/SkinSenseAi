from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.auth import get_current_user, CurrentUser
from app.services.supabase_client import get_supabase

router = APIRouter(prefix="/history", tags=["history"])

@router.get("")
async def list_history(user: CurrentUser = Depends(get_current_user)):
    supabase = get_supabase()
    result = supabase.table("analysis_results").select(
        "id, primary_condition, predictions, created_at, confidence_score"
    ).eq("user_id", user.id).order("created_at", desc=True).limit(20).execute()
    return result.data or []

@router.get("/{analysis_id}")
async def get_analysis(analysis_id: str, user: CurrentUser = Depends(get_current_user)):
    supabase = get_supabase()
    result = supabase.table("analysis_results").select("*").eq("id", analysis_id).eq("user_id", user.id).maybe_single().execute()
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Analysis not found")

    analysis = result.data
    try:
        snapshot_result = supabase.table("skin_twin_snapshots").select("*").eq(
            "analysis_result_id", analysis_id
        ).maybe_single().execute()
        snapshot = snapshot_result.data if snapshot_result else None
    except Exception:
        snapshot = None

    return {**analysis, "twin_snapshot": snapshot}
