"""
Image preprocessing pipeline for SkinSense EfficientNet-B0 inference.
Matches the transforms applied during training:
  - Resize to 224×224
  - ToTensor (scales [0,255] → [0,1])
  - Normalize with ImageNet mean/std
"""

import io
from typing import Union

import torch
from PIL import Image
from torchvision import transforms

# ImageNet statistics — must match training
_IMAGENET_MEAN = (0.485, 0.456, 0.406)
_IMAGENET_STD = (0.229, 0.224, 0.225)

_TRANSFORM = transforms.Compose(
    [
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(mean=_IMAGENET_MEAN, std=_IMAGENET_STD),
    ]
)


def preprocess_bytes(image_bytes: bytes) -> torch.Tensor:
    """
    Convert raw image bytes → (1, 3, 224, 224) float32 tensor ready for the model.

    Raises:
        ValueError: if the bytes cannot be decoded as a valid image.
    """
    try:
        pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as exc:
        raise ValueError(f"Cannot decode image bytes: {exc}") from exc
    return _TRANSFORM(pil_image).unsqueeze(0)  # add batch dim


def preprocess_pil(pil_image: Image.Image) -> torch.Tensor:
    """Convert a PIL Image → (1, 3, 224, 224) float32 tensor."""
    return _TRANSFORM(pil_image.convert("RGB")).unsqueeze(0)
