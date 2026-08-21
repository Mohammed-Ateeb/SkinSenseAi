# SkinSense AI — Post-Generation Guardrail

A strict, typed validation layer that scans Groq LLM responses (model `openai/gpt-oss-20b`) against the pre-approved product whitelist retrieved in RAG context, and strips or flags hallucinated OTC products and unverified medical claims **before the response reaches the frontend**.

---

## What it does

| Check | Behaviour |
|---|---|
| Product not in whitelist | Sentence containing the mention is **stripped** (configurable to flag-only) |
| Prescription drug named | **Flagged** in the report; text kept (educational context) |
| Diagnostic certainty claim | **Flagged** in the report; text kept |
| Cure / treatment guarantee | **Flagged** in the report; text kept |
| Disclaimer absent | Standard disclaimer is **appended** automatically |

Flagged-but-kept items are returned in `ValidationResult.flagged_items` so the backend can log, escalate, or surface a UI warning if needed.

---

## Public API

```python
from guardrail import validate, ValidationResult, FlaggedItem

result: ValidationResult = validate(response_text, whitelist)
```

### `validate(response_text, whitelist, *, strip_hallucinated_products=True, enforce_disclaimer=True)`

| Parameter | Type | Description |
|---|---|---|
| `response_text` | `str` | Raw text from the Groq LLM |
| `whitelist` | `list[dict]` | Pre-approved products (see shape below) |
| `strip_hallucinated_products` | `bool` | Strip offending sentence (True) or flag-only (False) |
| `enforce_disclaimer` | `bool` | Append disclaimer if absent (True) |

**Returns** `ValidationResult`:

```python
@dataclass
class ValidationResult:
    cleaned_text: str            # safe for frontend
    flagged_items: list[FlaggedItem]
    disclaimer_enforced: bool
```

```python
@dataclass
class FlaggedItem:
    kind: str          # "hallucinated_product" | "medical_claim"
    category: str      # e.g. "product_not_in_whitelist", "prescription_drug_mention"
    matched_text: str  # the exact substring that triggered the flag
    action: str        # "stripped" | "flagged"
    span: tuple[int, int] | None  # char positions in original text
```

---

## Whitelist shape (assumed — T2 pending)

> **NOTE**: This shape is assumed pending Oscar's T2 inform message.  
> Once the real shape is confirmed by god, update `WhitelistItem.from_dict()` in `guardrail.py`.

```python
# Minimum required shape
{"product_id": "p001", "name": "CeraVe Moisturising Cream"}

# Extended shape (as seen in the actual project prompt builder)
{
    "product_id": "p001",
    "name": "CeraVe Moisturising Cream",
    "active_ingredients": ["ceramides", "hyaluronic acid"]
}
```

Both shapes are accepted; `active_ingredients` values are added to the approved name index automatically.

---

## Hook-in points

### `/analyze` endpoint

The guardrail should wrap the final `explanation` string **after** the Groq call and **before** building the JSON response returned to the frontend.

```python
# app/routers/analyze.py  (illustrative — adapt to actual file)
from guardrail import validate

# ... existing RAG + Groq call ...
raw_explanation: str = groq_response.choices[0].message.content

result = validate(raw_explanation, products)   # products = RAG whitelist already in scope

return {
    "primary_condition": payload.primary_condition,
    "confidence": payload.confidence,
    "explanation": result.cleaned_text,          # ← use cleaned text
    "recommended_products": products,
    "_guardrail_flags": [vars(f) for f in result.flagged_items],  # optional: log/persist
}
```

### `/chat` endpoint

Apply the same pattern but with `enforce_disclaimer=False` for non-first turns (the chat system prompt says not to repeat the disclaimer every message).

```python
result = validate(
    chat_response,
    whitelist=[],        # chat endpoint has no per-product whitelist context
    enforce_disclaimer=False,
)
# Log result.flagged_items; return result.cleaned_text
```

---

## Running tests

```bash
# From repo root
pytest deliverables/backend/guardrail/tests/ -v
```

No external dependencies — uses only Python stdlib.

---

## Extending patterns

Add new regex patterns to `patterns.py` in the `ALL_MEDICAL_CLAIM_PATTERNS` list:

```python
MY_PATTERN = re.compile(r"...", re.IGNORECASE)
ALL_MEDICAL_CLAIM_PATTERNS.append(("my_category_label", MY_PATTERN))
```

Medical-claim patterns flag but do not strip. To strip, add logic in `guardrail.py` step 3.
