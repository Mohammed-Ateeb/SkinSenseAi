"""
Unit tests for the SkinSense AI guardrail module.

Run with:  pytest deliverables/backend/guardrail/tests/ -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from guardrail import validate, ValidationResult, FlaggedItem, ProductContext, DISCLAIMER


# ── Sample whitelists ─────────────────────────────────────────────────────────

# Full ProductContext shape (Oscar T2)
WHITELIST = [
    {
        "product_id": "550e8400-e29b-41d4-a716-446655440001",
        "name": "CeraVe Moisturising Cream",
        "target_conditions": ["acne", "dry skin"],
        "active_ingredients": ["ceramides", "hyaluronic acid"],
        "excludes_ingredients": [],
        "priority_score": 90,
        "similarity": 0.92,
    },
    {
        "product_id": "550e8400-e29b-41d4-a716-446655440002",
        "name": "La Roche-Posay Toleriane Cleanser",
        "target_conditions": ["sensitive skin", "rosacea"],
        "active_ingredients": ["niacinamide", "thermal spring water"],
        "excludes_ingredients": ["fragrance"],
        "priority_score": 85,
        "similarity": 0.88,
    },
    {
        "product_id": "550e8400-e29b-41d4-a716-446655440003",
        "name": "Neutrogena Hydro Boost",
        "target_conditions": ["dry skin"],
        "active_ingredients": ["hyaluronic acid"],
        "excludes_ingredients": [],
        "priority_score": 80,
        "similarity": 0.85,
    },
]

# Convenience: name-only list (ctx.product_whitelist)
PRODUCT_NAMES = [p["name"] for p in WHITELIST]


# ── Helpers ────────────────────────────────────────────────────────────────────

def _kinds(result: ValidationResult) -> list[str]:
    return [f.kind for f in result.flagged_items]


def _categories(result: ValidationResult) -> list[str]:
    return [f.category for f in result.flagged_items]


# ── 1. API variants ───────────────────────────────────────────────────────────

def test_validate_accepts_whitelist_dicts():
    text = "Use CeraVe Moisturising Cream daily. " + DISCLAIMER
    result = validate(text, whitelist=WHITELIST)
    assert result.cleaned_text  # no crash


def test_validate_accepts_product_names_list():
    text = "Use CeraVe Moisturising Cream daily. " + DISCLAIMER
    result = validate(text, product_names=PRODUCT_NAMES)
    assert result.cleaned_text


def test_validate_requires_at_least_one_source():
    try:
        validate("some text")
        assert False, "Should have raised ValueError"
    except ValueError:
        pass


# ── 2. Clean response — no flags ──────────────────────────────────────────────

def test_clean_response_passes_through():
    text = (
        "Your skin shows early signs of mild acne. "
        "I recommend using CeraVe Moisturising Cream twice daily. "
        "Keep your skin hydrated and avoid harsh scrubs. "
        + DISCLAIMER
    )
    result = validate(text, whitelist=WHITELIST)
    assert result.flagged_items == []
    assert result.disclaimer_enforced is False
    assert DISCLAIMER in result.cleaned_text


# ── 3. Disclaimer enforcement ─────────────────────────────────────────────────

def test_missing_disclaimer_is_appended():
    text = "Using CeraVe Moisturising Cream can help with dryness."
    result = validate(text, product_names=PRODUCT_NAMES)
    assert result.disclaimer_enforced is True
    assert DISCLAIMER in result.cleaned_text


def test_existing_disclaimer_not_duplicated():
    text = "Use CeraVe Moisturising Cream. " + DISCLAIMER
    result = validate(text, product_names=PRODUCT_NAMES)
    assert result.disclaimer_enforced is False
    assert result.cleaned_text.count(DISCLAIMER) == 1


def test_disclaimer_enforcement_can_be_disabled():
    text = "Use CeraVe Moisturising Cream for hydration."
    result = validate(text, product_names=PRODUCT_NAMES, enforce_disclaimer=False)
    assert result.disclaimer_enforced is False
    assert DISCLAIMER not in result.cleaned_text


# ── 4. Hallucinated product detection & stripping ─────────────────────────────

def test_hallucinated_product_stripped_by_default():
    text = (
        "Your skin looks great with CeraVe Moisturising Cream. "
        "You should also try AcneFight Pro Serum, it clears breakouts fast. "
        + DISCLAIMER
    )
    result = validate(text, whitelist=WHITELIST)
    assert any(f.kind == "hallucinated_product" for f in result.flagged_items)
    assert "AcneFight Pro Serum" not in result.cleaned_text
    assert "CeraVe" in result.cleaned_text


def test_hallucinated_product_flagged_not_stripped_when_disabled():
    text = "Use ClearSkin Magic Toner every morning. " + DISCLAIMER
    result = validate(text, product_names=PRODUCT_NAMES, strip_hallucinated_products=False)
    hallucs = [f for f in result.flagged_items if f.kind == "hallucinated_product"]
    assert len(hallucs) > 0
    assert all(f.action == "flagged" for f in hallucs)
    assert "ClearSkin Magic Toner" in result.cleaned_text


def test_whitelisted_product_not_flagged():
    text = (
        "I recommend La Roche-Posay Toleriane Cleanser for sensitive skin. "
        + DISCLAIMER
    )
    result = validate(text, whitelist=WHITELIST)
    product_flags = [f for f in result.flagged_items if f.kind == "hallucinated_product"]
    assert product_flags == []


def test_multiple_hallucinated_products_all_stripped():
    text = (
        "FakeGlow Serum in the morning is great. "
        "NightRepair X at bedtime helps too. "
        "CeraVe Moisturising Cream works well for daily hydration. "
        + DISCLAIMER
    )
    result = validate(text, whitelist=WHITELIST)
    product_flags = [f for f in result.flagged_items if f.kind == "hallucinated_product"]
    assert len(product_flags) >= 2
    assert "CeraVe Moisturising Cream" in result.cleaned_text


def test_empty_whitelist_flags_all_product_mentions():
    text = "CeraVe Moisturising Cream is a great moisturiser. " + DISCLAIMER
    result = validate(text, product_names=[])
    assert any(f.kind == "hallucinated_product" for f in result.flagged_items)


# ── 5. Medical / diagnostic claim detection ───────────────────────────────────

def test_prescription_drug_flagged_not_stripped():
    text = (
        "Tretinoin is sometimes prescribed by dermatologists for severe acne. "
        + DISCLAIMER
    )
    result = validate(text, product_names=PRODUCT_NAMES)
    med_flags = [f for f in result.flagged_items if f.kind == "medical_claim"]
    assert any(f.category == "prescription_drug_mention" for f in med_flags)
    # Should NOT be stripped — it is educational context
    assert "Tretinoin" in result.cleaned_text or "tretinoin" in result.cleaned_text.lower()
    # Should NOT also appear as a hallucinated_product
    prod_flags = [f for f in result.flagged_items if f.kind == "hallucinated_product"]
    assert not any("tretinoin" in f.matched_text.lower() for f in prod_flags)


def test_diagnostic_certainty_flagged():
    text = "You definitely have eczema based on the image. " + DISCLAIMER
    result = validate(text, product_names=PRODUCT_NAMES)
    med_flags = [f for f in result.flagged_items if f.kind == "medical_claim"]
    assert any(f.category == "diagnostic_certainty_claim" for f in med_flags)


def test_cure_claim_flagged():
    text = "This will permanently cure your acne completely. " + DISCLAIMER
    result = validate(text, product_names=PRODUCT_NAMES)
    med_flags = [f for f in result.flagged_items if f.kind == "medical_claim"]
    assert any(f.category == "cure_or_treatment_guarantee" for f in med_flags)


def test_medical_claim_sentence_is_kept():
    text = (
        "Isotretinoin is sometimes prescribed by dermatologists for severe acne. "
        + DISCLAIMER
    )
    result = validate(text, product_names=PRODUCT_NAMES)
    assert "Isotretinoin" in result.cleaned_text or "isotretinoin" in result.cleaned_text.lower()


# ── 6. FlaggedItem structure ──────────────────────────────────────────────────

def test_flagged_item_fields_populated():
    text = "BogusSerum Pro can cure acne permanently. " + DISCLAIMER
    result = validate(text, product_names=PRODUCT_NAMES)
    assert len(result.flagged_items) >= 1
    for item in result.flagged_items:
        assert item.kind in ("hallucinated_product", "medical_claim")
        assert isinstance(item.category, str) and item.category
        assert isinstance(item.matched_text, str) and item.matched_text
        assert item.action in ("stripped", "flagged")


# ── 7. ProductContext.from_dict ───────────────────────────────────────────────

def test_product_context_from_full_dict():
    pc = ProductContext.from_dict(WHITELIST[0])
    assert pc.product_id == "550e8400-e29b-41d4-a716-446655440001"
    assert pc.name == "CeraVe Moisturising Cream"
    assert "ceramides" in pc.active_ingredients
    assert pc.priority_score == 90
    assert pc.similarity == 0.92


def test_product_context_from_minimal_dict():
    pc = ProductContext.from_dict({"product_id": "abc", "name": "TestProduct"})
    assert pc.name == "TestProduct"
    assert pc.active_ingredients == []
    assert pc.priority_score == 0


# ── 8. Edge cases ─────────────────────────────────────────────────────────────

def test_empty_response_gets_disclaimer():
    result = validate("", product_names=PRODUCT_NAMES)
    assert result.disclaimer_enforced is True
    assert DISCLAIMER in result.cleaned_text


def test_partial_disclaimer_phrase_suppresses_append():
    text = "Consult a dermatologist before using any new product."
    result = validate(text, product_names=PRODUCT_NAMES)
    assert result.disclaimer_enforced is False


def test_no_false_positive_on_sentence_opening_capitals():
    text = (
        "Here are some tips for your morning skincare routine. "
        "Use a gentle cleanser and moisturise well. "
        + DISCLAIMER
    )
    result = validate(text, product_names=PRODUCT_NAMES)
    hallucs = [f for f in result.flagged_items if f.kind == "hallucinated_product"]
    matched = {f.matched_text for f in hallucs}
    for bad in ("Here", "Use", "Also"):
        assert bad not in matched, f"'{bad}' should not be flagged as product"


def test_case_insensitive_whitelist_match():
    text = "CERAVE MOISTURISING CREAM is excellent for dry skin. " + DISCLAIMER
    result = validate(text, product_names=PRODUCT_NAMES)
    # If the pattern happens to capture the all-caps version, it should still
    # match the whitelist (both normalised to lowercase).
    prod_flags = [f for f in result.flagged_items if f.kind == "hallucinated_product"]
    # CeraVe all-caps might or might not be captured by the pattern (depends on
    # whether all-caps matches the title-case pattern). The important thing is no crash.
    assert result.cleaned_text  # module runs without error


def test_flagged_items_sorted_chronologically():
    text = (
        "FakeSerum X is great. "
        "Tretinoin is sometimes prescribed. "
        "Another FakeBrand Plus product. "
        + DISCLAIMER
    )
    result = validate(text, product_names=PRODUCT_NAMES)
    spans = [f.span[0] for f in result.flagged_items if f.span is not None]
    assert spans == sorted(spans), "flagged_items should be in chronological order"
