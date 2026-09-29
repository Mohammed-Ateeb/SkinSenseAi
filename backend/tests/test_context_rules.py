"""Axis B — the symptom description that carries what a photo cannot show.

Two properties matter more than the mapping accuracy itself:
  * with no description the CNN output must pass through UNCHANGED, or every
    analysis silently shifts;
  * a description must never overturn a confident photo, or someone's words
    could talk the model out of what it can plainly see.

Both are asserted below alongside the lexicon behaviour.
"""

import pytest

from app.ml.context_rules import (
    apply_context_prior,
    explain,
    extract_symptoms,
    score_context,
)
from app.ml.model_loader import CLASS_NAMES

FLAT = {c: 1 / len(CLASS_NAMES) for c in CLASS_NAMES}


def top(probs: dict[str, float]) -> str:
    return max(probs, key=probs.get)


# Real sentences, in the words someone would actually use.
@pytest.mark.parametrize("text,expected", [
    ("it's really dry and flaky and cracks, worse since winter", "xerosis"),
    ("tiny red bumps on my back after sweating, prickly", "miliaria"),
    ("dark velvety patches in my armpits, skin feels thicker", "acanthosis_nigricans"),
    ("painful pimples on my jawline before my period", "hormonal_acne"),
    ("a ring shaped rash that keeps spreading and itches", "fungal_infection"),
    ("my lips are cracked and sore and peeling", "chapped_lips"),
    ("skin is red and stings after too much sun", "sunburn"),
    ("brown patches on my cheeks since pregnancy", "melasma"),
    ("my scalp is oily and greasy with dandruff", "seborrhea"),
    ("extra coarse hair growing on my chin", "hirsutism"),
    ("itchy inflamed weeping rash, very raw", "eczema_flare"),
    ("uneven dark discoloration on my forehead", "hormonal_hyperpigmentation"),
])
def test_description_alone_identifies_the_condition(text, expected):
    # The CNN is deliberately flat here, so the words must do all the work.
    adjusted, _ = apply_context_prior(FLAT, {"symptom_text": text})
    assert top(adjusted) == expected


def test_hirsutism_is_reachable_from_text():
    """The class has 2 training images, so pixels will never find it.

    Axis B is the only route to it — if this breaks, the class is unreachable.
    """
    adjusted, ctx = apply_context_prior(FLAT, {"symptom_text": "extra coarse hair on my face"})
    assert top(adjusted) == "hirsutism"
    assert ctx.used_text


def test_no_description_is_an_exact_no_op():
    for answers in (None, {}, {"symptom_text": ""}, {"symptom_text": "   "}):
        adjusted, ctx = apply_context_prior(FLAT, answers)
        assert adjusted == FLAT, f"answers={answers!r} changed the output"
        assert not ctx.matched


def test_a_confident_photo_survives_a_contradictory_description():
    confident = {c: 0.01 for c in CLASS_NAMES}
    confident["sunburn"] = 0.89
    total = sum(confident.values())
    confident = {k: v / total for k, v in confident.items()}

    adjusted, _ = apply_context_prior(
        confident, {"symptom_text": "dry flaky cracked skin all winter"}
    )
    assert top(adjusted) == "sunburn"


def test_probabilities_stay_normalised():
    adjusted, _ = apply_context_prior(FLAT, {"symptom_text": "itchy dry flaking patches"})
    assert sum(adjusted.values()) == pytest.approx(1.0)
    assert all(0.0 <= v <= 1.0 for v in adjusted.values())


def test_specific_cues_outweigh_a_body_site():
    """"chin" suggests acne, "coarse hair" names hirsutism — specificity wins.

    Weighting these equally made the two tie, which is why cue weights exist.
    """
    adjusted, _ = apply_context_prior(FLAT, {"symptom_text": "extra coarse hair growing on my chin"})
    assert top(adjusted) == "hirsutism"


def test_structured_answers_contribute_without_any_text():
    adjusted, ctx = apply_context_prior(
        FLAT, {"body_site": "lips", "feels_like": ["dry", "cracked"]}
    )
    assert top(adjusted) == "chapped_lips"
    assert not ctx.used_text          # came from the chips, not free text


def test_explanation_never_contradicts_the_shown_result():
    ctx = score_context({"symptom_text": "itchy patches on my jawline"})
    supported = ctx.supported[0]

    agree = explain(ctx, supported)
    assert supported.replace("_", " ") in agree

    # When the photo disagrees, the text must not assert its own answer as THE
    # answer — that produced a card contradicting the diagnosis beside it.
    disagree = explain(ctx, "fungal_infection")
    assert "fungal infection" in disagree
    assert "photo" in disagree.lower()


def test_unknown_words_match_nothing():
    assert extract_symptoms("qwertyuiop zxcvbnm") == []
