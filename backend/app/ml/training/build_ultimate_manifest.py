"""
Build the ULTIMATE unified labels CSV across every downloaded dermatology
dataset in `dataset/`, mapped to our 12 classes — WITHOUT decompressing any
image. It reads zip central directories (entry path + CRC32 + size come for
free) and small metadata CSVs only, then deduplicates identical images by
(CRC32, size) across all archives.

Handles nested archives (a zip inside a zip) by streaming the inner container
to a temp file and reading ITS central directory — still no image bytes are
decoded.

Output columns:
    source     dataset id (dermnet | acne04 | ham | padufes | clinical15 |
               imgclasses | skinclf | skindisnet)
    zip        top-level file inside dataset/  (e.g. "archive (1).zip")
    inner_zip  nested zip path within `zip`, or "" if the image sits directly
               in `zip`
    entry      image path within the innermost container
    label      one of the 12 CLASS_NAMES
    split      train | val
    crc32      hex CRC32 of the (uncompressed) image, from the zip index
    size       uncompressed byte size, from the zip index

A row is located as:  dataset/<zip>  ->  [<inner_zip> ->]  <entry>

Usage:
    python build_ultimate_manifest.py \
        --dataset-dir "../../../../dataset" \
        --out dataset_manifest_ultimate.csv
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import logging
import shutil
import tempfile
import zipfile
from collections import Counter
from contextlib import contextmanager
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("ultimate")

CLASS_NAMES = [
    "acne", "eczema", "psoriasis", "rosacea", "seborrheic_keratoses", "tinea",
    "melasma", "vitiligo", "hyperpigmentation", "contact_dermatitis", "warts",
    "actinic_keratosis",
]

_IMG_EXT = (".jpg", ".jpeg", ".png", ".bmp", ".webp")

# --------------------------------------------------------------------------- #
# Label maps
# --------------------------------------------------------------------------- #

# DermNet verbose folder names -> our class (substring match, lowercased).
_DERMNET_MAP: list[tuple[str, str | None]] = [
    ("acne and rosacea", "acne"),            # mixed acne+rosacea; acne dominates
    ("atopic dermatitis", "eczema"),
    ("eczema", "eczema"),
    ("psoriasis pictures lichen planus", "psoriasis"),
    ("seborrheic keratoses", "seborrheic_keratoses"),
    ("tinea ringworm candidiasis", "tinea"),
    ("warts molluscum", "warts"),
    ("actinic keratosis basal cell", "actinic_keratosis"),
]

# archive (4).zip — 15-class clinical (folder name -> class); others skipped.
_CLINICAL15_MAP = {
    "acne": "acne",
    "actinic keratosis": "actinic_keratosis",
    "ringworm": "tinea",
    "seborrheic keratosis": "seborrheic_keratoses",
    "dyshidrotic eczema": "eczema",
}

# archive_(1).zip — IMG_CLASSES numbered folders (substring match).
_IMGCLASSES_MAP: list[tuple[str, str | None]] = [
    ("warts molluscum", "warts"),
    ("psoriasis pictures lichen planus", "psoriasis"),
    ("seborrheic keratoses", "seborrheic_keratoses"),
    ("benign keratosis-like lesions", "seborrheic_keratoses"),  # BKL, as in HAM
    ("tinea ringworm candidiasis", "tinea"),
    ("atopic dermatitis", "eczema"),
    ("eczema", "eczema"),
]

# Skin Disease Classification Dataset — inner-zip name -> class.
_SKINCLF_MAP = {
    "hyperpigmentation": "hyperpigmentation",
    "acne": "acne",
    "nail_psoriasis": "psoriasis",
    "vitiligo": "vitiligo",
    # "sjs-ten" -> out of scope
}

# SkinDisNet two-letter codes -> class.
_SKINDISNET_MAP = {
    "AD": "eczema",             # Atopic Dermatitis
    "CD": "contact_dermatitis", # Contact Dermatitis
    "EC": "eczema",             # Eczema
    "TC": "tinea",              # Tinea Corporis
    # "SC" Scabies, "SD" Seborrheic Dermatitis -> out of scope
}

_HAM_MAP = {"akiec": "actinic_keratosis", "bkl": "seborrheic_keratoses"}
_PADUFES_MAP = {"ACK": "actinic_keratosis", "SEK": "seborrheic_keratoses"}


def _hashed_split(key: str, val_pct: int = 15) -> str:
    h = int(hashlib.md5(key.encode()).hexdigest(), 16)
    return "val" if (h % 100) < val_pct else "train"


def _is_img(name: str) -> bool:
    return name.lower().endswith(_IMG_EXT) and not name.endswith("/")


@contextmanager
def _open_inner(z: zipfile.ZipFile, inner_name: str):
    """Stream a nested zip member to a temp file and yield it opened, low-RAM."""
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    try:
        with z.open(inner_name) as src:
            shutil.copyfileobj(src, tmp, length=1024 * 1024)
        tmp.close()
        with zipfile.ZipFile(tmp.name) as inner:
            yield inner
    finally:
        Path(tmp.name).unlink(missing_ok=True)


# --------------------------------------------------------------------------- #
# Per-source row generators. Each yields dicts (crc/size taken from the index).
# --------------------------------------------------------------------------- #

def _row(source, zip_name, inner_zip, info, label, split):
    return {
        "source": source,
        "zip": zip_name,
        "inner_zip": inner_zip,
        "entry": info.filename,
        "label": label,
        "split": split,
        "crc32": format(info.CRC, "08x"),
        "size": info.file_size,
    }


def rows_dermnet(path: Path):
    zn = path.name
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            n = info.filename
            if not _is_img(n):
                continue
            parts = n.split("/")
            if len(parts) < 3:
                continue
            low = parts[1].lower()
            cls = next((c for needle, c in _DERMNET_MAP if needle in low), None)
            if cls is None:
                continue
            split = "train" if parts[0].lower() == "train" else "val"
            yield _row("dermnet", zn, "", info, cls, split)


def rows_acne04(path: Path):
    zn = path.name
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            n = info.filename
            if _is_img(n) and "all_1024/" in n:  # canonical set only
                yield _row("acne04", zn, "", info, "acne", _hashed_split(n))


def rows_ham(path: Path):
    zn = path.name
    with zipfile.ZipFile(path) as z:
        meta = next((n for n in z.namelist() if n.endswith("HAM10000_metadata.csv")), None)
        if not meta:
            logger.warning("HAM metadata not found in %s; skipping", zn); return
        dx = {}
        for r in csv.DictReader(io.StringIO(z.read(meta).decode("utf-8", "replace"))):
            c = _HAM_MAP.get((r.get("dx") or "").strip())
            if c:
                dx[r["image_id"]] = c
        for info in z.infolist():
            if not _is_img(info.filename):
                continue
            cls = dx.get(Path(info.filename).stem)
            if cls:
                yield _row("ham", zn, "", info, cls, _hashed_split(info.filename))


def rows_clinical15(path: Path):
    zn = path.name
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            n = info.filename
            if not _is_img(n):
                continue
            parts = n.split("/")
            if len(parts) < 3:
                continue
            split = "val" if parts[0].lower() in ("val", "valid", "test") else "train"
            cls = _CLINICAL15_MAP.get(parts[1].strip().lower())
            if cls:
                yield _row("clinical15", zn, "", info, cls, split)


def rows_imgclasses(path: Path):
    zn = path.name
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            n = info.filename
            if not _is_img(n):
                continue
            parts = n.split("/")
            if len(parts) < 3:
                continue
            low = parts[1].lower()
            cls = next((c for needle, c in _IMGCLASSES_MAP if needle in low), None)
            if cls:
                yield _row("imgclasses", zn, "", info, cls, _hashed_split(n))


def rows_padufes(path: Path):
    zn = path.name
    with zipfile.ZipFile(path) as z:
        meta = next((n for n in z.namelist() if n.endswith("metadata.csv")), None)
        if not meta:
            logger.warning("PAD-UFES metadata not found in %s; skipping", zn); return
        want = {}
        for r in csv.DictReader(io.StringIO(z.read(meta).decode("utf-8", "replace"))):
            diag = (r.get("diagnostic") or r.get("diagnostic_1") or "").strip().upper()
            c = _PADUFES_MAP.get(diag)
            img = r.get("img_id") or r.get("image_id")
            if c and img:
                want[img] = c
        inner_zips = [n for n in z.namelist() if n.lower().endswith(".zip") and "imgs_part" in n]
        if inner_zips:
            for iz in inner_zips:
                with _open_inner(z, iz) as inner:
                    for info in inner.infolist():
                        if not _is_img(info.filename):
                            continue
                        cls = want.get(Path(info.filename).name)
                        if cls:
                            yield _row("padufes", zn, iz, info, cls, _hashed_split(info.filename))
        else:  # flat layout (archive (6).zip): images live directly in the zip
            for info in z.infolist():
                if not _is_img(info.filename):
                    continue
                cls = want.get(Path(info.filename).name)
                if cls:
                    yield _row("padufes", zn, "", info, cls, _hashed_split(info.filename))


def rows_skinclf(path: Path):
    """Skin Disease Classification Dataset: 5 inner zips, one class each."""
    zn = path.name
    with zipfile.ZipFile(path) as z:
        inner_zips = [n for n in z.namelist() if n.lower().endswith(".zip")]
        for iz in inner_zips:
            key = Path(iz).stem.lower()
            cls = _SKINCLF_MAP.get(key)
            if not cls:
                continue
            with _open_inner(z, iz) as inner:
                for info in inner.infolist():
                    if _is_img(info.filename):
                        yield _row("skinclf", zn, iz, info, cls, _hashed_split(info.filename))


def rows_skindisnet_container(path: Path):
    """SkinDisNet wrapper: inner zips each contain AD/CD/EC/SC/SD/TC folders."""
    zn = path.name
    with zipfile.ZipFile(path) as z:
        inner_zips = [n for n in z.namelist() if n.lower().endswith(".zip")]
        for iz in inner_zips:
            with _open_inner(z, iz) as inner:
                yield from _skindisnet_entries(zn, iz, inner)


def rows_skindisnet_flat(path: Path):
    """Standalone SkinDisNet.zip: AD/CD/EC/... folders directly inside."""
    zn = path.name
    with zipfile.ZipFile(path) as z:
        yield from _skindisnet_entries(zn, "", z)


def _skindisnet_entries(zip_name, inner_zip, z):
    for info in z.infolist():
        n = info.filename
        if not _is_img(n):
            continue
        parts = n.split("/")  # e.g. Augmented/CD/xxx.jpg
        code = next((p for p in parts if p in _SKINDISNET_MAP), None)
        cls = _SKINDISNET_MAP.get(code) if code else None
        if cls:
            yield _row("skindisnet", zip_name, inner_zip, info, cls, _hashed_split(n))


# --------------------------------------------------------------------------- #

def _find(dataset_dir: Path, *names: str) -> Path | None:
    for nm in names:
        p = dataset_dir / nm
        if p.exists():
            return p
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dataset-dir", default="../../../../dataset",
                    help="folder holding the dataset archives")
    ap.add_argument("--out", default="dataset_manifest_ultimate.csv")
    ap.add_argument("--keep-dupes", action="store_true",
                    help="do NOT collapse identical images across archives")
    args = ap.parse_args()

    dd = Path(args.dataset_dir).resolve()
    if not dd.is_dir():
        ap.error(f"dataset dir not found: {dd}")

    # (loader, [candidate filenames]) — first existing filename wins.
    sources = [
        (rows_dermnet,               ["archive (1).zip"]),
        (rows_acne04,                ["archive (2).zip"]),
        (rows_ham,                   ["archive (3).zip"]),
        (rows_clinical15,            ["archive (4).zip"]),
        (rows_imgclasses,            ["archive_(1).zip"]),
        (rows_padufes,               ["zr7vgbcyr2-1.zip"]),
        (rows_skinclf,               ["Skin Disease Classification Dataset.zip"]),
        (rows_skindisnet_container,  ["SkinDisNet A Multi-Class Clinical Images and Metad.zip"]),
        (rows_skindisnet_flat,       ["SkinDisNet.zip"]),
    ]

    by_label = Counter()
    by_split = Counter()
    by_source = Counter()
    seen: set[tuple[str, int]] = set()
    dupes = 0
    total = 0

    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(
            fh, fieldnames=["source", "zip", "inner_zip", "entry",
                            "label", "split", "crc32", "size"])
        writer.writeheader()
        for loader, names in sources:
            path = _find(dd, *names)
            if not path:
                logger.warning("missing (skipped): %s", names[0]); continue
            logger.info("scanning %s ...", path.name)
            n = 0
            for row in loader(path):
                key = (row["crc32"], row["size"])
                if not args.keep_dupes and key in seen:
                    dupes += 1
                    continue
                seen.add(key)
                writer.writerow(row)
                by_label[row["label"]] += 1
                by_split[row["split"]] += 1
                by_source[row["source"]] += 1
                n += 1
                total += 1
            logger.info("  %-11s -> %d unique rows", path.name, n)

    logger.info("=== ultimate manifest: %d rows (%d dupes dropped) -> %s ===",
                total, dupes, Path(args.out).resolve())
    logger.info("--- by source ---")
    for s, c in by_source.most_common():
        logger.info("  %-12s %d", s, c)
    logger.info("--- by label (12 classes) ---")
    for cls in CLASS_NAMES:
        logger.info("  %-22s %d", cls, by_label.get(cls, 0))
    missing = [c for c in CLASS_NAMES if not by_label.get(c)]
    logger.info("--- split: train=%d val=%d ---", by_split["train"], by_split["val"])
    if missing:
        logger.warning("NO local data for: %s (Fitzpatrick17k download needed)",
                       ", ".join(missing))


if __name__ == "__main__":
    main()
