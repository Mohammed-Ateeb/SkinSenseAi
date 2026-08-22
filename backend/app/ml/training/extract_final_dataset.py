"""
Materialise the deduplicated ultimate manifest into a self-contained image
folder the trainer consumes directly:

    data/train/<class>/*.jpg
    data/val/<class>/*.jpg

Reads `dataset_manifest_ultimate.csv` (built by build_ultimate_manifest.py),
opens each referenced entry straight from its (possibly nested) zip, converts
to RGB JPEG, and writes it under the class/split folder. Images already present
in data/ (e.g. Fitzpatrick downloads) are kept and counted toward the caps.

Extraction is grouped by container so each big inner zip is opened only once.
Per-class caps keep the final set balanced and the extraction quick on CPU.

Usage:
    python extract_final_dataset.py --manifest dataset_manifest_ultimate.csv \
        --archives . --out ./data --train-cap 2500 --val-cap 400
"""

from __future__ import annotations

import argparse
import csv
import io
import logging
import random
import tempfile
import zipfile
from collections import Counter, defaultdict
from contextlib import contextmanager
from pathlib import Path

from PIL import Image

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("extract")

_IMG_EXT = (".jpg", ".jpeg", ".png", ".bmp", ".webp")
_CHUNK = 256 * 1024  # small chunks: this box can be very low on free RAM


def _count_existing(out: Path) -> Counter:
    c = Counter()
    for split in ("train", "val"):
        base = out / split
        if not base.is_dir():
            continue
        for cls_dir in base.iterdir():
            if cls_dir.is_dir():
                c[(split, cls_dir.name)] += sum(
                    1 for f in cls_dir.iterdir()
                    if f.suffix.lower() in _IMG_EXT
                )
    return c


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", default="dataset_manifest_ultimate.csv")
    ap.add_argument("--archives", default=".", help="folder holding the zip files")
    ap.add_argument("--out", default="./data")
    ap.add_argument("--train-cap", type=int, default=2500, help="max train imgs/class (0=all)")
    ap.add_argument("--val-cap", type=int, default=400, help="max val imgs/class (0=all)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--quality", type=int, default=90)
    args = ap.parse_args()

    arch = Path(args.archives).resolve()
    out = Path(args.out).resolve()
    rng = random.Random(args.seed)

    rows = list(csv.DictReader(open(args.manifest, encoding="utf-8")))
    logger.info("manifest rows: %d", len(rows))

    # Cap per (split, class), accounting for images already on disk.
    existing = _count_existing(out)
    if existing:
        logger.info("images already in %s: %d", out, sum(existing.values()))

    by_bucket: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in rows:
        by_bucket[(r["split"], r["label"])].append(r)

    selected: list[dict] = []
    for (split, cls), items in by_bucket.items():
        cap = args.train_cap if split == "train" else args.val_cap
        rng.shuffle(items)
        take = len(items) if cap <= 0 else max(0, cap - existing.get((split, cls), 0))
        selected.extend(items[:take])
    logger.info("selected for extraction: %d (after caps & existing)", len(selected))

    # Group by container so each (inner) zip opens once. Redirect the giant
    # SkinDisNet wrapper's inner SkinDisNet.zip to the standalone copy (identical
    # entries) so we never have to stream 1.4 GB through 140 MB of free RAM.
    standalone_sdn = "SkinDisNet.zip" if (arch / "SkinDisNet.zip").exists() else None
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in selected:
        zip_name, inner_zip = r["zip"], r["inner_zip"]
        if standalone_sdn and inner_zip.endswith("/SkinDisNet.zip"):
            zip_name, inner_zip = standalone_sdn, ""
        groups[(zip_name, inner_zip)].append(r)

    written = Counter()
    failed = 0
    for (zip_name, inner_zip), grp in sorted(groups.items()):
        zpath = arch / zip_name
        if not zpath.exists():
            logger.warning("missing archive, skipping %d rows: %s", len(grp), zip_name)
            continue
        logger.info("extracting %d from %s%s", len(grp), zip_name,
                    f" :: {inner_zip}" if inner_zip else "")
        with _open_container(zpath, inner_zip) as z:
            failed += _dump(z, grp, out, args.quality, written)

    total = _count_existing(out)
    logger.info("=== final dataset @ %s ===", out)
    classes = sorted({c for (_s, c) in total})
    gt = gv = 0
    for cls in classes:
        t, v = total.get(("train", cls), 0), total.get(("val", cls), 0)
        gt += t; gv += v
        logger.info("  %-22s train=%-5d val=%-4d", cls, t, v)
    logger.info("TOTAL train=%d val=%d  (this run wrote %d, %d failed)",
                gt, gv, sum(written.values()), failed)


@contextmanager
def _open_container(zpath: Path, inner_zip: str):
    """Yield the innermost ZipFile. For nested refs, stream the inner zip to a
    temp file on disk in small chunks (low RAM), then open it; clean up after."""
    with zipfile.ZipFile(zpath) as outer:
        if not inner_zip:
            yield outer
            return
        tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
        tmp_name = tmp.name
        try:
            with outer.open(inner_zip) as src:
                while chunk := src.read(_CHUNK):
                    tmp.write(chunk)
            tmp.close()  # release the handle before reopening (Windows)
            with zipfile.ZipFile(tmp_name) as inner:
                yield inner
        finally:
            if not tmp.closed:
                tmp.close()
            Path(tmp_name).unlink(missing_ok=True)


def _dump(z: zipfile.ZipFile, grp, out: Path, quality: int, written: Counter) -> int:
    failed = 0
    for r in grp:
        dest_dir = out / r["split"] / r["label"]
        dest_dir.mkdir(parents=True, exist_ok=True)
        stem = f"{r['source']}_{r['crc32']}"
        dest = dest_dir / f"{stem}.jpg"
        if dest.exists():
            continue
        try:
            raw = z.read(r["entry"])
            img = Image.open(io.BytesIO(raw)).convert("RGB")
            img.save(dest, format="JPEG", quality=quality)
            written[(r["split"], r["label"])] += 1
        except Exception as e:  # noqa: BLE001
            failed += 1
            logger.debug("skip %s: %s", r["entry"], e)
    return failed


if __name__ == "__main__":
    main()
