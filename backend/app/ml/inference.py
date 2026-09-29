"""
Core inference engine for SkinSense skin-condition classification.

Usage:
    engine = InferenceEngine.from_env()
    result = engine.predict(image_bytes)
"""

import os
import logging
from dataclasses import dataclass

import torch
import torch.nn.functional as F

from .model_loader import load_model, get_class_names, TemperatureScaler
from .preprocessing import preprocess_bytes
from .gradcam import generate_gradcam
from .context_rules import apply_context_prior, explain as explain_context

logger = logging.getLogger(__name__)

_CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.50"))
_LOW_CONFIDENCE_THRESHOLD = float(os.getenv("LOW_CONFIDENCE_THRESHOLD", "0.35"))

MODEL_VERSION = os.getenv("MODEL_VERSION", "efficientnet-b0-12cls-v1")

# Test-time augmentation: average the prediction over a few views of the same
# photo. Framing and mirroring are arbitrary properties the model should not
# care about, so averaging cancels that luck out. Agreement across views is real
# evidence, so confidence rises when the model is consistent and FALLS when the
# views disagree — unlike simply lowering the temperature, which inflates every
# number including the wrong ones. Costs one forward pass per view.
_USE_TTA = os.getenv("TTA", "true").lower() == "true"


@dataclass
class ConditionScore:
    condition: str
    confidence: float


@dataclass
class PredictionResult:
    primary_condition: str
    confidence_score: float
    predictions: list[ConditionScore]       # all 12 classes, sorted descending
    differential_diagnoses: list[ConditionScore]  # top-3 after primary
    confidence_threshold_met: bool
    low_confidence_flag: bool
    # Axis B — what the intake questionnaire contributed. Empty when no answers
    # were given, in which case the scores above are the raw CNN output.
    context: dict | None = None
    context_explanation: str = ""


class InferenceEngine:
    """Holds the model and runs end-to-end inference."""

    def __init__(self, model: TemperatureScaler, device: torch.device):
        self._model = model
        self._device = device
        self._class_names = get_class_names()
        # Architecture actually loaded (from the self-describing checkpoint),
        # not a hardcoded string — so stored records name the real model.
        self.arch = getattr(model, "arch", "unknown")

    @property
    def model_version(self) -> str:
        """e.g. "convnext_tiny-12cls". MODEL_VERSION env overrides if set."""
        override = os.getenv("MODEL_VERSION")
        if override:
            return override
        return f"{self.arch}-{len(self._class_names)}cls"

    @classmethod
    def from_env(cls, weights_path: str | None = None) -> "InferenceEngine":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model = load_model(weights_path=weights_path, device=device)
        return cls(model=model, device=device)

    @torch.inference_mode()
    def predict(
        self, image_bytes: bytes, answers: dict | None = None
    ) -> PredictionResult:
        """
        Run full inference pipeline on raw image bytes.

        Args:
            image_bytes: raw bytes of a JPEG/PNG image.
            answers:     optional intake-questionnaire answers. When given, the
                         hormonal/seasonal prior they imply reweights the CNN's
                         probabilities (Axis B). Omitted or empty -> raw CNN
                         output, unchanged.

        Returns:
            PredictionResult with calibrated softmax probabilities,
            primary condition, confidence score, and top-3 differentials.
        """
        tensor = preprocess_bytes(image_bytes).to(self._device)

        # Forward pass through TemperatureScaler -> calibrated logits.
        # Average the SOFTMAX (not the logits) across views: probabilities are
        # what we want to combine, and averaging logits would let one confident
        # view dominate the rest.
        views = [tensor, torch.flip(tensor, dims=[3])] if _USE_TTA else [tensor]
        if _USE_TTA:
            # a mild zoom-in: centre 87% of the frame, resized back to 224
            _, _, h, w = tensor.shape
            m = int(h * 0.065)
            crop = tensor[:, :, m:h - m, m:w - m]
            zoomed = F.interpolate(crop, size=(h, w), mode="bilinear", align_corners=False)
            views += [zoomed, torch.flip(zoomed, dims=[3])]

        probs = torch.stack(
            [F.softmax(self._model(v), dim=-1).squeeze(0) for v in views]
        ).mean(dim=0)                                      # (n_classes,)

        # Axis A: the image's own verdict.
        class_probs = {
            name: float(prob) for name, prob in zip(self._class_names, probs)
        }

        # Axis B: reweight by the questionnaire prior (no-op without answers).
        adjusted, ctx = apply_context_prior(class_probs, answers)

        scores = [
            ConditionScore(condition=name, confidence=round(value, 4))
            for name, value in adjusted.items()
        ]
        scores.sort(key=lambda s: s.confidence, reverse=True)

        primary = scores[0]
        differentials = scores[1:4]  # top-3 after primary

        return PredictionResult(
            primary_condition=primary.condition,
            confidence_score=primary.confidence,
            predictions=scores,
            differential_diagnoses=differentials,
            confidence_threshold_met=primary.confidence >= _CONFIDENCE_THRESHOLD,
            low_confidence_flag=primary.confidence < _LOW_CONFIDENCE_THRESHOLD,
            context=ctx.as_dict(),
            context_explanation=explain_context(ctx),
        )

    def explain(self, image_bytes: bytes, condition: str) -> str | None:
        """Grad-CAM heatmap (base64 PNG data URI) for the given class name.

        Best-effort: returns None if generation fails. Runs a grad-enabled
        pass, so it is intentionally separate from the inference-mode predict().
        """
        try:
            class_index = self._class_names.index(condition)
        except ValueError:
            class_index = 0
        return generate_gradcam(self._model, self._device, image_bytes, class_index)
