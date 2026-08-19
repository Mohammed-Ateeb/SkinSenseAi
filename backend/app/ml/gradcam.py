"""Grad-CAM for the EfficientNet-B0 skin classifier.

Produces a class-activation heatmap showing which regions of the image drove
the predicted condition, overlaid on the (resized) original image and returned
as a base64 PNG data URI — safe to embed directly in the analyze response.

Note: Grad-CAM highlights whatever the current weights attend to. Until a
trained checkpoint is loaded (WEIGHTS_PATH), the model is randomly initialised,
so the heatmap will look like noise — it becomes meaningful once trained.
"""

from __future__ import annotations

import base64
import io
import logging

import numpy as np
import torch
from PIL import Image

from .preprocessing import preprocess_bytes

logger = logging.getLogger(__name__)

_INPUT = 224


def _jet(cam: np.ndarray) -> np.ndarray:
    """Map a HxW array in [0,1] to a jet-style RGB float array (HxWx3, 0-255)."""
    x = np.clip(cam, 0.0, 1.0)
    r = np.clip(1.5 - np.abs(4.0 * x - 3.0), 0.0, 1.0)
    g = np.clip(1.5 - np.abs(4.0 * x - 2.0), 0.0, 1.0)
    b = np.clip(1.5 - np.abs(4.0 * x - 1.0), 0.0, 1.0)
    return np.stack([r, g, b], axis=-1) * 255.0


def generate_gradcam(
    model: torch.nn.Module,
    device: torch.device,
    image_bytes: bytes,
    class_index: int,
    alpha: float = 0.45,
) -> str | None:
    """Return a base64 PNG data URI of the Grad-CAM overlay, or None on failure.

    `model` is the TemperatureScaler wrapper; we hook the inner EfficientNet's
    final conv feature map (``base_model.features``).
    """
    try:
        base = getattr(model, "base_model", model)
        target_layer = base.features  # final conv feature map (1280ch, 7x7)

        tensor = preprocess_bytes(image_bytes).to(device)

        activations: dict[str, torch.Tensor] = {}
        gradients: dict[str, torch.Tensor] = {}

        def fwd_hook(_m, _i, out):
            activations["value"] = out

        def bwd_hook(_m, _gin, gout):
            gradients["value"] = gout[0]

        h1 = target_layer.register_forward_hook(fwd_hook)
        h2 = target_layer.register_full_backward_hook(bwd_hook)

        try:
            model.zero_grad(set_to_none=True)
            with torch.enable_grad():
                logits = base(tensor)                 # (1, num_classes)
                idx = int(max(0, min(class_index, logits.shape[1] - 1)))
                score = logits[0, idx]
                score.backward()
        finally:
            h1.remove()
            h2.remove()

        if "value" not in activations or "value" not in gradients:
            return None

        acts = activations["value"].detach()[0]       # (C, h, w)
        grads = gradients["value"].detach()[0]         # (C, h, w)
        weights = grads.mean(dim=(1, 2))               # (C,)  channel importance
        cam = torch.relu((weights[:, None, None] * acts).sum(dim=0))  # (h, w)
        cam = cam - cam.min()
        cam = cam / (cam.max() + 1e-8)
        cam_np = cam.cpu().numpy()

        # Upsample CAM to input size
        cam_img = Image.fromarray((cam_np * 255).astype("uint8")).resize(
            (_INPUT, _INPUT), Image.BILINEAR
        )
        cam_up = np.asarray(cam_img).astype("float32") / 255.0

        heat = _jet(cam_up)                            # (H, W, 3) 0-255
        orig = np.asarray(
            Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((_INPUT, _INPUT))
        ).astype("float32")

        overlay = (alpha * heat + (1.0 - alpha) * orig).clip(0, 255).astype("uint8")

        buf = io.BytesIO()
        Image.fromarray(overlay).save(buf, format="PNG")
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception as e:  # noqa: BLE001 — explanation is best-effort, never fatal
        logger.warning("Grad-CAM generation failed: %s", e)
        return None
