"""
Digital Skin Twin — state aggregation + update engine.

Public surface
--------------
  update_twin(db, user_id, predict_result, chat_feedback, fitzpatrick_skin_tone)
      -> TwinState

Wiring into /analyze (app/routes/analyze.py)
--------------------------------------------
  1. After writing the analysis_results row, build a PredictResult from the
     /predict response.
  2. Optionally build a ChatFeedback from the preceding chat turn.
  3. Call update_twin(); attach the returned TwinState to the /analyze response.

  from twin.services.twin import (
      PredictResult, ConditionScore, ChatFeedback, update_twin
  )

  @router.post("/analyze")
  def analyze(payload: AnalyzeRequest, user: CurrentUser = Depends(get_current_user)):
      predict_resp = ...          # result from /predict
      analysis_result_id = ...   # uuid written to analysis_results table

      twin_state = update_twin(
          db=supabase,
          user_id=user.id,
          predict_result=PredictResult(
              image_id=predict_resp["image_id"],
              analysis_result_id=analysis_result_id,
              model_version=predict_resp["model_version"],
              predictions=[
                  ConditionScore(**p) for p in predict_resp["predictions"]
              ],
              primary_condition=predict_resp["primary_condition"],
          ),
      )
      return {**analyze_result, "twin": twin_state.__dict__}
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from supabase import Client  # same client created in app/supabase_client.py


# ──────────────────────────────────────────────────────────────────────────────
# I/O types
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class ConditionScore:
    """One prediction from /predict.  Mirrors predict.py response list items."""
    condition: str
    confidence: float  # 0.0 – 1.0


@dataclass
class PredictResult:
    """
    Full /predict response shape.  Andy (T1) owns this; align field names with
    his final output — only confidence + condition names are consumed here.
    """
    image_id: str
    analysis_result_id: str       # uuid of the row written to analysis_results
    model_version: str
    predictions: list[ConditionScore]
    primary_condition: str
    confidence_threshold_met: bool = True
    low_confidence_flag: bool = False
    # Phase 1 Digital Twin: MediaPipe FaceMesh data from browser
    face_geometry: Optional[dict] = None    # {landmarks: [{x,y,z}x468], captured_at: ISO8601}
    zone_conditions: Optional[dict] = None  # {zone: {condition, confidence, bbox}}


@dataclass
class ChatFeedback:
    """
    Optional self-report from the /chat endpoint's most recent user turn.
    trend:  'improving' | 'stable' | 'worsening'
    """
    trend: str = "stable"
    reported_symptoms: list[str] = field(default_factory=list)
    raw_text: str = ""


@dataclass
class TwinDeltas:
    """Signed change vs. the previous snapshot."""
    hydration_index: float = 0.0
    barrier_integrity: float = 0.0
    flare_changes: dict[str, float] = field(default_factory=dict)


@dataclass
class TwinState:
    """
    Mirrors skin_twins columns plus snapshot_id and deltas.
    This is the object returned from update_twin() and attached to /analyze.
    """
    twin_id: str
    user_id: str
    fitzpatrick_skin_tone: Optional[int]   # 1–6; None = not yet determined
    hydration_index: float                 # 0.0 – 1.0
    barrier_integrity: float               # 0.0 – 1.0
    active_flare_ups: dict[str, float]     # {condition: severity}
    dominant_condition: Optional[str]
    scan_count: int
    last_scan_at: Optional[str]
    last_updated_at: str
    created_at: str
    snapshot_id: str
    deltas: TwinDeltas
    low_confidence: bool = False           # True → frontend should prompt user to re-upload
    # Phase 1 Digital Twin: 3D face geometry stored per twin
    face_geometry: Optional[dict] = None   # latest FaceMesh capture
    zone_conditions: Optional[dict] = None # latest per-zone analysis


# ──────────────────────────────────────────────────────────────────────────────
# Tuning constants
# ──────────────────────────────────────────────────────────────────────────────

# Exponential moving average: how much weight goes to the new observation.
# Higher → reacts faster to acute changes; lower → smoother long-term trend.
_EMA_ALPHA = 0.35

# Minimum condition confidence to count as an active flare-up in the twin.
_FLARE_THRESHOLD = 0.25

# Per-condition weights for the two aggregate metrics.
# Weights sum to ≤1; remainder treated as baseline healthy skin.
_BARRIER_DAMAGE_WEIGHTS: dict[str, float] = {
    "eczema": 0.40,
    "psoriasis": 0.30,
    "rosacea": 0.20,
    "seborrheic_keratoses": 0.10,
}
_HYDRATION_DAMAGE_WEIGHTS: dict[str, float] = {
    "eczema": 0.60,
    "psoriasis": 0.40,
}

# Nudge applied to aggregated metrics based on user-reported chat trend.
_TREND_NUDGE: dict[str, dict[str, float]] = {
    "improving": {"hydration_index": +0.03, "barrier_integrity": +0.02},
    "worsening": {"hydration_index": -0.03, "barrier_integrity": -0.02},
    "stable":    {"hydration_index":  0.00, "barrier_integrity":  0.00},
}

_DEFAULT_HYDRATION_INDEX  = 0.70
_DEFAULT_BARRIER_INTEGRITY = 0.80


# ──────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ──────────────────────────────────────────────────────────────────────────────

def _ema(prev: float, new_obs: float, alpha: float = _EMA_ALPHA) -> float:
    return round(alpha * new_obs + (1.0 - alpha) * prev, 4)


def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def _conf_map(predictions: list[ConditionScore]) -> dict[str, float]:
    return {p.condition: p.confidence for p in predictions}


def _raw_barrier(conf: dict[str, float]) -> float:
    damage = sum(w * conf.get(c, 0.0) for c, w in _BARRIER_DAMAGE_WEIGHTS.items())
    return _clamp(1.0 - damage)


def _raw_hydration(conf: dict[str, float]) -> float:
    damage = sum(w * conf.get(c, 0.0) for c, w in _HYDRATION_DAMAGE_WEIGHTS.items())
    return _clamp(1.0 - damage)


def _active_flares(conf: dict[str, float]) -> dict[str, float]:
    return {c: round(v, 4) for c, v in conf.items() if v >= _FLARE_THRESHOLD}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ──────────────────────────────────────────────────────────────────────────────
# Database helpers
# ──────────────────────────────────────────────────────────────────────────────

def _load_twin(db: Client, user_id: str) -> dict | None:
    resp = (
        db.table("skin_twins")
        .select("*")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    return resp.data


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

def update_twin(
    db: Client,
    user_id: str,
    predict_result: PredictResult,
    chat_feedback: Optional[ChatFeedback] = None,
    fitzpatrick_skin_tone: Optional[int] = None,
) -> TwinState:
    """
    Compute the updated twin state from a new /predict result plus optional
    chat feedback, persist it, and return the full TwinState.

    Parameters
    ----------
    db                    Supabase client (service-role key — bypasses RLS for backend writes).
    user_id               Verified user UUID from Supabase Auth JWT.
    predict_result        Structured /predict response for the current scan.
    chat_feedback         Most recent /chat turn self-report (optional).
    fitzpatrick_skin_tone User-reported or inferred Fitzpatrick type (1–6, optional).
                          Sticky: once set, preserved until overridden.

    Returns
    -------
    TwinState with the updated metrics, snapshot_id, and signed deltas.
    When low_confidence_flag=True the twin is NOT updated — the returned state
    reflects the unchanged current twin, with low_confidence=True so the caller
    can prompt the user to re-upload a clearer image.
    """
    now = _utc_now()
    fb = chat_feedback or ChatFeedback()
    conf = _conf_map(predict_result.predictions)

    # ── 1. Load existing twin or set defaults ────────────────────────────────
    existing = _load_twin(db, user_id)
    if existing:
        twin_id          = existing["id"]
        prev_hydration   = float(existing["hydration_index"])
        prev_barrier     = float(existing["barrier_integrity"])
        prev_flares: dict[str, float] = {
            k: float(v) for k, v in (existing.get("active_flare_ups") or {}).items()
        }
        prev_fitz        = existing.get("fitzpatrick_skin_tone")
        scan_count       = int(existing.get("scan_count", 0))
        twin_created_at  = existing["created_at"]
    else:
        twin_id          = str(uuid.uuid4())
        prev_hydration   = _DEFAULT_HYDRATION_INDEX
        prev_barrier     = _DEFAULT_BARRIER_INTEGRITY
        prev_flares      = {}
        prev_fitz        = None
        scan_count       = 0
        twin_created_at  = now

    # ── low_confidence_flag: skip all writes, return current state unchanged ─
    if predict_result.low_confidence_flag:
        return TwinState(
            twin_id               = twin_id if existing else "",
            user_id               = user_id,
            fitzpatrick_skin_tone = prev_fitz,
            hydration_index       = prev_hydration,
            barrier_integrity     = prev_barrier,
            active_flare_ups      = prev_flares,
            dominant_condition    = existing.get("dominant_condition") if existing else None,
            scan_count            = scan_count,
            last_scan_at          = existing.get("last_scan_at") if existing else None,
            last_updated_at       = existing.get("last_updated_at", now) if existing else now,
            created_at            = twin_created_at,
            snapshot_id           = "",
            deltas                = TwinDeltas(),
            low_confidence        = True,
        )

    # ── confidence_threshold_met=False: halve EMA alpha for gentler influence ─
    alpha = _EMA_ALPHA if predict_result.confidence_threshold_met else _EMA_ALPHA * 0.5

    # ── 2. Compute new metric values ─────────────────────────────────────────
    nudge = _TREND_NUDGE.get(fb.trend, _TREND_NUDGE["stable"])

    new_hydration = _clamp(
        _ema(prev_hydration, _raw_hydration(conf), alpha) + nudge["hydration_index"]
    )
    new_barrier = _clamp(
        _ema(prev_barrier, _raw_barrier(conf), alpha) + nudge["barrier_integrity"]
    )

    # Per-flare EMA: keeps memory of conditions that may temporarily clear.
    raw_flares = _active_flares(conf)
    all_conditions = set(prev_flares) | set(raw_flares)
    new_flares: dict[str, float] = {}
    for cond in all_conditions:
        updated = round(_ema(prev_flares.get(cond, 0.0), raw_flares.get(cond, 0.0), alpha), 4)
        if updated >= _FLARE_THRESHOLD:
            new_flares[cond] = updated

    dominant = predict_result.primary_condition or (
        max(new_flares, key=new_flares.get) if new_flares else None
    )
    new_fitz = fitzpatrick_skin_tone or prev_fitz
    new_scan_count = scan_count + 1

    # ── 3. Compute deltas vs. previous state ─────────────────────────────────
    flare_changes = {
        c: round(new_flares.get(c, 0.0) - prev_flares.get(c, 0.0), 4)
        for c in all_conditions
        if abs(new_flares.get(c, 0.0) - prev_flares.get(c, 0.0)) > 0.001
    }
    deltas = TwinDeltas(
        hydration_index   = round(new_hydration - prev_hydration, 4),
        barrier_integrity = round(new_barrier   - prev_barrier,   4),
        flare_changes     = flare_changes,
    )

    # Phase 1: use the latest face_geometry/zone_conditions if provided, else keep existing
    new_face_geometry   = predict_result.face_geometry   or (existing.get("face_geometry")   if existing else None)
    new_zone_conditions = predict_result.zone_conditions or (existing.get("zone_conditions") if existing else None)

    # ── 4. Insert snapshot ───────────────────────────────────────────────────
    snapshot_id = str(uuid.uuid4())
    db.table("skin_twin_snapshots").insert({
        "id":                    snapshot_id,
        "twin_id":               twin_id,
        "user_id":               user_id,
        "analysis_result_id":    predict_result.analysis_result_id,
        "fitzpatrick_skin_tone": new_fitz,
        "hydration_index":       new_hydration,
        "barrier_integrity":     new_barrier,
        "active_flare_ups":      new_flares,
        "dominant_condition":    dominant,
        "deltas": {
            "hydration_index":    deltas.hydration_index,
            "barrier_integrity":  deltas.barrier_integrity,
            "flare_changes":      deltas.flare_changes,
        },
        "trigger":               "scan" if not chat_feedback else "chat_feedback",
        "chat_feedback_summary": fb.raw_text or None,
        "face_geometry":         new_face_geometry,
        "zone_conditions":       new_zone_conditions,
        "created_at":            now,
    }).execute()

    # ── 5. Upsert skin_twins (on_conflict=user_id) ───────────────────────────
    db.table("skin_twins").upsert({
        "id":                    twin_id,
        "user_id":               user_id,
        "fitzpatrick_skin_tone": new_fitz,
        "hydration_index":       new_hydration,
        "barrier_integrity":     new_barrier,
        "active_flare_ups":      new_flares,
        "dominant_condition":    dominant,
        "scan_count":            new_scan_count,
        "last_scan_at":          now,
        "last_updated_at":       now,
        "created_at":            twin_created_at,
        "face_geometry":         new_face_geometry,
        "zone_conditions":       new_zone_conditions,
    }, on_conflict="user_id").execute()

    return TwinState(
        twin_id               = twin_id,
        user_id               = user_id,
        fitzpatrick_skin_tone = new_fitz,
        hydration_index       = new_hydration,
        barrier_integrity     = new_barrier,
        active_flare_ups      = new_flares,
        dominant_condition    = dominant,
        scan_count            = new_scan_count,
        last_scan_at          = now,
        last_updated_at       = now,
        created_at            = twin_created_at,
        snapshot_id           = snapshot_id,
        deltas                = deltas,
        low_confidence        = False,
        face_geometry         = new_face_geometry,
        zone_conditions       = new_zone_conditions,
    )
