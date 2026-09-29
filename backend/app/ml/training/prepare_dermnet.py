"""
Pull the DermNet 23-class dataset into the ImageFolder for retraining.

DermNet (~19.5k images) is organised into 23 broad folders, but the FILENAMES
carry the actual diagnosis — "melasma-12.jpg", "eczema-asteatotic-3.jpg",
"acanthosis-nigricans-7.jpg". That matters, because the folders are far too
coarse to map directly:

  * "Light Diseases and Disorders of Pigmentation" holds melasma AND vitiligo
    AND hypopigmentation. Mapping the folder to melasma would teach the model
    that white patches are melasma.
  * "Seborrheic Keratoses and other Benign Tumors" is a benign TUMOUR, nothing
    to do with seborrhoea — yet the names differ by two letters.
  * The conditions we need most hide in unrelated folders: asteatotic
    dermatitis (= xerosis) sits in "Eczema Photos", acanthosis nigricans in
    "Systemic Disease", hirsutism in "Hair Loss Photos".

So this maps by filename prefix, not by folder.

Usage:
    pip install pillow tqdm
    python prepare_dermnet.py --root ./fitz_images --out ./data
    python prepare_dermnet.py --root ./fitz_images --dry-run

Two exclusions are deliberate and worth knowing about:
  * "actinic-cheilitis-sq-cell-lip" (60 imgs) is PREMALIGNANT. It looks like
    dry cracked lips, which is exactly why teaching the model to call it
    "chapped lips" would be dangerous. Dropped.
  * "sun-damaged-skin" (126 imgs) is chronic photodamage, not an acute burn.
    Dropped, as it would blur the sunburn class toward ageing changes.
"""

from __future__ import annotations

import argparse
import logging
import os
import random
import re
from collections import Counter, defaultdict
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("prepare_dermnet")

CLASS_NAMES = [
    # hormonal group
    "hormonal_acne", "melasma", "seborrhea", "hirsutism",
    "acanthosis_nigricans", "hormonal_hyperpigmentation",
    # seasonal group
    "xerosis", "eczema_flare", "sunburn", "miliaria",
    "fungal_infection", "chapped_lips",
]

# Checked in order; first match wins, so the specific rules come first.
_RULES: tuple[tuple[str, str], ...] = (
    # --- exact wins for the starved classes ------------------------------
    ("acanthosis-nigricans", "acanthosis_nigricans"),
    ("melasma", "melasma"),
    ("chloasma", "melasma"),
    ("hirsutism", "hirsutism"),
    ("hypertrichosis", "hirsutism"),

    # asteatotic dermatitis IS dry-skin eczema — the textbook xerosis picture
    ("eczema-asteatotic", "xerosis"),
    ("asteatotic", "xerosis"),
    ("heels-dry-cracked", "xerosis"),
    ("drycrackedheels", "xerosis"),
    ("dryfeet", "xerosis"),
    ("xerosis", "xerosis"),

    # seborrhoeic DERMATITIS only — keratoses are vetoed below
    ("seborrheic-dermatitis", "seborrhea"),
    ("seborrhoeic-dermatitis", "seborrhea"),
    ("dandruff", "seborrhea"),

    # acute UV / phototoxic burns (chronic sun damage is vetoed below)
    ("sunburn", "sunburn"),
    ("phototoxic", "sunburn"),
    ("polymorphous-light", "sunburn"),

    ("miliaria", "miliaria"),
    ("prickly-heat", "miliaria"),

    ("angularcheilitis", "chapped_lips"),
    ("angular-cheilitis", "chapped_lips"),
    ("cheilitis", "chapped_lips"),          # actinic variant vetoed below

    ("hyperpigmentation", "hormonal_hyperpigmentation"),
    ("post-inflammatory-hyper", "hormonal_hyperpigmentation"),
    ("melanosis", "hormonal_hyperpigmentation"),

    # --- bulk for the classes that already work --------------------------
    ("tinea", "fungal_infection"),
    ("candidiasis", "fungal_infection"),
    ("candida", "fungal_infection"),
    ("pityrosporum", "fungal_infection"),
    ("majocchi", "fungal_infection"),
    ("ringworm", "fungal_infection"),

    ("eczema", "eczema_flare"),             # after eczema-asteatotic above
    ("atopic", "eczema_flare"),
    ("lichen-simplex", "eczema_flare"),
    ("nummular", "eczema_flare"),

    ("acne", "hormonal_acne"),
)

# Vetoes — checked BEFORE the rules. Anything matching is skipped entirely.
_EXCLUDE: tuple[str, ...] = (
    # benign tumour, not seborrhoea (differs from the real match by two letters)
    "seborrheic-kerato", "seborrheickeratosis",
    # premalignant: must never be labelled "chapped lips"
    "actinic-cheilitis",
    # chronic photodamage is not an acute burn
    "sun-damaged",
    # genetic disorders, not seasonal dry skin
    "ichthyo",
    # these live in the acne/eczema folders but are different conditions
    "rosacea", "perioral-dermatitis", "hidradenitis", "stasis-dermatitis",
    "psoriasis", "dermatitis-herpetiformis", "allergic-contact", "rhus-dermatitis",
    # nail disease looks nothing like skin ringworm
    "onychomycosis", "nail",
    # malignancies
    "carcinoma", "melanoma", "keratoacanthoma",
)

_IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def _stem(filename: str) -> str:
    """'melasma-12.jpg' -> 'melasma'  (strip extension and trailing index)."""
    base = os.path.splitext(filename)[0]
    return re.sub(r"[-_]?\d+$", "", base).strip("-_").lower()


def _map(filename: str) -> str | None:
    s = _stem(filename)
    if any(x in s for x in _EXCLUDE):
        return None
    for needle, cls in _RULES:
        if needle in s:
            return cls
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", required=True,
                    help="extracted DermNet folder (the one holding train/ and test/)")
    ap.add_argument("--out", default="./data")
    ap.add_argument("--per-class", type=int, default=1500, help="cap per class")
    ap.add_argument("--val-frac", type=float, default=0.15)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--dry-run", action="store_true",
                    help="report the mapping, copy nothing")
    args = ap.parse_args()

    from PIL import Image
    from tqdm import tqdm

    root = Path(args.root)
    if not root.is_dir():
        raise SystemExit(f"no DermNet at {root}")

    # Walk every split/folder; the filename decides the class.
    buckets: dict[str, list[Path]] = defaultdict(list)
    skipped: Counter = Counter()
    seen = 0
    for split_dir in root.iterdir():
        if not split_dir.is_dir():
            continue
        for folder in split_dir.iterdir():
            if not folder.is_dir():
                continue
            for p in folder.iterdir():
                if p.suffix.lower() not in _IMG_EXTS:
                    continue
                seen += 1
                cls = _map(p.name)
                if cls:
                    buckets[cls].append(p)
                else:
                    skipped[_stem(p.name)] += 1

    logger.info("Scanned %d DermNet images.", seen)
    logger.info("=== mapped ===")
    total = 0
    for cls in CLASS_NAMES:
        n = len(buckets.get(cls, []))
        total += n
        logger.info("  %-28s %5d", cls, n)
    logger.info("  %-28s %5d  (%.0f%% of DermNet)", "TOTAL", total,
                100 * total / max(seen, 1))
    logger.info("Unmapped (top 10 — expected, DermNet covers many conditions we do not):")
    for name, n in skipped.most_common(10):
        logger.info("    %-45s %4d", name, n)

    if args.dry_run:
        logger.info("DRY RUN — nothing written.")
        return

    out = Path(args.out)
    rng = random.Random(args.seed)
    tr, va = Counter(), Counter()
    for cls in CLASS_NAMES:
        items = buckets.get(cls, [])
        rng.shuffle(items)
        items = items[: args.per_class]
        n_val = max(1, int(len(items) * args.val_frac)) if items else 0
        for i, src in enumerate(tqdm(items, desc=cls, unit="img")):
            split = "val" if i < n_val else "train"
            d = out / split / cls
            d.mkdir(parents=True, exist_ok=True)
            dest = d / f"dermnet_{src.stem}.jpg"
            if dest.exists():
                dest = d / f"dermnet_{src.parent.name[:8]}_{src.stem}.jpg"
            if dest.exists():
                (va if split == "val" else tr)[cls] += 1
                continue
            try:
                Image.open(src).convert("RGB").save(dest, "JPEG", quality=92)
                (va if split == "val" else tr)[cls] += 1
            except Exception as e:  # noqa: BLE001
                logger.warning("skip %s: %s", src.name, str(e)[:60])

    logger.info("=== DermNet added ===")
    for c in CLASS_NAMES:
        if tr[c] or va[c]:
            logger.info("  %-28s train=%-5d val=%-4d", c, tr[c], va[c])
    logger.info("total=%d -> %s", sum(tr.values()) + sum(va.values()), out.resolve())


if __name__ == "__main__":
    main()
