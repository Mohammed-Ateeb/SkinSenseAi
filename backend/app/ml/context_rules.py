"""
Axis B — what the person tells us, in their own words.

A photo cannot say whether a flare is hormonal or seasonal, and a patient cannot
be asked to make that call either: they only know what they SEE and FEEL — it
hurts, it's dry, it's bumpy, it comes back every winter. So the primary input
here is free text, exactly how someone would describe it to a dermatologist.

We turn that description into per-class evidence:

    "small itchy bumps after sweating"      -> miliaria
    "dark velvety patches in my armpits"    -> acanthosis_nigricans
    "dry flaky skin that cracks"            -> xerosis, chapped_lips
    "excess coarse hair on my chin"         -> hirsutism
    "ring-shaped rash that's spreading"     -> fungal_infection

and use it to reweight the CNN's probabilities:

    final(c) is proportional to  cnn(c) * weight(c)

Design rules that keep it safe:
  * Weights are CLAMPED to [1/_MAX_TILT, _MAX_TILT]. Words can re-rank a close
    call, but never overturn a confident image — the photo stays the primary
    evidence and the description breaks ties.
  * Everything is optional. No text and no answers -> weights are all 1.0, and
    the CNN's output passes through completely unchanged.
  * Matching is transparent: every hit records the phrase that fired and why,
    so the UI can show its reasoning instead of just asserting an answer.

The lexicon is deterministic and needs no API call. A Groq-based extractor can
layer on top later for paraphrases the lexicon misses; the interface stays the
same.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable

from .model_loader import CLASS_NAMES, HORMONAL_CLASSES, SEASONAL_CLASSES

# Largest multiplier any class can receive from the description alone (and 1/x
# is the smallest). 2.2 comfortably flips a near-tie, never a confident call.
_MAX_TILT = 2.2

# Each matched phrase contributes this much to its class before clamping.
_HIT_WEIGHT = 0.55

# Not all cues carry equal weight. A body site is weak evidence (plenty of
# conditions occur on the chin); a distinctive sign like coarse hair growth or a
# velvety texture nearly names the condition on its own.
_WEAK_CUES = frozenset({
    "on the face", "jawline / chin", "cheeks / forehead", "scalp", "skin folds",
    "on the lips", "patches", "redness", "bumps", "feet", "groin",
})
_STRONG_CUES = frozenset({
    "excess hair", "hair growth", "facial hair", "velvety texture",
    "thickened skin", "ring shape", "heat rash", "prickling", "tiny bumps",
    "dandruff", "whiteheads", "blackheads", "cystic spots", "oiliness",
    "greasiness", "between the toes", "dark patches", "brown patches",
})


def _cue_weight(reason: str) -> float:
    if reason in _STRONG_CUES:
        return _HIT_WEIGHT * 1.8
    if reason in _WEAK_CUES:
        return _HIT_WEIGHT * 0.5
    return _HIT_WEIGHT

_HORMONAL = set(HORMONAL_CLASSES)
_SEASONAL = set(SEASONAL_CLASSES)


# ── Symptom lexicon ──────────────────────────────────────────────────────────
# pattern -> (classes it supports, short reason shown to the user)
# Written the way people actually describe skin, not in clinical terms.

SYMPTOM_LEXICON: tuple[tuple[str, tuple[str, ...], str], ...] = (
    # --- texture: dryness -------------------------------------------------
    (r"\bdry\b",                  ("xerosis", "chapped_lips", "eczema_flare"), "dryness"),
    (r"\bflak(y|ing|es)\b",       ("xerosis", "seborrhea", "eczema_flare"),    "flaking"),
    (r"\bscal(y|ing)\b",          ("xerosis", "fungal_infection", "eczema_flare"), "scaling"),
    (r"\brough\b",                ("xerosis",),                                 "rough texture"),
    (r"\bcrack(ed|ing|s)?\b",     ("chapped_lips", "xerosis"),                  "cracking"),
    (r"\bpeel(ing|s)?\b",         ("sunburn", "chapped_lips", "xerosis"),       "peeling"),
    (r"\bash(y|en)\b",            ("xerosis",),                                 "ashy look"),
    (r"\btight(ness)?\b",         ("xerosis",),                                 "tightness"),

    # --- texture: bumps / raised -----------------------------------------
    (r"\btiny (red )?bumps?\b",   ("miliaria",),                                "tiny bumps"),
    (r"\bbump(y|s)?\b",           ("miliaria", "hormonal_acne", "fungal_infection"), "bumps"),
    (r"\bpimple(s)?\b",           ("hormonal_acne",),                           "pimples"),
    (r"\bzit(s)?\b",              ("hormonal_acne",),                           "pimples"),
    (r"\bwhitehead(s)?\b",        ("hormonal_acne",),                           "whiteheads"),
    (r"\bblackhead(s)?\b",        ("hormonal_acne",),                           "blackheads"),
    (r"\bbreak(ing)?[ -]?out(s)?\b", ("hormonal_acne",),                        "breakouts"),
    (r"\bcyst(s|ic)?\b",          ("hormonal_acne",),                           "cystic spots"),
    (r"\bprickl(y|ing)\b",        ("miliaria",),                                "prickling"),
    (r"\bheat rash\b",            ("miliaria",),                                "heat rash"),
    (r"\bthick(ened|er)?\b",      ("acanthosis_nigricans",),                    "thickened skin"),
    (r"\bvelvet(y)?\b",           ("acanthosis_nigricans",),                    "velvety texture"),

    # --- texture: oil -----------------------------------------------------
    (r"\boil(y|iness)\b",         ("seborrhea",),                               "oiliness"),
    (r"\bgreas(y|e)\b",           ("seborrhea",),                               "greasiness"),
    (r"\bshin(y|e)\b",            ("seborrhea",),                               "shine"),
    (r"\bdandruff\b",             ("seborrhea",),                               "dandruff"),

    # --- colour -----------------------------------------------------------
    (r"\bdark (patch|spot|area)e?s?\b", ("melasma", "hormonal_hyperpigmentation",
                                         "acanthosis_nigricans"),               "dark patches"),
    (r"\bbrown (patch|spot|mark)e?s?\b", ("melasma", "hormonal_hyperpigmentation"), "brown patches"),
    (r"\bpigment(ation|ed)?\b",   ("hormonal_hyperpigmentation", "melasma"),    "pigmentation"),
    (r"\bdiscolou?r(ed|ation)\b", ("hormonal_hyperpigmentation",),              "discolouration"),
    (r"\buneven (skin ?)?tone\b", ("hormonal_hyperpigmentation",),              "uneven tone"),
    (r"\bdarken(ed|ing)\b",       ("hormonal_hyperpigmentation", "acanthosis_nigricans"), "darkening"),
    (r"\bred(ness)?\b",           ("eczema_flare", "sunburn", "miliaria"),      "redness"),

    # --- sensation --------------------------------------------------------
    (r"\bitch(y|ing|es)?\b",      ("eczema_flare", "fungal_infection", "miliaria"), "itching"),
    (r"\bburn(s|ing)?\b",         ("sunburn", "eczema_flare"),                  "burning"),
    (r"\bsting(s|ing)?\b",        ("sunburn",),                                 "stinging"),
    (r"\bpain(ful|s)?\b",         ("hormonal_acne", "sunburn"),                 "pain"),
    (r"\bsore(ness)?\b",          ("sunburn", "chapped_lips"),                  "soreness"),
    (r"\btender\b",               ("sunburn", "hormonal_acne"),                 "tenderness"),
    (r"\bweep(ing|y)\b",          ("eczema_flare",),                            "weeping"),
    (r"\booz(ing|e)\b",           ("eczema_flare",),                            "oozing"),
    (r"\braw\b",                  ("eczema_flare",),                            "rawness"),
    (r"\binflam(ed|mation)\b",    ("eczema_flare",),                            "inflammation"),

    # --- shape / spread ---------------------------------------------------
    (r"\bring[- ]?(shaped|like)?\b", ("fungal_infection",),                     "ring shape"),
    (r"\bcircular\b",             ("fungal_infection",),                        "circular patch"),
    (r"\bspread(ing|s)?\b",       ("fungal_infection",),                        "spreading"),
    (r"\bpatch(es|y)?\b",         ("melasma", "eczema_flare", "fungal_infection"), "patches"),

    # --- hair -------------------------------------------------------------
    (r"\b(excess|extra|unwanted|coarse) hair\b", ("hirsutism",),                "excess hair"),
    (r"\bhair growth\b",          ("hirsutism",),                               "hair growth"),
    (r"\bfacial hair\b",          ("hirsutism",),                               "facial hair"),

    # --- site cues in free text ------------------------------------------
    (r"\blips?\b",                ("chapped_lips",),                            "on the lips"),
    (r"\bjaw ?line\b|\bchin\b",   ("hormonal_acne",),                           "jawline / chin"),
    (r"\barmpit|neck fold|groin|underarm\b", ("acanthosis_nigricans", "fungal_infection"), "skin folds"),
    (r"\bbetween (my )?toes\b",   ("fungal_infection",),                        "between the toes"),
    (r"\bcheeks?\b|\bforehead\b", ("melasma",),                                 "cheeks / forehead"),
    (r"\bscalp\b",                ("seborrhea",),                               "scalp"),

    # --- trigger cues people genuinely observe ---------------------------
    (r"\bafter (the )?sun\b|\bsun ?burn\b|\btoo much sun\b", ("sunburn",),      "after sun exposure"),
    (r"\bsweat(ing|y)?\b",        ("miliaria",),                                "sweating"),
    (r"\bwinter\b|\bcold weather\b", ("xerosis", "chapped_lips", "eczema_flare"), "cold weather"),
    (r"\bsummer\b|\bhumid\b|\bhot weather\b", ("miliaria", "fungal_infection"), "hot / humid weather"),
    (r"\bevery (year|winter|summer)\b", tuple(SEASONAL_CLASSES),                "recurs each year"),
    (r"\bbefore (my )?period\b|\bmenstru", tuple(HORMONAL_CLASSES),             "cyclical with periods"),
    (r"\bpregnan(t|cy)\b|\bpostpartum\b", ("melasma", "hormonal_hyperpigmentation"), "pregnancy-related"),
    (r"\bpcos\b",                 tuple(HORMONAL_CLASSES),                      "PCOS"),
)


# ── Questionnaire schema ─────────────────────────────────────────────────────
# Deliberately small: a free-text box plus only the things a person can state
# without any medical judgement. The frontend renders this directly.

@dataclass(frozen=True)
class Field:
    key: str
    label: str
    type: str                      # "text" | "choice" | "multi"
    group: str                     # "describe" | "details"
    options: tuple[str, ...] = ()
    help: str = ""
    placeholder: str = ""


QUESTIONNAIRE: tuple[Field, ...] = (
    Field("symptom_text", "Describe what you're seeing and feeling", "text", "describe",
          help="In your own words — that is all we need. There are no wrong answers.",
          placeholder="e.g. dry flaky patches on my cheeks that itch, worse since it got cold"),
    Field("body_site", "Where is it?", "choice", "details",
          ("face", "jawline_chin_neck", "scalp", "chest", "back", "arm", "hand",
           "leg", "foot", "skin_folds", "lips", "groin", "other")),
    Field("duration", "How long have you had it?", "choice", "details",
          ("less_than_week", "one_to_four_weeks", "one_to_six_months",
           "over_six_months", "other"),
          help="Pick the closest, or choose Other to type an exact period."),
    Field("feels_like", "Does it feel like any of these?", "multi", "details",
          ("itchy", "painful", "burning", "dry", "bumpy", "oily",
           "rough", "cracked", "no_sensation")),
)

# Structured answers map onto classes exactly like a lexicon hit would.
_CHOICE_EVIDENCE: dict[str, dict[str, tuple[tuple[str, ...], str]]] = {
    "body_site": {
        "jawline_chin_neck": (("hormonal_acne",), "jawline / chin"),
        "lips": (("chapped_lips",), "on the lips"),
        "skin_folds": (("acanthosis_nigricans", "fungal_infection"), "skin folds"),
        "groin": (("fungal_infection",), "groin"),
        "foot": (("fungal_infection",), "feet"),
        "scalp": (("seborrhea",), "scalp"),
        "face": (("melasma", "hormonal_acne"), "on the face"),
    },
    "feels_like": {
        "itchy": (("eczema_flare", "fungal_infection", "miliaria"), "itching"),
        "painful": (("hormonal_acne", "sunburn"), "pain"),
        "burning": (("sunburn", "eczema_flare"), "burning"),
        "dry": (("xerosis", "chapped_lips", "eczema_flare"), "dryness"),
        "bumpy": (("miliaria", "hormonal_acne"), "bumps"),
        "oily": (("seborrhea",), "oiliness"),
        "rough": (("xerosis",), "rough texture"),
        "cracked": (("chapped_lips", "xerosis"), "cracking"),
    },
}


@dataclass
class ContextResult:
    weights: dict[str, float] = field(default_factory=dict)   # per-class multiplier
    matched: list[str] = field(default_factory=list)          # reasons that fired
    supported: list[str] = field(default_factory=list)        # classes lifted most
    leaning: str = "unclear"                                  # hormonal|seasonal|unclear
    used_text: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "weights": {k: round(v, 3) for k, v in self.weights.items()},
            "matched": self.matched,
            "supported": self.supported,
            "leaning": self.leaning,
            "used_text": self.used_text,
        }


def extract_symptoms(text: str) -> list[tuple[tuple[str, ...], str]]:
    """Find symptom cues in free text. Returns [(classes, reason), ...]."""
    if not text or not text.strip():
        return []
    low = text.lower()
    out: list[tuple[tuple[str, ...], str]] = []
    seen: set[str] = set()
    for pattern, classes, reason in SYMPTOM_LEXICON:
        if reason in seen:
            continue
        if re.search(pattern, low):
            out.append((classes, reason))
            seen.add(reason)
    return out


def _as_list(v: Any) -> list[str]:
    if isinstance(v, str):
        return [v]
    if isinstance(v, Iterable):
        return [str(x) for x in v]
    return []


def score_context(answers: dict[str, Any] | None) -> ContextResult:
    """Turn the description (and any structured answers) into class weights."""
    answers = answers or {}
    raw: dict[str, float] = {c: 0.0 for c in CLASS_NAMES}
    reasons: list[str] = []

    text = str(answers.get("symptom_text", "") or "")
    hits = extract_symptoms(text)
    for classes, reason in hits:
        w = _cue_weight(reason)
        for c in classes:
            if c in raw:
                raw[c] += w
        reasons.append(reason)

    # Structured answers act exactly like lexicon hits.
    for key, mapping in _CHOICE_EVIDENCE.items():
        for val in _as_list(answers.get(key)):
            hit = mapping.get(val)
            if not hit:
                continue
            classes, reason = hit
            w = _cue_weight(reason)
            for c in classes:
                if c in raw:
                    raw[c] += w
            if reason not in reasons:
                reasons.append(reason)

    if not reasons:
        return ContextResult({c: 1.0 for c in CLASS_NAMES}, [], [], "unclear", False)

    # Convert accumulated evidence into a clamped multiplier per class.
    weights = {
        c: max(1.0 / _MAX_TILT, min(_MAX_TILT, 1.0 + raw[c]))
        for c in CLASS_NAMES
    }
    top = sorted(raw.items(), key=lambda kv: -kv[1])
    supported = [c for c, v in top if v > 0][:3]

    h = sum(raw[c] for c in HORMONAL_CLASSES)
    s = sum(raw[c] for c in SEASONAL_CLASSES)
    leaning = "hormonal" if h > s * 1.2 else "seasonal" if s > h * 1.2 else "unclear"

    return ContextResult(weights, reasons, supported, leaning, bool(hits))


def group_of(condition: str) -> str:
    if condition in _HORMONAL:
        return "hormonal"
    if condition in _SEASONAL:
        return "seasonal"
    return "unknown"


def apply_context_prior(
    class_probs: dict[str, float],
    answers: dict[str, Any] | None,
) -> tuple[dict[str, float], ContextResult]:
    """Reweight the CNN's probabilities by what the person described.

    Args:
        class_probs: {class_name: probability} from the CNN, summing to ~1.
        answers:     {"symptom_text": "...", "body_site": ..., "feels_like": [...]}

    Returns:
        (reweighted probabilities summing to 1, the context result used)
    """
    ctx = score_context(answers)
    if not ctx.matched:
        return dict(class_probs), ctx

    adjusted = {
        name: prob * ctx.weights.get(name, 1.0)
        for name, prob in class_probs.items()
    }
    total = sum(adjusted.values())
    if total <= 0:
        return dict(class_probs), ctx
    return {name: v / total for name, v in adjusted.items()}, ctx


def _pretty(c: str) -> str:
    return c.replace("_", " ")


def explain(ctx: ContextResult, primary: str | None = None) -> str:
    """One-line, human-readable summary for the UI.

    `primary` is the FINAL predicted condition. Without it this used to name
    whichever class the text most supported, which could contradict the result
    actually on screen — the card claimed "points toward eczema flare" while the
    photo had concluded something else. When they disagree, say so.
    """
    if not ctx.matched:
        return "No description given — this result is based on the photo alone."
    cues = ", ".join(ctx.matched[:4])
    top = ctx.supported[0] if ctx.supported else None

    if primary and top:
        if top == primary:
            return f"You described {cues} — that supports {_pretty(primary)}."
        return (
            f"You described {cues}, which leans toward {_pretty(top)}. "
            f"The photo pointed to {_pretty(primary)} more strongly."
        )
    if top:
        return f"You described {cues} — that points toward {_pretty(top)}."
    return f"You described {cues}."


def questionnaire_schema() -> list[dict[str, Any]]:
    """JSON-serialisable schema for the frontend intake form."""
    return [
        {"key": f.key, "label": f.label, "type": f.type, "group": f.group,
         "options": list(f.options), "help": f.help, "placeholder": f.placeholder}
        for f in QUESTIONNAIRE
    ]
