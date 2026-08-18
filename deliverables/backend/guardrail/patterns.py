"""
Compiled regex patterns for detecting unverified medical / diagnostic claims.
All patterns are case-insensitive.
"""
import re

# --- Prescription drug classes and named Rx meds ---
PRESCRIPTION_DRUG_TERMS = re.compile(
    r"\b("
    r"tretinoin|retin-?a|isotretinoin|accutane|spironolactone|doxycycline|minocycline"
    r"|clindamycin phosphate|benzoyl peroxide \d+%|metronidazole gel|azelaic acid \d+%"
    r"|fluocinolone|triamcinolone|clobetasol|betamethasone|hydrocortisone \d+%"
    r"|tacrolimus|pimecrolimus|elidel|protopic|ciclosporin|cyclosporine"
    r"|methotrexate|azathioprine|dupilumab|dupixent|biologics?"
    r"|antibiotic[s]?|corticosteroid[s]?|steroid cream|retinoid[s]?"
    r")\b",
    re.IGNORECASE,
)

# --- Diagnostic certainty claims ---
DIAGNOSTIC_CLAIM_PATTERNS = re.compile(
    r"\b("
    r"you (definitely |certainly |clearly )?(have|suffer from|are diagnosed with)"
    r"|this is definitely|this is certainly|it'?s? (definitely|certainly|clearly)"
    r"|100% (sure|certain|confident)"
    r"|i (can confirm|can diagnose|diagnose this as)"
    r"|confirmed (case of|diagnosis)"
    r")\b",
    re.IGNORECASE,
)

# --- Cure / treatment guarantee claims ---
CURE_CLAIM_PATTERNS = re.compile(
    r"\b("
    r"(will |can |shall )?(cure|permanently (cure|fix|eliminate|eradicate))"
    r"|guaranteed (to|results?)"
    r"|permanent(ly)? (remove|eliminat|resolv|clear)"
    r"|100% effective"
    r"|clinically proven to cure"
    r"|eliminat(e|es|ed) (acne|eczema|psoriasis|rosacea|condition) (completely|permanently|forever)"
    r")\b",
    re.IGNORECASE,
)

# Grouped for iteration with labels
ALL_MEDICAL_CLAIM_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("prescription_drug_mention", PRESCRIPTION_DRUG_TERMS),
    ("diagnostic_certainty_claim", DIAGNOSTIC_CLAIM_PATTERNS),
    ("cure_or_treatment_guarantee", CURE_CLAIM_PATTERNS),
]
