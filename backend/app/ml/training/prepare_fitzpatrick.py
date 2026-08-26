"""
Pull the Fitzpatrick17k dataset into the BALANCED ImageFolder for retraining.

Fitzpatrick17k = ~16.5k clinical images across 114 fine-grained conditions with
diverse Fitzpatrick skin types (great for fairness on darker skin). We map the
fine labels down to our 12 classes and merge into the same data/ tree used by
prepare_scin.py, so a single retrain uses ALL sources.

Inputs (you upload both to Drive, the notebook unzips archive.zip):
  * fitzpatrick17k.csv  — cols: md5hash, label, qc, fitzpatrick_scale, url, ...
  * an image folder      — images named <md5hash>.jpg (from archive.zip)

Usage:
    pip install pandas pillow tqdm
    python prepare_fitzpatrick.py --csv fitzpatrick17k.csv --images ./fitz_images \
        --out ./data --per-class 1200

The label column is fine-grained (e.g. "acne vulgaris", "allergic contact
dermatitis"); _MAP folds those into our 12 classes by substring (specific first).
Rows whose `qc` marks them wrongly labelled are dropped by default.
"""

from __future__ import annotations

import argparse
import logging
from collections import Counter, defaultdict
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("prepare_fitzpatrick")

CLASS_NAMES = [
    "acne", "eczema", "psoriasis", "rosacea", "seborrheic_keratoses", "tinea",
    "melasma", "vitiligo", "hyperpigmentation", "contact_dermatitis", "warts",
    "actinic_keratosis",
]

# Fitzpatrick17k fine-label substrings -> our class (first match wins, specific
# before generic). Only conditions that correspond to our 12 classes are kept;
# everything else (melanoma, dermatofibroma, ...) is intentionally ignored.
_MAP: list[tuple[str, str]] = [
    ("actinic keratos", "actinic_keratosis"),
    ("seborrheic keratos", "seborrheic_keratoses"),
    ("allergic contact", "contact_dermatitis"),
    ("irritant contact", "contact_dermatitis"),
    ("contact dermatitis", "contact_dermatitis"),
    ("post inflammatory hyper", "hyperpigmentation"),
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
    ("dyshidrotic eczema", "eczema"),
    ("eczema", "eczema"),
    ("acne", "acne"),
]

_IMG_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp")


def _map(label: str) -> str | None:
    low = str(label).strip().lower()
    for needle, cls in _MAP:
        if needle in low:
            return cls
    return None


def _index_images(images_root: Path) -> dict[str, Path]:
    """stem (md5hash) -> path, built once so lookups are O(1)."""
    idx: dict[str, Path] = {}
    for p in images_root.rglob("*"):
        if p.is_file() and p.suffix.lower() in _IMG_EXTS:
            idx.setdefault(p.stem, p)  # first wins; stems are md5 hashes (unique)
    return idx


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--csv", required=True, help="path to fitzpatrick17k.csv")
    ap.add_argument("--images", required=True, help="folder with <md5hash>.jpg images (extracted archive.zip)")
    ap.add_argument("--out", default="./data")
    ap.add_argument("--per-class", type=int, default=1200, help="equal cap per class (rebalance)")
    ap.add_argument("--val-frac", type=float, default=0.15)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--keep-mislabelled", action="store_true",
                    help="keep rows whose qc column flags them wrongly labelled (default: drop)")
    args = ap.parse_args()

    import random
    import pandas as pd
    from PIL import Image
    from tqdm import tqdm

    df = pd.read_csv(args.csv, dtype=str).fillna("")
    if "label" not in df.columns:
        raise SystemExit(f"'label' column not found. Columns: {list(df.columns)}")
    id_col = next((c for c in ("md5hash", "hasher", "md5", "image", "filename") if c in df.columns), None)
    if id_col is None:
        raise SystemExit(f"no image-id column (md5hash) found. Columns: {list(df.columns)}")

    if not args.keep_mislabelled and "qc" in df.columns:
        before = len(df)
        df = df[~df["qc"].str.contains("wrong", case=False, na=False)]
        logger.info("Dropped %d rows flagged wrongly-labelled by qc.", before - len(df))

    logger.info("Indexing images under %s …", args.images)
    idx = _index_images(Path(args.images))
    logger.info("Found %d image files.", len(idx))
    if not idx:
        raise SystemExit(f"no images found under {args.images} (extract archive.zip there first).")

    # Bucket candidate images per mapped class.
    buckets: dict[str, list[Path]] = defaultdict(list)
    unmapped = missing = 0
    for _, r in df.iterrows():
        cls = _map(r["label"])
        if not cls:
            unmapped += 1
            continue
        stem = str(r[id_col]).strip()
        src = idx.get(stem)
        if src is None:
            missing += 1
            continue
        buckets[cls].append(src)
    logger.info("Mapped rows -> %d classes | unmapped labels: %d | images missing on disk: %d",
                len(buckets), unmapped, missing)

    out = Path(args.out)
    rng = random.Random(args.seed)
    tr, va = Counter(), Counter()
    for cls in CLASS_NAMES:
        items = buckets.get(cls, [])
        rng.shuffle(items)
        items = items[: args.per_class]                 # EQUAL cap -> rebalance
        n_val = max(1, int(len(items) * args.val_frac)) if items else 0
        for i, src in enumerate(tqdm(items, desc=cls, unit="img")):
            split = "val" if i < n_val else "train"
            d = out / split / cls
            d.mkdir(parents=True, exist_ok=True)
            dest = d / f"fitz_{src.stem}.jpg"
            if dest.exists():
                (va if split == "val" else tr)[cls] += 1
                continue
            try:
                Image.open(src).convert("RGB").save(dest, "JPEG", quality=92)
                (va if split == "val" else tr)[cls] += 1
            except Exception as e:  # noqa: BLE001
                logger.warning("skip %s: %s", src.name, str(e)[:60])

    logger.info("=== Fitzpatrick17k added (balanced) ===")
    for c in CLASS_NAMES:
        if tr[c] or va[c]:
            logger.info("  %-22s train=%-4d val=%-4d", c, tr[c], va[c])
    logger.info("total=%d -> %s", sum(tr.values()) + sum(va.values()), out.resolve())
    absent = [c for c in CLASS_NAMES if not tr[c] and not va[c]]
    if absent:
        logger.warning("Fitzpatrick17k had none for: %s", ", ".join(absent))


if __name__ == "__main__":
    main()
