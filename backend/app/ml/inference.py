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

logger = logging.getLogger(__name__)

_CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.50"))
_LOW_CONFIDENCE_THRESHOLD = float(os.getenv("LOW_CONFIDENCE_THRESHOLD", "0.35"))

MODEL_VERSION = os.getenv("MODEL_VERSION", "efficientnet-b0-12cls-v1")


@dataclass
class ConditionScore:
    condition: str
    confidence: float


@dataclass
class PredictionResult:
    primary_condition: str
    confidence_score: float
    predictions: list[ConditionScore]       # all 6 classes, sorted descending
    differential_diagnoses: list[ConditionScore]  # top-3 after primary
    confidence_threshold_met: bool
    low_confidence_flag: bool


class InferenceEngine:
    """Holds the model and runs end-to-end inference."""

    def __init__(self, model: TemperatureScaler, device: torch.device):
        self._model = model
        self._device = device
        self._class_names = get_class_names()

    @classmethod
    def from_env(cls, weights_path: str | None = None) -> "InferenceEngine":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model = load_model(weights_path=weights_path, device=device)
        return cls(model=model, device=device)

    @torch.inference_mode()
    def predict(self, image_bytes: bytes) -> PredictionResult:
        """
        Run full inference pipeline on raw image bytes.

        Args:
            image_bytes: raw bytes of a JPEG/PNG image.

        Returns:
            PredictionResult with calibrated softmax probabilities,
            primary condition, confidence score, and top-3 differentials.
        """
        tensor = preprocess_bytes(image_bytes).to(self._device)

        # Forward pass through TemperatureScaler -> calibrated logits
        logits = self._model(tensor)                      # (1, 6)
        probs = F.softmax(logits, dim=-1).squeeze(0)      # (6,)

        scores = [
            ConditionScore(condition=name, confidence=round(float(prob), 4))
            for name, prob in zip(self._class_names, probs)
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
