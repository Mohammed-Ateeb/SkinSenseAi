"""
Remap the existing base dataset onto the new 12-class taxonomy.

The base merged set (~24k images) was built for the OLD dermatological taxonomy
(acne, eczema, psoriasis, tinea, vitiligo, warts, ...). The model now classifies
12 hormonal/seasonal conditions instead. Four of the old folders are the same
pictures under a new name, so they can simply be renamed — no re-downloading:

    acne               -> hormonal_acne
    eczema             -> eczema_flare
    tinea              -> fungal_infection
    hyperpigmentation  -> hormonal_hyperpigmentation

Everything else in the old set (psoriasis, rosacea, seborrheic_keratoses,
vitiligo, warts, actinic_keratosis) has no home in the new taxonomy. Those are
MOVED ASIDE into data/_unused/ rather than deleted, so this step is reversible
and nothing is lost.

    contact_dermatitis is the one judgement call. It is eczematous and would add
    ~2,900 images to eczema_flare, but it is an allergic reaction rather than a
    seasonal flare, so folding it in blurs the class. Off by default; enable with
    --fold-contact-dermatitis if you decide volume matters more than purity.

Usage:
    python remap_base.py --data ./data              # dry run, shows the plan
    python remap_base.py --data ./data --apply      # actually move
    python remap_base.py --data ./data --apply --fold-contact-dermatitis
"""

from __future__ import annotations

import argparse
import logging
import shutil
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("remap_base")

# old folder -> new class folder
RENAMES: dict[str, str] = {
    "acne": "hormonal_acne",
    "eczema": "eczema_flare",
    "tinea": "fungal_infection",
    "hyperpigmentation": "hormonal_hyperpigmentation",
}

# old folders with no equivalent in the new taxonomy
RETIRE: tuple[str, ...] = (
    "psoriasis", "rosacea", "seborrheic_keratoses", "vitiligo", "warts",
    "actinic_keratosis",
)

# only folded into eczema_flare when explicitly asked for
OPTIONAL_FOLD = {"contact_dermatitis": "eczema_flare"}

NEW_CLASSES = {
    "hormonal_acne", "melasma", "seborrhea", "hirsutism",
    "acanthosis_nigricans", "hormonal_hyperpigmentation",
    "xerosis", "eczema_flare", "sunburn", "miliaria",
    "fungal_infection", "chapped_lips",
}

_IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def _count(d: Path) -> int:
    return sum(1 for p in d.iterdir() if p.suffix.lower() in _IMG_EXTS) if d.is_dir() else 0


def _move_contents(src: Path, dst: Path, apply: bool) -> int:
    """Move every image from src into dst, renaming on collision."""
    if not src.is_dir():
        return 0
    moved = 0
    if apply:
        dst.mkdir(parents=True, exist_ok=True)
    for p in list(src.iterdir()):
        if p.suffix.lower() not in _IMG_EXTS:
            continue
        if apply:
            target = dst / p.name
            if target.exists():                       # keep both, never overwrite
                target = dst / f"{src.name}_{p.name}"
            shutil.move(str(p), str(target))
        moved += 1
    if apply:
        try:
            if not any(src.iterdir()):
                src.rmdir()
        except OSError:
            pass
    return moved


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", default="./data")
    ap.add_argument("--apply", action="store_true", help="actually move (default: dry run)")
    ap.add_argument("--fold-contact-dermatitis", action="store_true",
                    help="fold contact_dermatitis into eczema_flare (adds volume, blurs the class)")
    args = ap.parse_args()

    root = Path(args.data)
    if not root.is_dir():
        raise SystemExit(f"no dataset at {root}")

    plan = dict(RENAMES)
    if args.fold_contact_dermatitis:
        plan.update(OPTIONAL_FOLD)

    total_moved = total_retired = 0
    for split in ("train", "val"):
        sroot = root / split
        if not sroot.is_dir():
            continue
        logger.info("=== %s ===", split)

        # 1. renames / folds
        for old, new in plan.items():
            src, dst = sroot / old, sroot / new
            n = _count(src)
            if n == 0:
                continue
            existing = _count(dst)
            logger.info("  %-22s -> %-28s %5d imgs%s",
                        old, new, n,
                        f"  (merging into {existing} existing)" if existing else "")
            total_moved += _move_contents(src, dst, args.apply)

        # 2. retire everything with no new home
        for old in RETIRE:
            src = sroot / old
            n = _count(src)
            if n == 0:
                continue
            dst = root / "_unused" / split / old
            logger.info("  %-22s -> %-28s %5d imgs", old, f"_unused/{split}/{old}", n)
            total_retired += _move_contents(src, dst, args.apply)

        # 3. anything left that is neither known-old nor a new class
        if sroot.is_dir():
            for d in sorted(p for p in sroot.iterdir() if p.is_dir()):
                if d.name in NEW_CLASSES or d.name in plan or d.name in RETIRE:
                    continue
                if d.name in OPTIONAL_FOLD:
                    logger.info("  %-22s    left as-is (%d imgs) — pass "
                                "--fold-contact-dermatitis to merge into %s",
                                d.name, _count(d), OPTIONAL_FOLD[d.name])
                    continue
                logger.warning("  %-22s    unrecognised — left untouched (%d imgs)",
                               d.name, _count(d))

    logger.info("---")
    logger.info("moved into new classes : %d", total_moved)
    logger.info("retired to _unused/    : %d", total_retired)
    if not args.apply:
        logger.info("DRY RUN — nothing was moved. Re-run with --apply.")
        return

    logger.info("Done. _unused/ is kept so this is reversible.")
    for split in ("train", "val"):
        sroot = root / split
        if not sroot.is_dir():
            continue
        logger.info("=== %s after remap ===", split)
        for cls in sorted(NEW_CLASSES):
            logger.info("  %-28s %5d", cls, _count(sroot / cls))


if __name__ == "__main__":
    main()
