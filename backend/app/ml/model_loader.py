"""
EfficientNet-B0 loader with a skin-condition classification head sized to CLASS_NAMES.
Weights are loaded from WEIGHTS_PATH env var (or passed explicitly).
When no weights file exists, the model is initialised with random weights
(useful for integration testing without a trained checkpoint).
"""

import os
import logging
from typing import Optional

import torch
import torch.nn as nn
from torchvision import models

logger = logging.getLogger(__name__)

CLASS_NAMES: list[str] = [
    "acne",
    "eczema",
    "psoriasis",
    "rosacea",
    "seborrheic_keratoses",
    "tinea",
    "melasma",
    "vitiligo",
    "hyperpigmentation",
    "contact_dermatitis",
    "warts",
    "actinic_keratosis",
]

_TEMPERATURE_DEFAULT = float(os.getenv("TEMPERATURE", "1.5"))


class TemperatureScaler(nn.Module):
    """Wraps a model and divides logits by a learned/fixed temperature scalar."""

    def __init__(self, base_model: nn.Module, temperature: float = _TEMPERATURE_DEFAULT):
        super().__init__()
        self.base_model = base_model
        # stored as a parameter so it can be fine-tuned if desired
        self.temperature = nn.Parameter(
            torch.tensor(temperature), requires_grad=False
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        logits = self.base_model(x)
        return logits / self.temperature


def _build_efficientnet_b0(
    num_classes: int = len(CLASS_NAMES), pretrained: bool = False
) -> nn.Module:
    """Return EfficientNet-B0 with a fresh classification head for num_classes.

    pretrained=True loads ImageNet weights into the backbone (for training /
    fine-tuning). Inference leaves it False and loads our own checkpoint instead.
    """
    weights = models.EfficientNet_B0_Weights.IMAGENET1K_V1 if pretrained else None
    backbone = models.efficientnet_b0(weights=weights)
    in_features = backbone.classifier[1].in_features
    backbone.classifier[1] = nn.Linear(in_features, num_classes)
    return backbone


def load_model(
    weights_path: Optional[str] = None,
    device: Optional[torch.device] = None,
    temperature: float = _TEMPERATURE_DEFAULT,
) -> TemperatureScaler:
    """
    Build and return a TemperatureScaler-wrapped EfficientNet-B0.

    Args:
        weights_path: path to a .pt/.pth state-dict saved with torch.save(model.state_dict(), ...).
                      Falls back to WEIGHTS_PATH env var, then random init if neither is set.
        device:       target device; defaults to CUDA if available, else CPU.
        temperature:  calibration divisor; overrideable via TEMPERATURE env var.
    """
    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    resolved_path = weights_path or os.getenv("WEIGHTS_PATH")

    backbone = _build_efficientnet_b0(num_classes=len(CLASS_NAMES))
    model = TemperatureScaler(backbone, temperature=temperature)

    if resolved_path and os.path.isfile(resolved_path):
        state = torch.load(resolved_path, map_location=device, weights_only=True)
        # allow loading bare backbone state-dict or full TemperatureScaler state-dict
        try:
            model.load_state_dict(state, strict=True)
            logger.info("Loaded weights (full) from %s", resolved_path)
        except RuntimeError:
            model.base_model.load_state_dict(state, strict=True)
            logger.info("Loaded weights (backbone only) from %s", resolved_path)
    else:
        logger.warning(
            "No weights file found at '%s'; using random init. "
            "Set WEIGHTS_PATH or pass weights_path= to load_model().",
            resolved_path,
        )

    model.to(device)
    model.eval()
    return model


def get_class_names() -> list[str]:
    return CLASS_NAMES
