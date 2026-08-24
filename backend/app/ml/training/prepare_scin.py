"""
Pull Google's SCIN dataset (real crowdsourced skin photos, diverse skin tones)
into a BALANCED ImageFolder for retraining — the key lever for accuracy.

Why this helps the "tinea -> 99% acne" problem:
  * SCIN images are real consumer photos (closer to selfies than DermNet's
    cropped clinical shots), reducing the domain gap.
  * --per-class enforces an EQUAL cap per class, killing the acne bias that made
    the model default to acne on out-of-distribution inputs.
  * Diverse Fitzpatrick skin types improve fairness/accuracy on darker skin.

SCIN is public (CC-BY-4.0) on gs://dx-scin-public-data — no login needed.
Labels are a weighted dermatologist dict, e.g. {'Eczema': 0.69, 'Acne': 0.2, ...}.

Merge into an existing data/ dir (e.g. from extract_final_dataset.py) so the
retrain uses BOTH sources:

    pip install gcsfs pandas pillow tqdm
    python prepare_scin.py --out ./data --per-class 1200 --min-weight 0.5
"""

from __future__ import annotations

import argparse
import ast
import io
import logging
import random
from collections import Counter, defaultdict
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("prepare_scin")

CLASS_NAMES = [
    "acne", "eczema", "psoriasis", "rosacea", "seborrheic_keratoses", "tinea",
    "melasma", "vitiligo", "hyperpigmentation", "contact_dermatitis", "warts",
    "actinic_keratosis",
]

# SCIN condition-name substrings -> our class (first match wins; specific first).
_MAP: list[tuple[str, str]] = [
    ("actinic keratos", "actinic_keratosis"),
    ("seborrheic keratos", "seborrheic_keratoses"),
    ("sk/isk", "seborrheic_keratoses"),
    ("allergic contact", "contact_dermatitis"),
    ("irritant contact", "contact_dermatitis"),
    ("contact dermatitis", "contact_dermatitis"),
    ("post-inflammatory hyper", "hyperpigmentation"),
    ("postinflammatory hyper", "hyperpigmentation"),
    ("hyperpigmentation", "hyperpigmentation"),
    ("melasma", "melasma"),
    ("vitiligo", "vitiligo"),
    ("psoriasis", "psoriasis"),
    ("rosacea", "rosacea"),
    ("verruca", "warts"),
    ("wart", "warts"),
    ("tinea", "tinea"),
    ("dermatophyt", "tinea"),
    ("atopic dermatitis", "eczema"),
    ("eczema", "eczema"),
    ("acne", "acne"),
]

_BUCKET = "gs://dx-scin-public-data"
_CASES = f"{_BUCKET}/dataset/scin_cases.csv"
_LABELS = f"{_BUCKET}/dataset/scin_labels.csv"
_OPTS = {"token": "anon"}


def _map(cond: str) -> str | None:
    low = str(cond).strip().lower()
    for needle, cls in _MAP:
        if needle in low:
            return cls
    return None


def _parse(v) -> dict:
    if isinstance(v, dict):
        return v
    if not isinstance(v, str) or not v.strip():
        return {}
    try:
        d = ast.literal_eval(v)
        return d if isinstance(d, dict) else {}
    except (ValueError, SyntaxError):
        return {}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="./data")
    ap.add_argument("--per-class", type=int, default=1200, help="equal cap per class (rebalance)")
    ap.add_argument("--min-weight", type=float, default=0.5, help="keep case if top label weight >= this")
    ap.add_argument("--val-frac", type=float, default=0.15)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    import pandas as pd
    import gcsfs
    from PIL import Image
    from tqdm import tqdm

    logger.info("Reading SCIN metadata (anonymous GCS)…")
    cases = pd.read_csv(_CASES, storage_options=_OPTS, dtype=str)
    labels = pd.read_csv(_LABELS, storage_options=_OPTS, dtype=str)
    df = cases.merge(labels, on="case_id", how="inner", suffixes=("", "_l"))
    logger.info("Joined %d cases.", len(df))

    # bucket candidate images per class
    buckets: dict[str, list[str]] = defaultdict(list)
    for _, r in df.iterrows():
        w = _parse(r.get("weighted_skin_condition_label"))
        if not w:
            continue
        cond, weight = max(w.items(), key=lambda kv: kv[1])
        if float(weight) < args.min_weight:
            continue
        cls = _map(cond)
        img = r.get("image_1_path")
        if cls and isinstance(img, str) and img.strip():
            buckets[cls].append(f"{_BUCKET}/{img.lstrip('/')}")

    out = Path(args.out)
    fs = gcsfs.GCSFileSystem(token="anon")
    rng = random.Random(args.seed)
    tr, va = Counter(), Counter()
    for cls in CLASS_NAMES:
        items = buckets.get(cls, [])
        rng.shuffle(items)
        items = items[: args.per_class]                 # EQUAL cap -> rebalance
        n_val = max(1, int(len(items) * args.val_frac)) if items else 0
        for i, path in enumerate(tqdm(items, desc=cls, unit="img")):
            split = "val" if i < n_val else "train"
            d = out / split / cls
            d.mkdir(parents=True, exist_ok=True)
            dest = d / f"scin_{i}.jpg"
            if dest.exists():
                (va if split == "val" else tr)[cls] += 1
                continue
            try:
                with fs.open(path.replace("gs://", ""), "rb") as fh:
                    Image.open(io.BytesIO(fh.read())).convert("RGB").save(dest, "JPEG", quality=92)
                (va if split == "val" else tr)[cls] += 1
            except Exception as e:  # noqa: BLE001
                logger.warning("skip %s: %s", path, str(e)[:60])

    logger.info("=== SCIN added (balanced) ===")
    for c in CLASS_NAMES:
        if tr[c] or va[c]:
            logger.info("  %-22s train=%-4d val=%-4d", c, tr[c], va[c])
    logger.info("total=%d -> %s", sum(tr.values()) + sum(va.values()), out.resolve())
    missing = [c for c in CLASS_NAMES if not tr[c] and not va[c]]
    if missing:
        logger.warning("SCIN had none for: %s", ", ".join(missing))


if __name__ == "__main__":
    main()
