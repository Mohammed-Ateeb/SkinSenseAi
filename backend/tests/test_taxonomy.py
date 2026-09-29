"""The class list is load-bearing: its ORDER is the model's output order.

A reorder or rename silently mislabels every prediction — a checkpoint trained
on the old order still loads, because the tensor shape is unchanged. These
tests pin the contract so that can only happen deliberately.
"""

from app.ml.model_loader import (
    CLASS_NAMES,
    HORMONAL_CLASSES,
    SEASONAL_CLASSES,
    SUPPORTED_ARCHS,
    build_backbone,
)

EXPECTED = [
    "hormonal_acne", "melasma", "seborrhea", "hirsutism",
    "acanthosis_nigricans", "hormonal_hyperpigmentation",
    "xerosis", "eczema_flare", "sunburn", "miliaria",
    "fungal_infection", "chapped_lips",
]


def test_class_order_is_pinned():
    # Editing this test is the deliberate act. Editing CLASS_NAMES alone would
    # otherwise mislabel every stored analysis without any failure.
    assert CLASS_NAMES == EXPECTED


def test_twelve_unique_classes():
    assert len(CLASS_NAMES) == 12
    assert len(set(CLASS_NAMES)) == 12


def test_groups_partition_the_classes():
    assert len(HORMONAL_CLASSES) == 6
    assert len(SEASONAL_CLASSES) == 6
    assert HORMONAL_CLASSES + SEASONAL_CLASSES == CLASS_NAMES
    assert not set(HORMONAL_CLASSES) & set(SEASONAL_CLASSES)


def test_every_arch_builds_a_head_of_the_right_width():
    import torch

    x = torch.randn(1, 3, 224, 224)
    for arch in SUPPORTED_ARCHS:
        model = build_backbone(arch, num_classes=len(CLASS_NAMES)).eval()
        with torch.no_grad():
            out = model(x)
        assert out.shape == (1, 12), f"{arch} produced {tuple(out.shape)}"
