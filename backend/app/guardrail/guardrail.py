"""
Post-generation anti-hallucination guardrail for SkinSense AI.

Validates LLM responses against the pre-approved product whitelist retrieved
in RAG context (Oscar T2 RetrievedContext), and strips/flags hallucinated OTC
products or unverified medical/diagnostic claims before reaching the frontend.

WHITELIST SHAPE (confirmed from Oscar T2 — ProductContext frozen dataclass):
    {
        "product_id": str,          # uuid
        "name": str,                # <- whitelist token for name-matching
        "target_conditions": list[str],
        "active_ingredients": list[str],
        "excludes_ingredients": list[str],
        "priority_score": int,
        "similarity": float,
    }

Convenience usage — pass ctx.product_whitelist directly (list[str] of names):
    result = validate(response_text, product_names=ctx.product_whitelist)

Or pass the full ProductContext dicts list (from ctx.products):
    result = validate(response_text, whitelist=ctx.products)

Rule: any product name in LLM output MUST be in the whitelist (case-insensitive).
Only is_active=True rows appear in RetrievedContext — that is already enforced
by Oscar's RagRetriever, so no additional active-check needed here.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .patterns import ALL_MEDICAL_CLAIM_PATTERNS

# ── Constants ─────────────────────────────────────────────────────────────────

DISCLAIMER = (
    "This analysis is for informational purposes only and is not a substitute "
    "for professional medical advice. Please consult a dermatologist for "
    "diagnosis and treatment."
)

_WORD_BOUNDARY = re.compile(r"[\W_]+")


# ── Data types ────────────────────────────────────────────────────────────────

@dataclass
class ProductContext:
    """
    Mirror of Oscar's ProductContext frozen dataclass (T2 RAG deliverable).
    """
    product_id: str
    name: str
    target_conditions: list[str] = field(default_factory=list)
    active_ingredients: list[str] = field(default_factory=list)
    excludes_ingredients: list[str] = field(default_factory=list)
    priority_score: int = 0
    similarity: float = 0.0

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "ProductContext":
        return cls(
            product_id=str(d.get("product_id", d.get("id", ""))),
            name=str(d["name"]),
            target_conditions=list(d.get("target_conditions", [])),
            active_ingredients=list(d.get("active_ingredients", [])),
            excludes_ingredients=list(d.get("excludes_ingredients", [])),
            priority_score=int(d.get("priority_score", 0)),
            similarity=float(d.get("similarity", 0.0)),
        )


# Backwards-compatible alias (used in tests that still pass {product_id, name})
WhitelistItem = ProductContext


@dataclass
class FlaggedItem:
    kind: str          # "hallucinated_product" | "medical_claim"
    category: str      # e.g. "product_not_in_whitelist", "prescription_drug_mention"
    matched_text: str  # exact substring that triggered the flag
    action: str        # "stripped" | "flagged"
    span: tuple[int, int] | None = None  # char positions in original text


@dataclass
class ValidationResult:
    cleaned_text: str
    flagged_items: list[FlaggedItem]
    disclaimer_enforced: bool   # True when disclaimer was absent and appended


# ── Internal helpers ──────────────────────────────────────────────────────────

def _build_approved_set(
    whitelist: list[dict[str, Any]] | None,
    product_names: list[str] | None,
) -> set[str]:
    """
    Build a lower-cased set of approved product name tokens.
    Accepts either the raw ProductContext dicts or a pre-extracted name list.
    """
    names: set[str] = set()
    if product_names is not None:
        for n in product_names:
            names.add(_normalise(n))
    if whitelist is not None:
        for raw in whitelist:
            item = ProductContext.from_dict(raw)
            names.add(_normalise(item.name))
    return names


def _normalise(text: str) -> str:
    return text.strip().lower()


# Words that are capitalised in normal prose (sentence starters, common nouns)
# but are NOT product names.
_COMMON_CAPS: frozenset[str] = frozenset({
    # Articles / conjunctions / pronouns
    "i", "the", "a", "an", "and", "but", "or", "for", "nor", "so", "yet",
    "this", "that", "these", "those", "it", "its", "you", "your", "we", "our",
    "here", "there", "how", "what", "when", "where", "why", "who", "which",
    # Common sentence starters / connectives
    "also", "try", "use", "apply", "keep", "avoid", "make", "if", "to",
    "as", "at", "by", "do", "be", "is", "are", "was", "were", "have", "has",
    "had", "with", "about", "after", "before", "while", "since", "because",
    "although", "however", "therefore", "additionally", "furthermore", "overall",
    "remember", "consider", "ensure", "please", "note", "important", "in",
    "on", "of", "from", "can", "will", "should", "may", "might", "must",
    # Calendar
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "june",
    "july", "august", "september", "october", "november", "december",
    # Skincare / medical prose words
    "acne", "eczema", "psoriasis", "rosacea", "skin", "face", "body",
    "gentle", "daily", "morning", "evening", "night",
    "consult", "dermatologist", "doctor",
})


def _collect_medical_spans(text: str) -> set[tuple[int, int]]:
    """Return all (start, end) spans matched by any medical-claim pattern."""
    spans: set[tuple[int, int]] = set()
    for _category, pattern in ALL_MEDICAL_CLAIM_PATTERNS:
        for m in pattern.finditer(text):
            spans.add((m.start(), m.end()))
    return spans


def _overlaps(span: tuple[int, int], span_set: set[tuple[int, int]]) -> bool:
    """True if span overlaps with any span in span_set."""
    s, e = span
    return any(not (e <= ms or s >= me) for ms, me in span_set)


def _extract_product_mentions(
    text: str,
    medical_spans: set[tuple[int, int]],
) -> list[tuple[str, int, int]]:
    """
    Heuristic scanner for brand/product name phrases (1-4 title-cased words).
    Skips phrases whose span overlaps with an already-identified medical-claim
    span (so e.g. "Tretinoin" is flagged as a prescription drug, not stripped
    as a hallucinated product).
    """
    pattern = re.compile(
        r"\b([A-Z][a-zA-Z]*(?:[\s\-][A-Z][a-zA-Z]*){0,3}"
        r"(?:\s+\d+(?:\.\d+)?(?:\s*%|\s*SPF)?)?)\b"
    )
    results: list[tuple[str, int, int]] = []
    for m in pattern.finditer(text):
        phrase = m.group(1).strip()
        if len(phrase) < 4:
            continue
        first_word = _WORD_BOUNDARY.split(phrase)[0].lower()
        if first_word in _COMMON_CAPS:
            continue
        if _overlaps((m.start(), m.end()), medical_spans):
            continue
        results.append((phrase, m.start(), m.end()))
    return results


def _strip_sentence_containing(text: str, span_start: int, span_end: int) -> str:
    """Removes the sentence enclosing the matched span."""
    before = text.rfind(".", 0, span_start)
    after = text.find(".", span_end)
    if before == -1:
        before = 0
    else:
        before += 1

    if after == -1:
        after = len(text)
    else:
        after += 1

    new_text = (text[:before] + text[after:]).strip()
    return re.sub(r"\n{3,}", "\n\n", new_text)


def _check_disclaimer(text: str) -> bool:
    lower = text.lower()
    return (
        "informational purposes only" in lower
        or "not a substitute for professional medical" in lower
        or "consult a dermatologist" in lower
    )


# ── Public API ────────────────────────────────────────────────────────────────

def validate(
    response_text: str,
    whitelist: list[dict[str, Any]] | None = None,
    *,
    product_names: list[str] | None = None,
    strip_hallucinated_products: bool = True,
    enforce_disclaimer: bool = True,
) -> ValidationResult:
    """
    Validate a Groq LLM response against the pre-approved product whitelist and
    medical-claim patterns.

    Parameters
    ----------
    response_text:
        Raw text returned by the LLM.
    whitelist:
        List of ProductContext dicts (Oscar's shape: product_id, name,
        target_conditions, active_ingredients, excludes_ingredients,
        priority_score, similarity).  Pass ctx.products here.
    product_names:
        Pre-extracted list of approved product name strings.  Shortcut:
        pass ctx.product_whitelist directly and omit `whitelist`.
        Both parameters can be provided simultaneously; names are merged.
    strip_hallucinated_products:
        When True (default), sentences containing hallucinated product names
        are removed.  When False, they are flagged but kept.
    enforce_disclaimer:
        When True (default), appends the standard disclaimer if absent.

    Returns
    -------
    ValidationResult
        .cleaned_text        — response safe for the frontend
        .flagged_items       — list of FlaggedItem (chronological order)
        .disclaimer_enforced — True if disclaimer was absent and appended
    """
    if whitelist is None and product_names is None:
        raise ValueError(
            "Provide either `whitelist` (list of ProductContext dicts) or "
            "`product_names` (list[str] from ctx.product_whitelist)."
        )

    flagged: list[FlaggedItem] = []
    text = response_text

    # ── 1. Build approved-name index ─────────────────────────────────────────
    approved = _build_approved_set(whitelist, product_names)

    # ── 2. Collect medical-claim spans FIRST so they are not stripped ────────
    medical_spans = _collect_medical_spans(text)

    # ── 3. Scan for medical / diagnostic claims and flag them ────────────────
    for category, pattern in ALL_MEDICAL_CLAIM_PATTERNS:
        for m in pattern.finditer(text):
            flagged.append(FlaggedItem(
                kind="medical_claim",
                category=category,
                matched_text=m.group(0),
                action="flagged",
                span=(m.start(), m.end()),
            ))

    # ── 4. Scan for product mentions not in whitelist ────────────────────────
    mentions = _extract_product_mentions(text, medical_spans)
    # Reverse so edits don't shift remaining span positions
    for phrase, start, end in reversed(mentions):
        if _normalise(phrase) not in approved:
            action = "stripped" if strip_hallucinated_products else "flagged"
            flagged.append(FlaggedItem(
                kind="hallucinated_product",
                category="product_not_in_whitelist",
                matched_text=phrase,
                action=action,
                span=(start, end),
            ))
            if strip_hallucinated_products:
                text = _strip_sentence_containing(text, start, end)

    # ── 5. Enforce disclaimer ────────────────────────────────────────────────
    disclaimer_enforced = False
    if enforce_disclaimer and not _check_disclaimer(text):
        text = text.rstrip() + "\n\n" + DISCLAIMER
        disclaimer_enforced = True

    # ── 6. Sort flagged items chronologically by span start ──────────────────
    flagged.sort(key=lambda f: (f.span[0] if f.span else 0))

    return ValidationResult(
        cleaned_text=text,
        flagged_items=flagged,
        disclaimer_enforced=disclaimer_enforced,
    )
