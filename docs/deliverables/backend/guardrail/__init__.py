"""
SkinSense AI — post-generation anti-hallucination guardrail.

Public API:
    from guardrail import validate, ValidationResult, FlaggedItem, WhitelistItem
"""

from .guardrail import (
    DISCLAIMER,
    FlaggedItem,
    ProductContext,
    ValidationResult,
    WhitelistItem,  # backwards-compat alias for ProductContext
    validate,
)

__all__ = [
    "validate",
    "ValidationResult",
    "FlaggedItem",
    "ProductContext",
    "WhitelistItem",
    "DISCLAIMER",
]
