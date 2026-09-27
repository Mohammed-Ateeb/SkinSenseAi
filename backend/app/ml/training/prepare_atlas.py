"""
Pull Atlas Dermatologico into the BALANCED ImageFolder for retraining.

Atlas Dermatologico (atlasdermatologico.com.br) is a free teaching atlas with
~593 conditions, and it is one of the two sources the published Fitzpatrick17k
dataset was built from. The other one, DermaAmin, is now offline — which is why
most Fitzpatrick17k image URLs are dead. Atlas is still up, so it is currently
the best free source for the classes no ML dataset covers: miliaria, xerosis,
cheilitis and acanthosis nigricans.

How it works (the site is a JSF app, so URLs are not guessable):
    browse.jsf                      -> condition name  -> diseaseId
    disease.jsf?diseaseId=<id>      -> a set of img?imageId=<n> references
    img?imageId=<n>                 -> the JPEG itself

Usage:
    pip install pillow tqdm
    python prepare_atlas.py --out ./data --per-class 400
    python prepare_atlas.py --dry-run          # just report what is available

Curation matters more than volume here. Plain substring matching on this atlas
pulls in look-alikes that would poison a class — "seborrheic keratosis" is a
benign tumour, not seborrhoea; "xeroderma pigmentosum" and "ichthyosis" are
genetic disorders, not seasonal dry skin. _CLASS_RULES therefore pairs an
include list with an explicit exclude list, and anything unmatched is skipped.

Be polite to a free academic server: requests are rate-limited (--delay).
"""

from __future__ import annotations

import argparse
import html
import http.cookiejar
import io
import logging
import random
import re
import time
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("prepare_atlas")

BASE = "http://atlasdermatologico.com.br"
_UA = {"User-Agent": "Mozilla/5.0 (compatible; SkinSense research dataset build)"}

CLASS_NAMES = [
    # hormonal group
    "hormonal_acne", "melasma", "seborrhea", "hirsutism",
    "acanthosis_nigricans", "hormonal_hyperpigmentation",
    # seasonal group
    "xerosis", "eczema_flare", "sunburn", "miliaria",
    "fungal_infection", "chapped_lips",
]

# include: condition-name substrings to accept
# exclude: substrings that veto a match even when `include` hits
_CLASS_RULES: dict[str, dict[str, tuple[str, ...]]] = {
    "hormonal_acne": {
        "include": ("acne",),
        # acne rosacea is rosacea; keloidalis is a scarring folliculitis
        "exclude": ("rosacea", "keloidalis", "urticata"),
    },
    "melasma": {"include": ("melasma", "chloasma"), "exclude": ()},
    "seborrhea": {
        "include": ("seborrhoeic dermatitis", "seborrheic dermatitis"),
        # seborrheic KERATOSIS is a benign tumour — a completely different thing
        "exclude": ("keratos",),
    },
    "hirsutism": {"include": ("hirsut", "hypertrichos"), "exclude": ()},
    "acanthosis_nigricans": {"include": ("acanthosis nigricans",), "exclude": ()},
    "hormonal_hyperpigmentation": {
        "include": ("hyperpigmentation", "melanosis"),
        # hypo- is the opposite of what we want; drug-induced is not hormonal
        "exclude": ("hypo", "amiodarone", "drug"),
    },
    "xerosis": {
        "include": ("asteatotic",),
        # ichthyosis / xeroderma pigmentosum are genetic, not seasonal dryness
        "exclude": ("ichthyos", "pigmentosum", "harlequim", "harlequin"),
    },
    "eczema_flare": {
        "include": ("atopic dermatitis", "eczema", "eczematid"),
        # herpeticum is a viral superinfection and looks nothing like a flare
        "exclude": ("herpeticum",),
    },
    "sunburn": {
        "include": ("sunburn", "polymorphous light", "phytophotodermat",
                    "photodermat"),
        # "keratosis solar" is actinic keratosis, not a burn
        "exclude": ("keratos", "lentigo", "acanthoma"),
    },
    "miliaria": {"include": ("miliaria",), "exclude": ()},
    "fungal_infection": {
        "include": ("tinea", "candidiasis", "pityriasis versicolor", "dermatophyt"),
        "exclude": (),
    },
    "chapped_lips": {
        "include": ("cheilitis",),
        "exclude": ("pseudo-epitheliomatous",),
    },
}


def _opener():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def _get(op, url: str, timeout: int = 45) -> bytes:
    return op.open(urllib.request.Request(url, headers=_UA), timeout=timeout).read()


def _text(op, url: str) -> str:
    return _get(op, url).decode("utf-8", "replace")


def _match(name: str) -> str | None:
    low = name.strip().lower()
    for cls, rules in _CLASS_RULES.items():
        if any(x in low for x in rules["exclude"]):
            continue
        if any(x in low for x in rules["include"]):
            return cls
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="./data")
    ap.add_argument("--per-class", type=int, default=400, help="cap per class")
    ap.add_argument("--val-frac", type=float, default=0.15)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--delay", type=float, default=0.25,
                    help="seconds between requests — be kind to a free server")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would be downloaded, write nothing")
    args = ap.parse_args()

    from PIL import Image
    from tqdm import tqdm

    op = _opener()
    logger.info("Fetching condition index …")
    index = _text(op, f"{BASE}/browse.jsf")
    pairs = re.findall(
        r'diseaseId=(\d+)"[^>]*>\s*<span itemprop="name">([^<]+)</span>', index
    )
    if not pairs:
        raise SystemExit("could not parse the condition index — the site layout changed")
    logger.info("Indexed %d conditions.", len(pairs))

    # condition -> class
    wanted: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for did, raw in pairs:
        name = html.unescape(raw).strip()
        cls = _match(name)
        if cls:
            wanted[cls].append((name, int(did)))

    for cls in CLASS_NAMES:
        names = [n for n, _ in wanted.get(cls, [])]
        logger.info("  %-28s %2d condition(s) %s", cls, len(names),
                    ", ".join(names[:4]) + (" …" if len(names) > 4 else ""))

    # collect image ids per class
    logger.info("Collecting image ids …")
    per_class_ids: dict[str, list[int]] = defaultdict(list)
    for cls, conds in wanted.items():
        for name, did in conds:
            try:
                page = _text(op, f"{BASE}/disease.jsf?diseaseId={did}")
            except Exception as e:  # noqa: BLE001
                logger.warning("  skip %s: %s", name, str(e)[:60])
                continue
            ids = sorted({int(x) for x in re.findall(r'img\?imageId=(\d+)"', page)})
            per_class_ids[cls].extend(ids)
            time.sleep(args.delay)

    total = sum(len(v) for v in per_class_ids.values())
    logger.info("=== available on Atlas ===")
    for cls in CLASS_NAMES:
        logger.info("  %-28s %4d", cls, len(per_class_ids.get(cls, [])))
    logger.info("  %-28s %4d", "TOTAL", total)

    if args.dry_run:
        logger.info("DRY RUN — nothing downloaded.")
        return

    out = Path(args.out)
    rng = random.Random(args.seed)
    tr, va = Counter(), Counter()
    for cls in CLASS_NAMES:
        ids = sorted(set(per_class_ids.get(cls, [])))
        rng.shuffle(ids)
        ids = ids[: args.per_class]
        n_val = max(1, int(len(ids) * args.val_frac)) if ids else 0
        for i, img_id in enumerate(tqdm(ids, desc=cls, unit="img")):
            split = "val" if i < n_val else "train"
            d = out / split / cls
            d.mkdir(parents=True, exist_ok=True)
            dest = d / f"atlas_{img_id}.jpg"
            if dest.exists():
                (va if split == "val" else tr)[cls] += 1
                continue
            try:
                raw = _get(op, f"{BASE}/img?imageId={img_id}")
                Image.open(io.BytesIO(raw)).convert("RGB").save(dest, "JPEG", quality=92)
                (va if split == "val" else tr)[cls] += 1
            except Exception as e:  # noqa: BLE001
                logger.warning("skip imageId=%s: %s", img_id, str(e)[:60])
            time.sleep(args.delay)

    logger.info("=== Atlas added ===")
    for c in CLASS_NAMES:
        if tr[c] or va[c]:
            logger.info("  %-28s train=%-4d val=%-4d", c, tr[c], va[c])
    logger.info("total=%d -> %s", sum(tr.values()) + sum(va.values()), out.resolve())
    absent = [c for c in CLASS_NAMES if not tr[c] and not va[c]]
    if absent:
        logger.warning("Atlas had none for: %s", ", ".join(absent))


if __name__ == "__main__":
    main()
