"""
Drop-in FastAPI router replacing the mock /predict endpoint.

Matches the existing signature:
    POST /predict  { "image_id": "<uuid>" }

Wires into app/main.py exactly like the old fake router:
    from app.ml.router import router as ml_router
    app.include_router(ml_router)

Environment variables:
    USE_MOCK_MODEL  — "true" returns deterministic fake scores (default false).
                      Useful for CI and frontend dev without model weights.
    WEIGHTS_PATH    — path to the trained state-dict .pth file.
    TEMPERATURE     — calibration temperature (default 1.5).
    CONFIDENCE_THRESHOLD    — primary-confidence floor to set the flag (default 0.50).
    LOW_CONFIDENCE_THRESHOLD — below this -> low_confidence_flag=true (default 0.35).
"""

import os
import logging
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .inference import InferenceEngine, MODEL_VERSION, ConditionScore

logger = logging.getLogger(__name__)

router = APIRouter()

_USE_MOCK = os.getenv("USE_MOCK_MODEL", "false").lower() == "true"


# ── Request / Response schemas ───────────────────────────────────────────────

class PredictRequest(BaseModel):
    image_id: str


class ConditionScoreOut(BaseModel):
    condition: str
    confidence: float


class PredictResponse(BaseModel):
    image_id: str
    model_version: str
    primary_condition: str
    confidence_score: float
    predictions: list[ConditionScoreOut]
    differential_diagnoses: list[ConditionScoreOut]
    confidence_threshold_met: bool
    low_confidence_flag: bool


# ── Lazy singleton engine (real model only) ──────────────────────────────────

@lru_cache(maxsize=1)
def _get_engine() -> InferenceEngine:
    return InferenceEngine.from_env()


# ── Mock response ────────────────────────────────────────────────────────────

def _mock_response(image_id: str) -> dict[str, Any]:
    predictions = [
        {"condition": "acne",                 "confidence": 0.7231},
        {"condition": "eczema",               "confidence": 0.1054},
        {"condition": "rosacea",              "confidence": 0.0812},
        {"condition": "psoriasis",            "confidence": 0.0511},
        {"condition": "tinea",                "confidence": 0.0253},
        {"condition": "seborrheic_keratoses", "confidence": 0.0139},
    ]
    return {
        "image_id": image_id,
        "model_version": f"mock-{MODEL_VERSION}",
        "primary_condition": "acne",
        "confidence_score": 0.7231,
        "predictions": predictions,
        "differential_diagnoses": predictions[1:4],
        "confidence_threshold_met": True,
        "low_confidence_flag": False,
    }


# ── Route ────────────────────────────────────────────────────────────────────

@router.post("/predict", response_model=PredictResponse)
def predict_condition(payload: PredictRequest) -> PredictResponse:
    """
    Classify skin condition from a previously-uploaded image.

    The image is fetched from Supabase Storage via the uploaded_images record.
    Set USE_MOCK_MODEL=true to bypass inference (no weights or Supabase needed).
    """
    if _USE_MOCK:
        return PredictResponse(**_mock_response(payload.image_id))

    # --- Fetch image bytes from Supabase Storage ---
    try:
        from app.services.supabase_client import get_supabase  # noqa: PLC0415

        supabase = get_supabase()
        record = (
            supabase.table("uploaded_images")
            .select("storage_path")
            .eq("id", payload.image_id)
            .single()
            .execute()
        )
        if not record.data:
            raise HTTPException(status_code=404, detail="image_id not found")

        storage_path: str = record.data["storage_path"]
        image_bytes: bytes = supabase.storage.from_("skin-images").download(storage_path)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to fetch image for image_id=%s", payload.image_id)
        raise HTTPException(status_code=500, detail=f"Storage fetch failed: {exc}") from exc

    # --- Run inference ---
    try:
        engine = _get_engine()
        result = engine.predict(image_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Inference failed for image_id=%s", payload.image_id)
        raise HTTPException(status_code=500, detail=f"Inference error: {exc}") from exc

    def _to_out(s: ConditionScore) -> ConditionScoreOut:
        return ConditionScoreOut(condition=s.condition, confidence=s.confidence)

    return PredictResponse(
        image_id=payload.image_id,
        model_version=MODEL_VERSION,
        primary_condition=result.primary_condition,
        confidence_score=result.confidence_score,
        predictions=[_to_out(s) for s in result.predictions],
        differential_diagnoses=[_to_out(s) for s in result.differential_diagnoses],
        confidence_threshold_met=result.confidence_threshold_met,
        low_confidence_flag=result.low_confidence_flag,
    )
