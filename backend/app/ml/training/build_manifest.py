"""
Build ONE unified labels CSV across all downloaded dermatology datasets, mapped
to our 12 classes — without extracting any images (just reads zip listings +
metadata CSVs, so it runs in seconds).

Output columns:
    source   dataset id: dermnet | acne04 | ham | padufes
    ref      how to locate the image within that source's zip
             - dermnet/acne04/ham: the exact zip entry path
             - padufes:            the image filename (inside images/imgs_part_*.zip)
    label    one of the 12 CLASS_NAMES
    split    train | val   (DermNet keeps its own split; others ~15% hashed val)

Usage:
    python build_manifest.py \
        --dermnet-zip ".../archive (1).zip" \
        --acne04-zip  ".../archive (2).zip" \
        --ham-zip     ".../archive (3).zip" \
        --padufes-zip ".../zr7vgbcyr2-1.zip" \
        --out dataset_manifest.csv
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import logging
import zipfile
from collections import Counter
from pathlib import Path

from merge_datasets import (
    _HAM_MAP,
    _IMG_EXT,
    _PADUFES_MAP,
    _dermnet_class,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("manifest")


def _hashed_split(key: str, val_pct: int = 15) -> str:
    h = int(hashlib.md5(key.encode()).hexdigest(), 16)
    return "val" if (h % 100) < val_pct else "train"


def rows_dermnet(zip_path: Path):
    with zipfile.ZipFile(zip_path) as z:
        for n in z.namelist():
            if n.endswith("/") or not n.lower().endswith(_IMG_EXT):
                continue
            parts = n.split("/")
            if len(parts) < 3:
                continue
            cls = _dermnet_class(parts[1])
            if cls is None:
                continue
            split = "train" if parts[0].lower() == "train" else "val"
            yield ("dermnet", n, cls, split)


def rows_acne04(zip_path: Path):
    with zipfile.ZipFile(zip_path) as z:
        for n in z.namelist():
            if "all_1024/" in n and n.lower().endswith(_IMG_EXT) and not n.endswith("/"):
                yield ("acne04", n, "acne", _hashed_split(n))


def rows_ham(zip_path: Path):
    with zipfile.ZipFile(zip_path) as z:
        meta = next((n for n in z.namelist() if n.endswith("HAM10000_metadata.csv")), None)
        if not meta:
            logger.warning("HAM metadata not found; skipping"); return
        entries = {
            Path(n).stem: n for n in z.namelist()
            if n.lower().endswith(_IMG_EXT) and not n.endswith("/")
        }
        reader = csv.DictReader(io.StringIO(z.read(meta).decode("utf-8", "replace")))
        for r in reader:
            cls = _HAM_MAP.get(r.get("dx"))
            entry = entries.get(r.get("image_id"))
            if cls and entry:
                yield ("ham", entry, cls, _hashed_split(entry))


def rows_padufes(zip_path: Path):
    with zipfile.ZipFile(zip_path) as z:
        meta = next((n for n in z.namelist() if n.endswith("metadata.csv")), None)
        if not meta:
            logger.warning("PAD-UFES metadata not found; skipping"); return
        reader = csv.DictReader(io.StringIO(z.read(meta).decode("utf-8", "replace")))
        for r in reader:
            diag = (r.get("diagnostic") or r.get("diagnostic_1") or "").strip().upper()
            cls = _PADUFES_MAP.get(diag)
            img = r.get("img_id") or r.get("image_id")
            if cls and img:
                yield ("padufes", img, cls, _hashed_split(img))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="dataset_manifest.csv")
    ap.add_argument("--dermnet-zip")
    ap.add_argument("--acne04-zip")
    ap.add_argument("--ham-zip")
    ap.add_argument("--padufes-zip")
    args = ap.parse_args()

    generators = []
    if args.dermnet_zip:
        generators.append(("DermNet", rows_dermnet, Path(args.dermnet_zip)))
    if args.acne04_zip:
        generators.append(("ACNE04", rows_acne04, Path(args.acne04_zip)))
    if args.ham_zip:
        generators.append(("HAM10000", rows_ham, Path(args.ham_zip)))
    if args.padufes_zip:
        generators.append(("PAD-UFES-20", rows_padufes, Path(args.padufes_zip)))
    if not generators:
        ap.error("pass at least one --*-zip source")

    by_label = Counter()
    by_split = Counter()
    total = 0
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["source", "ref", "label", "split"])
        for name, gen, path in generators:
            n = 0
            for row in gen(path):
                writer.writerow(row)
                by_label[row[2]] += 1
                by_split[row[3]] += 1
                n += 1
                total += 1
            logger.info("%-12s -> %d rows", name, n)

    logger.info("=== manifest: %d rows -> %s ===", total, Path(args.out).resolve())
    for lbl, c in by_label.most_common():
        logger.info("  %-22s %d", lbl, c)
    logger.info("  split: train=%d val=%d", by_split["train"], by_split["val"])


if __name__ == "__main__":
    main()
