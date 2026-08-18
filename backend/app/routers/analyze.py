import os
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.auth import get_current_user, CurrentUser
from app.services.supabase_client import get_supabase
from app.services import groq_service
from app.ml.inference import InferenceEngine
from app.rag.retriever import RagRetriever
from app.guardrail.guardrail import validate
from app.twin.twin import (
    update_twin,
    PredictResult as TwinPredictResult,
    ConditionScore as TwinConditionScore,
)
from app.privacy.ephemeral_image_lifecycle import EphemeralImageLifecycle

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analyze", tags=["analyze"])

class AnalyzeRequest(BaseModel):
    image_id: str
    fitzpatrick_skin_tone: int | None = None
    additional_context: str = ""

class DifferentialDiagnosis(BaseModel):
    condition: str
    confidence: float

class AnalyzeResponse(BaseModel):
    analysis_id: str
    primary_condition: str
    confidence_score: float
    differential_diagnoses: list[DifferentialDiagnosis]
    llm_explanation: str
    recommended_products: list[dict]
    twin_state: dict
    guardrail_flags: list[dict]
    low_confidence: bool

@router.post("", response_model=AnalyzeResponse)
async def analyze(body: AnalyzeRequest, user: CurrentUser = Depends(get_current_user)):
    supabase = get_supabase()

    # 1. Verify image ownership
    img_result = supabase.table("uploaded_images").select("*").eq("id", body.image_id).eq("user_id", user.id).single().execute()
    if not img_result.data:
        raise HTTPException(status_code=404, detail="Image not found")

    image_record = img_result.data
    storage_path = image_record["storage_path"]

    # 2. Download image bytes
    try:
        image_bytes = supabase.storage.from_("skin-images").download(storage_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to download image: {e}")

    # 3. ML inference
    engine = InferenceEngine.from_env()
    predict_result = engine.predict(image_bytes)

    # 4. RAG retrieval (synchronous — no await)
    retriever = RagRetriever(supabase)
    rag_context = retriever.retrieve(predict_result.primary_condition, body.additional_context)

    # 5. Groq LLM generation
    llm_response = groq_service.generate_analysis(predict_result, rag_context, body.additional_context)

    # 6. Post-generation guardrail
    # validate() uses keyword-only arg product_names (after *)
    validation_result = validate(
        llm_response,
        product_names=rag_context.product_whitelist,
    )

    # 7. Save analysis_results
    predictions_jsonb = {
        "conditions": [
            {"condition": s.condition, "confidence": s.confidence}
            for s in predict_result.predictions
        ],
        "differential_diagnoses": [
            {"condition": d.condition, "confidence": d.confidence}
            for d in predict_result.differential_diagnoses
        ],
        "confidence_threshold_met": predict_result.confidence_threshold_met,
        "low_confidence_flag": predict_result.low_confidence_flag,
    }

    recommended_ids = [str(p.product_id) for p in rag_context.products[:3] if p.product_id]

    ar_result = supabase.table("analysis_results").insert({
        "image_id": body.image_id,
        "user_id": user.id,
        "model_version": "efficientnet-b0-v1",
        "predictions": predictions_jsonb,
        "primary_condition": predict_result.primary_condition,
        "confidence_score": predict_result.confidence_score,
        "llm_explanation": validation_result.cleaned_text,
        "recommended_product_ids": recommended_ids,
    }).execute()

    if not ar_result.data:
        raise HTTPException(status_code=500, detail="Failed to save analysis")

    analysis_id = ar_result.data[0]["id"]

    # 8. Update digital twin (non-fatal)
    # update_twin() takes its own PredictResult type which includes analysis_result_id
    twin_state_dict = {}
    try:
        twin_predict = TwinPredictResult(
            image_id=body.image_id,
            analysis_result_id=analysis_id,
            model_version="efficientnet-b0-v1",
            predictions=[
                TwinConditionScore(condition=s.condition, confidence=s.confidence)
                for s in predict_result.predictions
            ],
            primary_condition=predict_result.primary_condition,
            confidence_threshold_met=predict_result.confidence_threshold_met,
            low_confidence_flag=predict_result.low_confidence_flag,
        )
        twin_state = update_twin(
            db=supabase,
            user_id=user.id,
            predict_result=twin_predict,
            chat_feedback=None,
            fitzpatrick_skin_tone=body.fitzpatrick_skin_tone,
        )
        twin_state_dict = twin_state.__dict__ if twin_state else {}
        # Convert nested TwinDeltas dataclass to dict for JSON serialisation
        if "deltas" in twin_state_dict and hasattr(twin_state_dict["deltas"], "__dict__"):
            twin_state_dict["deltas"] = twin_state_dict["deltas"].__dict__
    except Exception as e:
        logger.warning(f"Twin update failed (non-fatal): {e}")

    # 9. Ephemeral image deletion (non-fatal)
    # EphemeralImageLifecycle takes URL and service key strings, not a supabase client
    try:
        lifecycle = EphemeralImageLifecycle(
            supabase_url=os.environ["SUPABASE_URL"],
            supabase_service_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        )
        lifecycle.delete_image_after_extraction(body.image_id, storage_path, user.id)
    except Exception as e:
        logger.warning(f"Image deletion failed (non-fatal): {e}")

    return AnalyzeResponse(
        analysis_id=analysis_id,
        primary_condition=predict_result.primary_condition,
        confidence_score=predict_result.confidence_score,
        differential_diagnoses=[
            DifferentialDiagnosis(condition=d.condition, confidence=d.confidence)
            for d in predict_result.differential_diagnoses
        ],
        llm_explanation=validation_result.cleaned_text,
        recommended_products=[
            {
                "product_id": str(p.product_id),
                "name": p.name,
                "active_ingredients": p.active_ingredients,
                "priority_score": p.priority_score,
                "similarity": p.similarity,
            }
            for p in rag_context.products
        ],
        twin_state=twin_state_dict,
        guardrail_flags=[f.__dict__ for f in validation_result.flagged_items],
        low_confidence=predict_result.low_confidence_flag,
    )
