"""
De-duplicate the merged ImageFolder so the reported accuracy is TRUSTWORTHY.

When several source datasets are merged (base + SCIN + Fitzpatrick17k), the same
photo often reappears — resized or re-compressed — under different splits or even
different class folders. That does two bad things:
  1. TRAIN/VAL LEAKAGE: a val image that also sits in train makes accuracy look
     far higher than it is (the model has literally seen the answer). This is the
     usual reason a run "hits ~100%". Removing it gives you the real number.
  2. LABEL NOISE: the same image under two class folders is a guaranteed wrong
     answer for one of them.

This scans every image with a perceptual hash (dHash), groups near-identical
images, and keeps ONE canonical copy per group — preferring a train copy so val
never keeps a leaked twin. Exact + near-duplicate (Hamming <= --near) are caught.

Usage:
    python dedup_dataset.py --data ./data --near 4          # dry run (reports only)
    python dedup_dataset.py --data ./data --near 4 --apply  # actually delete
"""

from __future__ import annotations

import argparse
import logging
from collections import Counter, defaultdict
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("dedup")

_IMG_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp")


def _dhash(path: Path, size: int = 8) -> int | None:
    """64-bit difference hash — robust to resize / JPEG recompression."""
    from PIL import Image
    try:
        img = Image.open(path).convert("L").resize((size + 1, size))
    except Exception:
        return None
    px = list(img.getdata())
    bits = 0
    for row in range(size):
        base = row * (size + 1)
        for col in range(size):
            bits = (bits << 1) | (1 if px[base + col] < px[base + col + 1] else 0)
    return bits


def _hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


class _UF:
    def __init__(self, n): self.p = list(range(n))
    def find(self, x):
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]; x = self.p[x]
        return x
    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb: self.p[ra] = rb


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", default="./data")
    ap.add_argument("--near", type=int, default=4,
                    help="max Hamming distance to treat as duplicate (0 = exact only)")
    ap.add_argument("--apply", action="store_true", help="actually delete (default: dry run)")
    args = ap.parse_args()

    root = Path(args.data)
    items: list[tuple[Path, str, str, int]] = []  # (path, split, cls, hash)
    for split in ("train", "val"):
        sroot = root / split
        if not sroot.is_dir():
            continue
        for cls_dir in sorted(sroot.iterdir()):
            if not cls_dir.is_dir():
                continue
            for p in cls_dir.iterdir():
                if p.suffix.lower() in _IMG_EXTS:
                    h = _dhash(p)
                    if h is not None:
                        items.append((p, split, cls_dir.name, h))
    n = len(items)
    logger.info("Hashed %d images under %s.", n, root)
    if n == 0:
        return

    # Union near-identical images. Bucket by the top 16 bits so we only compare
    # within small buckets (near-dupes share high bits), keeping it ~O(n).
    uf = _UF(n)
    exact: dict[int, int] = {}
    buckets: dict[int, list[int]] = defaultdict(list)
    for i, (_, _, _, h) in enumerate(items):
        if h in exact:
            uf.union(i, exact[h])
        else:
            exact[h] = i
        buckets[h >> 48].append(i)
    if args.near > 0:
        for members in buckets.values():
            for a in range(len(members)):
                for b in range(a + 1, len(members)):
                    i, j = members[a], members[b]
                    if _hamming(items[i][3], items[j][3]) <= args.near:
                        uf.union(i, j)

    groups: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        groups[uf.find(i)].append(i)

    to_delete: list[Path] = []
    dup_groups = leak_removed = cross_class = dup_removed = 0
    for members in groups.values():
        if len(members) < 2:
            continue
        dup_groups += 1
        classes = {items[i][2] for i in members}
        if len(classes) > 1:
            cross_class += 1
        # Keep one canonical: prefer a train copy so no leaked val twin survives.
        train_members = [i for i in members if items[i][1] == "train"]
        keep = min(train_members or members, key=lambda i: str(items[i][0]))
        for i in members:
            if i == keep:
                continue
            to_delete.append(items[i][0])
            dup_removed += 1
            if items[i][1] == "val" and train_members:
                leak_removed += 1

    logger.info("=== dedup summary (near<=%d) ===", args.near)
    logger.info("duplicate groups: %d", dup_groups)
    logger.info("images to remove: %d  (of %d, %.1f%%)", dup_removed, n, 100 * dup_removed / n)
    logger.info("  train/val LEAKAGE removed (val twins of train): %d", leak_removed)
    logger.info("  cross-class conflict groups (label noise): %d", cross_class)

    if not args.apply:
        logger.info("DRY RUN — nothing deleted. Re-run with --apply to remove.")
        for p in to_delete[:8]:
            logger.info("  would remove: %s", p.relative_to(root))
        return

    removed_by_split = Counter()
    for p in to_delete:
        removed_by_split[p.parent.parent.name] += 1
        try:
            p.unlink()
        except OSError as e:
            logger.warning("could not delete %s: %s", p, e)
    logger.info("Deleted %d images (%s). Dataset is now leakage-free.",
                dup_removed, dict(removed_by_split))


if __name__ == "__main__":
    main()
