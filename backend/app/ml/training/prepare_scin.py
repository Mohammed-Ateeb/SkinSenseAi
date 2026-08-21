"""
Prepare the Google SCIN dataset into an ImageFolder layout for training.

SCIN (Skin Condition Image Network) is crowdsourced, *multi-label* dermatology
data hosted on the public GCS bucket ``gs://dx-scin-public-data``. Each case has
a dermatologist differential stored as a weighted dict, e.g.

    {'Eczema': 0.69, 'Acute and chronic dermatitis': 0.11, 'Psoriasis': 0.08}

This script joins the two metadata CSVs, keeps cases whose top-weighted condition
maps to one of our 12 target classes with enough confidence, and downloads the
primary image for each into::

    <out>/train/<class>/<case_id>.jpg
    <out>/val/<class>/<case_id>.jpg

so ``train.py`` can consume it directly via ``torchvision.datasets.ImageFolder``.

Colab quick start:
    !pip install gcsfs pandas pillow tqdm
    !python prepare_scin.py --out ./data --min-weight 0.5 --max-per-class 800

The bucket is public, so no GCS credentials are needed (anonymous access).
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

# Must match CLASS_NAMES in model_loader.py (order not required here —
# these are just the destination folder names ImageFolder will sort).
CLASS_NAMES = [
    "acne",
    "eczema",
    "psoriasis",
    "rosacea",
    "seborrheic_keratoses",
    "tinea",
    "melasma",
    "vitiligo",
    "hyperpigmentation",
    "contact_dermatitis",
    "warts",
    "actinic_keratosis",
]

# Ordered keyword rules: (substring-in-lowercased-SCIN-label -> our class).
# First match wins, so put more specific terms before generic ones.
_KEYWORD_RULES: list[tuple[str, str]] = [
    ("actinic keratos", "actinic_keratosis"),
    ("seborrheic keratos", "seborrheic_keratoses"),
    ("sk/isk", "seborrheic_keratoses"),
    ("irritated seborrheic", "seborrheic_keratoses"),
    ("contact dermatitis", "contact_dermatitis"),
    ("allergic contact", "contact_dermatitis"),
    ("irritant contact", "contact_dermatitis"),
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
    ("eczema", "eczema"),
    ("atopic dermatitis", "eczema"),
    ("acne", "acne"),
]

_BUCKET = "gs://dx-scin-public-data"
_CASES_CSV = f"{_BUCKET}/dataset/scin_cases.csv"
_LABELS_CSV = f"{_BUCKET}/dataset/scin_labels.csv"
_STORAGE_OPTS = {"token": "anon"}  # public bucket, anonymous read


def map_condition(scin_label: str) -> str | None:
    """Map a raw SCIN condition name to one of our 12 classes, or None."""
    low = str(scin_label).strip().lower()
    for needle, cls in _KEYWORD_RULES:
        if needle in low:
            return cls
    return None


def _parse_weighted(value) -> dict[str, float]:
    """Parse the stringified dict in weighted_skin_condition_label."""
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = ast.literal_eval(value)
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, SyntaxError):
        return {}


def build_index(min_weight: float):
    """Return list of (case_id, class_name, image_gcs_path) selected from SCIN."""
    import pandas as pd  # imported lazily so --help works without deps

    logger.info("Reading SCIN metadata from GCS (anonymous)…")
    cases = pd.read_csv(_CASES_CSV, storage_options=_STORAGE_OPTS, dtype=str)
    labels = pd.read_csv(_LABELS_CSV, storage_options=_STORAGE_OPTS, dtype=str)
    df = cases.merge(labels, on="case_id", how="inner", suffixes=("", "_lbl"))
    logger.info("Joined %d cases with labels.", len(df))

    selected: list[tuple[str, str, str]] = []
    skipped_no_map = Counter()
    for _, row in df.iterrows():
        weighted = _parse_weighted(row.get("weighted_skin_condition_label"))
        if not weighted:
            continue
        top_cond, top_w = max(weighted.items(), key=lambda kv: kv[1])
        if float(top_w) < min_weight:
            continue
        cls = map_condition(top_cond)
        if cls is None:
            skipped_no_map[top_cond] += 1
            continue
        img_rel = row.get("image_1_path")
        if not isinstance(img_rel, str) or not img_rel.strip():
            continue
        img_path = f"{_BUCKET}/{img_rel.lstrip('/')}"
        selected.append((row["case_id"], cls, img_path))

    logger.info("Selected %d cases across mapped classes.", len(selected))
    if skipped_no_map:
        top_unmapped = ", ".join(
            f"{k} ({v})" for k, v in skipped_no_map.most_common(8)
        )
        logger.info("Most common UNmapped top-conditions: %s", top_unmapped)
    return selected


def download(selected, out: Path, val_frac: float, max_per_class: int, seed: int):
    import gcsfs
    from PIL import Image
    from tqdm import tqdm

    rng = random.Random(seed)
    by_class: dict[str, list] = defaultdict(list)
    for item in selected:
        by_class[item[1]].append(item)

    fs = gcsfs.GCSFileSystem(token="anon")
    counts_train, counts_val = Counter(), Counter()

    for cls, items in by_class.items():
        rng.shuffle(items)
        if max_per_class > 0:
            items = items[:max_per_class]
        n_val = max(1, int(len(items) * val_frac)) if items else 0
        for i, (case_id, _cls, gcs_path) in enumerate(
            tqdm(items, desc=cls, unit="img")
        ):
            split = "val" if i < n_val else "train"
            dest_dir = out / split / cls
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest = dest_dir / f"{case_id}.jpg"
            if dest.exists():
                (counts_val if split == "val" else counts_train)[cls] += 1
                continue
            try:
                with fs.open(gcs_path.replace("gs://", ""), "rb") as fh:
                    img = Image.open(io.BytesIO(fh.read())).convert("RGB")
                img.save(dest, format="JPEG", quality=92)
                (counts_val if split == "val" else counts_train)[cls] += 1
            except Exception as e:  # noqa: BLE001 — skip unreadable images
                logger.warning("skip %s (%s): %s", case_id, cls, e)

    logger.info("=== Done. Per-class counts ===")
    for cls in sorted(set(list(counts_train) + list(counts_val))):
        logger.info(
            "  %-22s train=%-4d val=%-4d", cls, counts_train[cls], counts_val[cls]
        )
    total = sum(counts_train.values()) + sum(counts_val.values())
    logger.info("Total images written: %d -> %s", total, out.resolve())
    missing = [c for c in CLASS_NAMES if c not in counts_train and c not in counts_val]
    if missing:
        logger.warning(
            "No SCIN images found for: %s — you'll need another source for these.",
            ", ".join(missing),
        )


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="./data", help="output root for train/ and val/")
    ap.add_argument(
        "--min-weight",
        type=float,
        default=0.5,
        help="keep a case only if its top dermatologist condition weight >= this",
    )
    ap.add_argument(
        "--max-per-class",
        type=int,
        default=800,
        help="cap images per class (0 = no cap) to limit imbalance/download size",
    )
    ap.add_argument("--val-frac", type=float, default=0.15)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="only compute and print class counts, download nothing",
    )
    args = ap.parse_args()

    selected = build_index(args.min_weight)
    if args.dry_run:
        counts = Counter(cls for _, cls, _ in selected)
        for cls in CLASS_NAMES:
            logger.info("  %-22s %d", cls, counts[cls])
        return
    download(selected, Path(args.out), args.val_frac, args.max_per_class, args.seed)


if __name__ == "__main__":
    main()
