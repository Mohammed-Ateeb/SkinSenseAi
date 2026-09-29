"""
Mock OTC product catalog — a deterministic fallback used when the pgvector RAG
store returns nothing (e.g. the vector migration/backfill hasn't run). It gives
the analyze/chat flows real, condition-specific product recommendations and a
non-empty whitelist for the guardrail, so the UI's "recommended products" and
the LLM's advice are never blank.

Every product is over-the-counter (no prescription items). Shapes match what the
analyze router persists (`recommended_products`) and what the guardrail expects.
"""

from __future__ import annotations

# condition -> list of OTC products. Keep names generic/real-world OTC.
_CATALOG: dict[str, list[dict]] = {
    "acne": [
        {"name": "CeraVe Acne Foaming Cream Cleanser", "active_ingredients": ["benzoyl peroxide 4%"], "usage": "AM & PM — cleanse, leave 20s, rinse"},
        {"name": "The Ordinary Salicylic Acid 2% Solution", "active_ingredients": ["salicylic acid 2%"], "usage": "PM — thin layer on affected areas"},
        {"name": "The Ordinary Niacinamide 10% + Zinc", "active_ingredients": ["niacinamide", "zinc"], "usage": "AM — before moisturiser"},
        {"name": "La Roche-Posay Effaclar Mat Moisturiser", "active_ingredients": ["sebo-regulating complex"], "usage": "AM & PM — oil-free hydration"},
        {"name": "EltaMD UV Clear SPF 46", "active_ingredients": ["zinc oxide", "niacinamide"], "usage": "AM — final step, reapply midday"},
    ],
    "eczema": [
        {"name": "Vanicream Gentle Facial Cleanser", "active_ingredients": ["fragrance-free surfactants"], "usage": "AM & PM — lukewarm water"},
        {"name": "CeraVe Moisturising Cream", "active_ingredients": ["ceramides", "hyaluronic acid"], "usage": "AM & PM — apply to damp skin"},
        {"name": "Aveeno Eczema Therapy Balm", "active_ingredients": ["colloidal oatmeal"], "usage": "PM & during flares"},
        {"name": "Cortizone-10 (OTC hydrocortisone 1%)", "active_ingredients": ["hydrocortisone 1%"], "usage": "Flares only — thin layer, max 7 days"},
    ],
    "psoriasis": [
        {"name": "CeraVe Psoriasis Cleanser", "active_ingredients": ["salicylic acid 2%"], "usage": "AM & PM"},
        {"name": "MG217 Coal Tar Ointment", "active_ingredients": ["coal tar 2%"], "usage": "PM — on plaques"},
        {"name": "CeraVe Moisturising Cream", "active_ingredients": ["ceramides"], "usage": "AM & PM — generously"},
    ],
    "rosacea": [
        {"name": "La Roche-Posay Toleriane Cleanser", "active_ingredients": ["gentle non-foaming"], "usage": "AM & PM"},
        {"name": "The Ordinary Azelaic Acid 10%", "active_ingredients": ["azelaic acid 10%"], "usage": "PM — calms redness"},
        {"name": "The Ordinary Niacinamide 10%", "active_ingredients": ["niacinamide"], "usage": "AM"},
        {"name": "EltaMD UV Clear SPF 46 (mineral)", "active_ingredients": ["zinc oxide"], "usage": "AM — mineral SPF only"},
    ],
    "seborrheic_keratoses": [
        {"name": "CeraVe Hydrating Cleanser", "active_ingredients": ["ceramides"], "usage": "AM & PM"},
        {"name": "EltaMD UV Clear SPF 46", "active_ingredients": ["zinc oxide"], "usage": "AM"},
    ],
    "tinea": [
        {"name": "Lotrimin AF Antifungal Cream", "active_ingredients": ["clotrimazole 1%"], "usage": "AM & PM — 2-4 weeks, extend past clearing"},
        {"name": "Lamisil AT Cream", "active_ingredients": ["terbinafine 1%"], "usage": "PM — thin layer on and around the patch"},
        {"name": "Vanicream Gentle Cleanser", "active_ingredients": ["fragrance-free"], "usage": "Keep the area clean and dry"},
    ],
    "melasma": [
        {"name": "The Ordinary Ascorbic Acid Vitamin C", "active_ingredients": ["vitamin C"], "usage": "AM — brightening antioxidant"},
        {"name": "The Ordinary Azelaic Acid 10%", "active_ingredients": ["azelaic acid 10%"], "usage": "PM — evens pigment"},
        {"name": "The Ordinary Alpha Arbutin 2% + HA", "active_ingredients": ["alpha arbutin"], "usage": "AM & PM"},
        {"name": "EltaMD UV Clear SPF 46", "active_ingredients": ["zinc oxide"], "usage": "AM — essential, reapply; sun undoes progress"},
    ],
    "vitiligo": [
        {"name": "CeraVe Hydrating Cleanser", "active_ingredients": ["ceramides"], "usage": "AM & PM"},
        {"name": "EltaMD UV Clear SPF 46", "active_ingredients": ["zinc oxide"], "usage": "AM — protects depigmented skin from burning"},
        {"name": "Dermablend Cover Cream (cosmetic camouflage)", "active_ingredients": ["pigment cover"], "usage": "As desired for even tone"},
    ],
    "hyperpigmentation": [
        {"name": "The Ordinary Ascorbic Acid Vitamin C", "active_ingredients": ["vitamin C"], "usage": "AM — brightening"},
        {"name": "The Ordinary Niacinamide 10% + Zinc", "active_ingredients": ["niacinamide"], "usage": "AM & PM"},
        {"name": "The Ordinary Azelaic Acid 10%", "active_ingredients": ["azelaic acid 10%"], "usage": "PM"},
        {"name": "EltaMD UV Clear SPF 46", "active_ingredients": ["zinc oxide"], "usage": "AM — prevents darkening"},
    ],
    "contact_dermatitis": [
        {"name": "Vanicream Gentle Cleanser", "active_ingredients": ["fragrance-free"], "usage": "AM & PM — avoid known triggers"},
        {"name": "CeraVe Moisturising Cream", "active_ingredients": ["ceramides"], "usage": "AM & PM — repair barrier"},
        {"name": "Cortizone-10 (OTC hydrocortisone 1%)", "active_ingredients": ["hydrocortisone 1%"], "usage": "Flares only — max 7 days"},
    ],
    "warts": [
        {"name": "Compound W Salicylic Acid Gel", "active_ingredients": ["salicylic acid 17%"], "usage": "PM — daily, file gently between uses"},
        {"name": "Dr. Scholl's Freeze Away (OTC cryotherapy)", "active_ingredients": ["dimethyl ether"], "usage": "As directed on pack"},
    ],
    "actinic_keratosis": [
        {"name": "EltaMD UV Clear SPF 46", "active_ingredients": ["zinc oxide"], "usage": "AM — daily, reapply; sun protection is primary"},
        {"name": "CeraVe Moisturising Cream", "active_ingredients": ["ceramides"], "usage": "AM & PM"},
    ],
    # --- conditions introduced with the hormonal/seasonal taxonomy ----------
    "seborrhea": [
        {"name": "Nizoral Anti-Dandruff Shampoo", "active_ingredients": ["ketoconazole 1%"], "usage": "2-3x weekly — leave 3-5 min before rinsing"},
        {"name": "Vanicream Z-Bar", "active_ingredients": ["zinc pyrithione 2%"], "usage": "Daily — face and affected areas"},
        {"name": "The Ordinary Niacinamide 10% + Zinc", "active_ingredients": ["niacinamide", "zinc"], "usage": "AM — helps regulate oil"},
        {"name": "La Roche-Posay Effaclar Mat Moisturiser", "active_ingredients": ["sebo-regulating complex"], "usage": "AM & PM — oil-free"},
    ],
    "hirsutism": [
        {"name": "Vanicream Gentle Facial Cleanser", "active_ingredients": ["fragrance-free surfactants"], "usage": "AM & PM — avoid irritating the area"},
        {"name": "Tend Skin Solution", "active_ingredients": ["isopropyl alcohol", "acetylsalicylic acid"], "usage": "After hair removal — reduces bumps"},
        {"name": "CeraVe Moisturising Cream", "active_ingredients": ["ceramides", "hyaluronic acid"], "usage": "After hair removal — restores the barrier"},
    ],
    "acanthosis_nigricans": [
        {"name": "CeraVe SA Smoothing Cream", "active_ingredients": ["salicylic acid", "urea"], "usage": "PM — softens thickened skin"},
        {"name": "Eucerin Advanced Repair Cream", "active_ingredients": ["urea 10%", "ceramides"], "usage": "AM & PM — on folds and neck"},
        {"name": "The Ordinary Glycolic Acid 7% Toning Solution", "active_ingredients": ["glycolic acid 7%"], "usage": "PM, 2-3x weekly — body only"},
    ],
    "xerosis": [
        {"name": "CeraVe Moisturising Cream", "active_ingredients": ["ceramides", "hyaluronic acid"], "usage": "AM & PM — apply to damp skin"},
        {"name": "Eucerin Advanced Repair Cream", "active_ingredients": ["urea 10%", "ceramides"], "usage": "PM — thick layer on dry areas"},
        {"name": "Vanicream Gentle Body Wash", "active_ingredients": ["fragrance-free surfactants"], "usage": "Lukewarm showers — avoid hot water"},
        {"name": "Aquaphor Healing Ointment", "active_ingredients": ["petrolatum 41%"], "usage": "PM — seal in moisture on cracked areas"},
    ],
    "sunburn": [
        {"name": "Aloe Vera Gel (99% pure)", "active_ingredients": ["aloe barbadensis"], "usage": "Reapply freely — cools and soothes"},
        {"name": "Cortizone-10 (OTC hydrocortisone 1%)", "active_ingredients": ["hydrocortisone 1%"], "usage": "Thin layer, max 7 days — reduces inflammation"},
        {"name": "CeraVe Moisturising Cream", "active_ingredients": ["ceramides", "hyaluronic acid"], "usage": "AM & PM — supports barrier recovery"},
        {"name": "EltaMD UV Clear SPF 46", "active_ingredients": ["zinc oxide", "niacinamide"], "usage": "Once healed — prevents recurrence"},
    ],
    "miliaria": [
        {"name": "Calamine Lotion", "active_ingredients": ["calamine", "zinc oxide"], "usage": "As needed — soothes itch and dries the rash"},
        {"name": "Vanicream Gentle Body Wash", "active_ingredients": ["fragrance-free surfactants"], "usage": "Cool showers — rinse sweat promptly"},
        {"name": "Gold Bond Medicated Powder", "active_ingredients": ["menthol", "zinc oxide"], "usage": "Keeps skin folds dry"},
    ],
    "chapped_lips": [
        {"name": "Aquaphor Lip Repair", "active_ingredients": ["petrolatum", "shea butter"], "usage": "Throughout the day and before bed"},
        {"name": "Vaseline Original Lip Therapy", "active_ingredients": ["petrolatum 100%"], "usage": "Seals moisture — reapply often"},
        {"name": "Sun Bum SPF 30 Lip Balm", "active_ingredients": ["octinoxate", "SPF 30"], "usage": "AM — lips burn easily in cold wind and sun"},
    ],
}

# Generic fallback if the condition isn't in the catalog.

# The taxonomy was renamed (acne -> hormonal_acne, tinea -> fungal_infection,
# ...). The catalogue entries are still correct for those conditions, so map the
# new names onto them rather than duplicating every product list. Without this
# every renamed class silently fell through to _DEFAULT — a fungal infection
# was being told to use moisturiser instead of the antifungals right here.
_ALIASES: dict[str, str] = {
    "hormonal_acne": "acne",
    "eczema_flare": "eczema",
    "fungal_infection": "tinea",
    "hormonal_hyperpigmentation": "hyperpigmentation",
}

_DEFAULT = [
    {"name": "CeraVe Hydrating Cleanser", "active_ingredients": ["ceramides"], "usage": "AM & PM — gentle cleansing"},
    {"name": "CeraVe Moisturising Cream", "active_ingredients": ["ceramides", "hyaluronic acid"], "usage": "AM & PM"},
    {"name": "EltaMD UV Clear SPF 46", "active_ingredients": ["zinc oxide"], "usage": "AM — daily sun protection"},
]


def recommend(condition: str, limit: int = 5) -> list[dict]:
    """Return recommended-product dicts for a condition (analyze-router shape)."""
    key = (condition or "").strip().lower()
    key = _ALIASES.get(key, key)
    items = _CATALOG.get(key, _DEFAULT)[:limit]
    out: list[dict] = []
    for i, p in enumerate(items):
        out.append({
            "product_id": f"mock-{key or 'default'}-{i}",
            "name": p["name"],
            "active_ingredients": p["active_ingredients"],
            "usage": p.get("usage", ""),
            "priority_score": limit - i,
            "similarity": 0.0,
        })
    return out


def whitelist_names(condition: str, limit: int = 5) -> list[str]:
    """Product names for the guardrail whitelist."""
    return [p["name"] for p in recommend(condition, limit)]


def prompt_lines(condition: str, limit: int = 5) -> str:
    """Formatted product lines to inject into the LLM system prompt."""
    lines = []
    for p in recommend(condition, limit):
        ings = ", ".join(p["active_ingredients"][:3]) if p["active_ingredients"] else "various actives"
        usage = f" — {p['usage']}" if p.get("usage") else ""
        lines.append(f"- {p['name']} ({ings}){usage}")
    return "\n".join(lines)
