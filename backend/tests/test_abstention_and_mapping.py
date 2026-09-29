"""Abstention floors, and the DermNet filename mapping that feeds them.

Both encode judgement calls that are easy to undo by accident:

  * the floors say how much evidence a class needs before we present it as an
    answer, and they scale with how little data it was trained on;
  * the DermNet rules deliberately REJECT look-alikes whose names differ by a
    couple of letters — including a premalignant condition that must never be
    labelled "chapped lips".
"""

import sys
from pathlib import Path

import pytest

from app.ml.inference import _MIN_CONFIDENCE, _min_confidence
from app.ml.model_loader import CLASS_NAMES

# prepare_dermnet lives in training/ and is run as a script, not imported
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "ml" / "training"))
from prepare_dermnet import _map as dermnet_map  # noqa: E402


# --- abstention -----------------------------------------------------------

def test_every_class_has_a_floor():
    missing = [c for c in CLASS_NAMES if c not in _MIN_CONFIDENCE]
    assert not missing, f"no abstention floor for {missing}"


def test_floors_are_sane_probabilities():
    assert all(0.0 < v <= 1.0 for v in _MIN_CONFIDENCE.values())


def test_thinly_trained_classes_demand_more_evidence():
    """hirsutism learned from 2 images; eczema_flare from ~3,400.

    The same confidence from each cannot mean the same thing, so the floors
    must not be equal — that was the bug a single global threshold created.
    """
    assert _min_confidence("hirsutism") > _min_confidence("eczema_flare")
    assert _min_confidence("melasma") > _min_confidence("fungal_infection")
    assert _min_confidence("miliaria") > _min_confidence("hormonal_acne")


def test_at_sixty_percent_weak_classes_abstain_and_strong_ones_do_not():
    conf = 0.60
    assert conf >= _min_confidence("eczema_flare")          # presented
    assert conf >= _min_confidence("fungal_infection")      # presented
    assert conf < _min_confidence("melasma")                # abstains
    assert conf < _min_confidence("miliaria")               # abstains
    assert conf < _min_confidence("hirsutism")              # abstains


def test_unknown_condition_falls_back_rather_than_crashing():
    assert 0.0 < _min_confidence("not_a_real_class") <= 1.0


# --- DermNet filename mapping --------------------------------------------

@pytest.mark.parametrize("filename,expected", [
    # the classes DermNet rescued
    ("melasma-12.jpg", "melasma"),
    ("eczema-asteatotic-3.jpg", "xerosis"),          # asteatotic IS dry-skin eczema
    ("heels-dry-cracked-2.jpg", "xerosis"),
    ("acanthosis-nigricans-7.jpg", "acanthosis_nigricans"),
    ("seborrheic-dermatitis-9.jpg", "seborrhea"),
    ("hirsutism-2.jpg", "hirsutism"),
    ("sunburn-3.jpg", "sunburn"),
    ("phototoxic-reactions-lime-juice-2.jpg", "sunburn"),
    ("03angularcheilitis-1.jpg", "chapped_lips"),
    ("tinea-body-127.jpg", "fungal_infection"),
    ("acne-cystic-5.jpg", "hormonal_acne"),
    ("eczema-nummular-2.jpg", "eczema_flare"),
])
def test_dermnet_maps_the_conditions_we_want(filename, expected):
    assert dermnet_map(filename) == expected


@pytest.mark.parametrize("filename,why", [
    ("seborrheic-keratoses-smooth-4.jpg", "benign tumour, not seborrhoea"),
    ("seborrheic-keratosis-irritated-1.jpg", "benign tumour, not seborrhoea"),
    ("actinic-cheilitis-sq-cell-lip-5.jpg", "PREMALIGNANT — never 'chapped lips'"),
    ("sun-damaged-skin-11.jpg", "chronic photodamage, not an acute burn"),
    ("05ichthyosisvulgaris-1.jpg", "genetic disorder, not seasonal dryness"),
    ("rosacea-8.jpg", "not one of our classes"),
    ("perioral-dermatitis-4.jpg", "lives in the acne folder, different condition"),
    ("malignant-melanoma-3.jpg", "malignancy"),
    ("distal-subungual-onychomycosis-3.jpg", "nail disease, unlike skin ringworm"),
    ("psoriasis-sunburn-2.jpg", "psoriasis, despite the word sunburn"),
])
def test_dermnet_rejects_look_alikes(filename, why):
    assert dermnet_map(filename) is None, f"{filename} should be excluded: {why}"


def test_dermnet_only_ever_returns_a_real_class():
    for name in ("melasma-1.jpg", "tinea-body-2.jpg", "hirsutism-1.jpg"):
        mapped = dermnet_map(name)
        assert mapped in CLASS_NAMES
