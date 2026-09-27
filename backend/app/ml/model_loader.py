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

# The 12 conditions the model classifies, split into two clinical groups.
# Order here IS the model's output order — training and inference both derive
# from this list, so never reorder it without retraining.
#
# The groups matter at inference: the intake questionnaire produces a prior over
# {hormonal, seasonal} (see context_rules.py) which reweights these logits.
HORMONAL_CLASSES: list[str] = [
    "hormonal_acne",              # pimples on jawline, chin, lower face
    "melasma",                    # dark/brown patches
    "seborrhea",                  # excessive oiliness / increased sebum
    "hirsutism",                  # excessive facial/body hair
    "acanthosis_nigricans",       # dark, thickened, velvety skin in folds
    "hormonal_hyperpigmentation", # uneven pigmentation from hormonal change
]

SEASONAL_CLASSES: list[str] = [
    "xerosis",                    # dry skin, cold/dry weather
    "eczema_flare",               # seasonal itching, dryness, inflammation
    "sunburn",                    # excessive UV exposure
    "miliaria",                   # heat rash, sweating and heat
    "fungal_infection",           # more common in hot, humid conditions
    "chapped_lips",               # cracking from cold, dry or windy weather
]

CLASS_NAMES: list[str] = HORMONAL_CLASSES + SEASONAL_CLASSES

_TEMPERATURE_DEFAULT = float(os.getenv("TEMPERATURE", "1.5"))

# Architecture the inference model is built as when a checkpoint does not name
# its own arch (bare state_dict). New checkpoints saved by train.py are
# self-describing, so this is only the fallback for the legacy b0 checkpoint.
_DEFAULT_ARCH = os.getenv("MODEL_ARCH", "efficientnet_b0")

# Architectures training and inference may share. Keep training and serving on
# the SAME arch — the self-describing checkpoint carries it so they can't drift.
SUPPORTED_ARCHS = ("efficientnet_b0", "efficientnet_b3", "convnext_tiny")


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


def build_backbone(
    arch: str = _DEFAULT_ARCH,
    num_classes: int = len(CLASS_NAMES),
    pretrained: bool = False,
) -> nn.Module:
    """Return a CNN backbone with a fresh classification head for num_classes.

    Supports EfficientNet-B0/B3 and ConvNeXt-Tiny. All keep 224x224 input so the
    inference preprocessing (Resize 256 -> CenterCrop 224) stays valid for every
    arch. pretrained=True loads ImageNet weights (training); inference leaves it
    False and loads our own checkpoint instead.
    """
    arch = arch.lower()
    if arch == "efficientnet_b0":
        weights = models.EfficientNet_B0_Weights.IMAGENET1K_V1 if pretrained else None
        backbone = models.efficientnet_b0(weights=weights)
        in_features = backbone.classifier[1].in_features
        backbone.classifier[1] = nn.Linear(in_features, num_classes)
    elif arch == "efficientnet_b3":
        weights = models.EfficientNet_B3_Weights.IMAGENET1K_V1 if pretrained else None
        backbone = models.efficientnet_b3(weights=weights)
        in_features = backbone.classifier[1].in_features
        backbone.classifier[1] = nn.Linear(in_features, num_classes)
    elif arch == "convnext_tiny":
        weights = models.ConvNeXt_Tiny_Weights.IMAGENET1K_V1 if pretrained else None
        backbone = models.convnext_tiny(weights=weights)
        in_features = backbone.classifier[2].in_features
        backbone.classifier[2] = nn.Linear(in_features, num_classes)
    else:
        raise ValueError(f"Unsupported arch '{arch}'. Choose one of {SUPPORTED_ARCHS}.")
    return backbone


def _build_efficientnet_b0(
    num_classes: int = len(CLASS_NAMES), pretrained: bool = False
) -> nn.Module:
    """Backward-compatible shim — prefer build_backbone(arch=...)."""
    return build_backbone("efficientnet_b0", num_classes=num_classes, pretrained=pretrained)


def load_model(
    weights_path: Optional[str] = None,
    device: Optional[torch.device] = None,
    temperature: float = _TEMPERATURE_DEFAULT,
    arch: Optional[str] = None,
) -> TemperatureScaler:
    """
    Build and return a TemperatureScaler-wrapped backbone matching the checkpoint.

    The checkpoint may be either:
      * a self-describing dict {"arch", "class_names", "temperature", "state_dict"}
        saved by train.py — arch/temperature are read from it, so serving can
        never drift from training; or
      * a bare state_dict (legacy) — built as `arch` (or MODEL_ARCH env, default
        efficientnet_b0).

    Args:
        weights_path: path to a .pt/.pth checkpoint. Falls back to WEIGHTS_PATH
                      env var, then random init if neither is set.
        device:       target device; defaults to CUDA if available, else CPU.
        temperature:  fallback calibration divisor (TEMPERATURE env var).
        arch:         override backbone arch for a bare state_dict.
    """
    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    resolved_path = weights_path or os.getenv("WEIGHTS_PATH")
    resolved_arch = (arch or _DEFAULT_ARCH)
    state = None
    explicit_temp: Optional[float] = None

    if resolved_path and os.path.isfile(resolved_path):
        obj = torch.load(resolved_path, map_location=device, weights_only=True)
        if isinstance(obj, dict) and "state_dict" in obj:
            # Self-describing checkpoint: trust its arch/temperature metadata.
            state = obj["state_dict"]
            resolved_arch = obj.get("arch", resolved_arch)
            if "temperature" in obj:
                explicit_temp = float(obj["temperature"])
            ckpt_classes = obj.get("class_names")
            if ckpt_classes and list(ckpt_classes) != CLASS_NAMES:
                # HARD FAIL. A checkpoint from the old taxonomy has the same
                # number of classes as the new one, so strict=True would load
                # happily and then serve every prediction under the wrong label.
                # Refuse rather than mislabel someone's skin condition.
                msg = (
                    "Checkpoint was trained on a DIFFERENT class list than "
                    "CLASS_NAMES — serving it would mislabel every prediction.\n"
                    f"  checkpoint: {list(ckpt_classes)}\n"
                    f"  expected:   {CLASS_NAMES}\n"
                    "Retrain on the current taxonomy, or set "
                    "ALLOW_CLASS_MISMATCH=true to override (unsafe)."
                )
                if os.getenv("ALLOW_CLASS_MISMATCH", "false").lower() != "true":
                    raise ValueError(msg)
                logger.warning("ALLOW_CLASS_MISMATCH set — %s", msg)
        else:
            state = obj  # bare state_dict — its own temperature param is authoritative

    backbone = build_backbone(resolved_arch, num_classes=len(CLASS_NAMES))
    model = TemperatureScaler(
        backbone, temperature=(explicit_temp if explicit_temp is not None else temperature)
    )

    if state is not None:
        # allow loading bare backbone state-dict or full TemperatureScaler state-dict
        try:
            model.load_state_dict(state, strict=True)
            logger.info("Loaded %s weights (full) from %s", resolved_arch, resolved_path)
        except RuntimeError:
            model.base_model.load_state_dict(state, strict=True)
            logger.info("Loaded %s weights (backbone only) from %s", resolved_arch, resolved_path)
        # Metadata temperature (self-describing checkpoints) wins over whatever the
        # state_dict carried; bare checkpoints keep their own loaded temperature.
        if explicit_temp is not None:
            with torch.no_grad():
                model.temperature.copy_(torch.tensor(float(explicit_temp)))
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
