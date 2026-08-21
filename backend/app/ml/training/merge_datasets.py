"""
Consolidate the downloaded public dermatology datasets into our 12-class
ImageFolder layout (data/{train,val}/<class>/*.jpg), reading straight from the
zip files so we never double-extract 18 GB to disk.

Supported sources (each optional, pass the ones you have):
  --dermnet-zip   DermNet          (train/<verbose-name>/, test/<verbose-name>/)
  --acne04-zip    ACNE04           (acne_1024/all_1024/*)                -> acne
  --ham-zip       HAM10000+ISIC    (processed_images + HAM10000_metadata.csv)
  --padufes-zip   PAD-UFES-20      (images/imgs_part_*.zip + metadata.csv)

Only classes a source can label cleanly are emitted; mixed/ambiguous folders are
skipped by design. Run merge_datasets.py --help for flags.
"""

from __future__ import annotations

import argparse
import csv
import io
import logging
import random
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("merge")

CLASS_NAMES = [
    "acne", "eczema", "psoriasis", "rosacea", "seborrheic_keratoses", "tinea",
    "melasma", "vitiligo", "hyperpigmentation", "contact_dermatitis", "warts",
    "actinic_keratosis",
]

_IMG_EXT = (".jpg", ".jpeg", ".png", ".bmp", ".webp")

# DermNet's verbose folder names -> our class (substring match, lowercased).
# None = deliberately skipped (mixed/ambiguous or out-of-scope).
_DERMNET_MAP: list[tuple[str, str | None]] = [
    ("acne and rosacea", "acne"),  # mixed acne+rosacea; acne dominates uploads
    ("atopic dermatitis", "eczema"),
    ("eczema", "eczema"),
    ("psoriasis pictures lichen planus", "psoriasis"),
    ("seborrheic keratoses", "seborrheic_keratoses"),
    ("tinea ringworm candidiasis", "tinea"),
    ("warts molluscum", "warts"),
    ("actinic keratosis basal cell", "actinic_keratosis"),
    # explicitly skipped:
    ("light diseases and disorders of pigmentation", None),  # vitiligo+melasma+PIH mixed
    ("nail fungus", None), ("systemic disease", None), ("vascular tumors", None),
    ("vasculitis", None), ("bullous", None), ("cellulitis", None),
    ("exanthems", None), ("herpes hpv", None), ("lupus", None),
    ("melanoma skin cancer", None), ("poison ivy", None), ("scabies lyme", None),
    ("hair loss", None), ("urticaria hives", None),
]

# HAM10000 dx code -> our class (only the two we can map cleanly).
_HAM_MAP = {"akiec": "actinic_keratosis", "bkl": "seborrheic_keratoses"}

# PAD-UFES-20 diagnostic -> our class.
_PADUFES_MAP = {"ACK": "actinic_keratosis", "SEK": "seborrheic_keratoses"}


def _dermnet_class(folder: str) -> str | None:
    low = folder.lower()
    for needle, cls in _DERMNET_MAP:
        if needle in low:
            return cls
    return None


class Writer:
    """Writes capped, JPEG-normalised images into data/{split}/{class}/."""

    def __init__(self, out: Path, max_per_class: int, val_cap: int, seed: int):
        self.out = out
        self.max_per_class = max_per_class
        self.val_cap = val_cap
        self.rng = random.Random(seed)
        self.train_counts: Counter = Counter()
        self.val_counts: Counter = Counter()

    def is_full(self, split: str, cls: str) -> bool:
        if split == "train":
            return self.max_per_class > 0 and self.train_counts[cls] >= self.max_per_class
        return self.val_cap > 0 and self.val_counts[cls] >= self.val_cap

    def write(self, split: str, cls: str, raw: bytes, name: str) -> bool:
        if cls not in CLASS_NAMES or self.is_full(split, cls):
            return False
        try:
            img = Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception:  # noqa: BLE001 — skip unreadable
            return False
        dest_dir = self.out / split / cls
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{Path(name).stem}.jpg"
        if not dest.exists():
            img.save(dest, format="JPEG", quality=92)
        (self.train_counts if split == "train" else self.val_counts)[cls] += 1
        return True

    def report(self):
        logger.info("=== per-class counts ===")
        for cls in CLASS_NAMES:
            t, v = self.train_counts[cls], self.val_counts[cls]
            if t or v:
                logger.info("  %-22s train=%-4d val=%-4d", cls, t, v)
        missing = [c for c in CLASS_NAMES if not self.train_counts[c] and not self.val_counts[c]]
        total = sum(self.train_counts.values()) + sum(self.val_counts.values())
        logger.info("total=%d  -> %s", total, self.out.resolve())
        if missing:
            logger.warning("no data for: %s", ", ".join(missing))


def ingest_dermnet(zip_path: Path, w: Writer):
    logger.info("DermNet: %s", zip_path)
    with zipfile.ZipFile(zip_path) as z:
        buckets: dict[tuple[str, str], list[str]] = defaultdict(list)
        for n in z.namelist():
            if n.endswith("/") or not n.lower().endswith(_IMG_EXT):
                continue
            parts = n.split("/")
            if len(parts) < 3:
                continue
            split_raw, folder = parts[0].lower(), parts[1]
            cls = _dermnet_class(folder)
            if cls is None:
                continue
            split = "train" if split_raw == "train" else "val"
            buckets[(split, cls)].append(n)
        for (split, cls), names in buckets.items():
            w.rng.shuffle(names)
            for n in names:
                if w.is_full(split, cls):
                    break
                w.write(split, cls, z.read(n), n)


def ingest_acne04(zip_path: Path, w: Writer):
    logger.info("ACNE04: %s", zip_path)
    with zipfile.ZipFile(zip_path) as z:
        names = [
            n for n in z.namelist()
            if "all_1024/" in n and n.lower().endswith(_IMG_EXT) and not n.endswith("/")
        ]
        w.rng.shuffle(names)
        for i, n in enumerate(names):
            split = "val" if i % 7 == 0 else "train"  # ~14% val
            if w.is_full(split, "acne"):
                continue
            w.write(split, "acne", z.read(n), n)


def ingest_ham(zip_path: Path, w: Writer):
    logger.info("HAM10000: %s", zip_path)
    with zipfile.ZipFile(zip_path) as z:
        meta_name = next((n for n in z.namelist() if n.endswith("HAM10000_metadata.csv")), None)
        if not meta_name:
            logger.warning("HAM metadata csv not found; skipping")
            return
        rows = list(csv.DictReader(io.StringIO(z.read(meta_name).decode("utf-8", "replace"))))
        want = {r["image_id"]: _HAM_MAP[r["dx"]] for r in rows if r.get("dx") in _HAM_MAP}
        img_entries = {
            Path(n).stem: n for n in z.namelist()
            if n.lower().endswith(_IMG_EXT) and not n.endswith("/")
        }
        items = [(iid, cls) for iid, cls in want.items() if iid in img_entries]
        w.rng.shuffle(items)
        for i, (iid, cls) in enumerate(items):
            split = "val" if i % 7 == 0 else "train"
            w.write(split, cls, z.read(img_entries[iid]), iid)


def ingest_padufes(zip_path: Path, w: Writer):
    logger.info("PAD-UFES-20: %s", zip_path)
    with zipfile.ZipFile(zip_path) as z:
        meta_name = next((n for n in z.namelist() if n.endswith("metadata.csv")), None)
        if not meta_name:
            logger.warning("PAD-UFES metadata not found; skipping")
            return
        rows = list(csv.DictReader(io.StringIO(z.read(meta_name).decode("utf-8", "replace"))))
        want = {}
        for r in rows:
            diag = (r.get("diagnostic") or r.get("diagnostic_1") or "").strip().upper()
            if diag in _PADUFES_MAP:
                want[r.get("img_id") or r.get("image_id")] = _PADUFES_MAP[diag]
        inner_zips = [n for n in z.namelist() if n.lower().endswith(".zip") and "imgs_part" in n]
        collected = []
        for iz in inner_zips:
            with zipfile.ZipFile(io.BytesIO(z.read(iz))) as inner:
                for n in inner.namelist():
                    if n.endswith("/") or not n.lower().endswith(_IMG_EXT):
                        continue
                    cls = want.get(Path(n).name)
                    if cls:
                        collected.append((cls, inner.read(n), Path(n).name))
        w.rng.shuffle(collected)
        for i, (cls, raw, base) in enumerate(collected):
            split = "val" if i % 7 == 0 else "train"
            w.write(split, cls, raw, base)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="./data")
    ap.add_argument("--dermnet-zip")
    ap.add_argument("--acne04-zip")
    ap.add_argument("--ham-zip")
    ap.add_argument("--padufes-zip")
    ap.add_argument("--max-per-class", type=int, default=0, help="0 = no cap")
    ap.add_argument("--val-cap", type=int, default=0, help="0 = no cap")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    if not any([args.dermnet_zip, args.acne04_zip, args.ham_zip, args.padufes_zip]):
        ap.error("pass at least one --*-zip source")

    w = Writer(Path(args.out), args.max_per_class, args.val_cap, args.seed)
    if args.dermnet_zip:
        ingest_dermnet(Path(args.dermnet_zip), w)
    if args.acne04_zip:
        ingest_acne04(Path(args.acne04_zip), w)
    if args.ham_zip:
        ingest_ham(Path(args.ham_zip), w)
    if args.padufes_zip:
        ingest_padufes(Path(args.padufes_zip), w)
    w.report()


if __name__ == "__main__":
    main()
