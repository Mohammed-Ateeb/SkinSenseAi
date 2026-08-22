"""
Download Fitzpatrick17k images for the classes DermNet/HAM/PAD can't label,
writing them into the same ImageFolder layout the trainer consumes.

Fitzpatrick17k is a CSV of ~16.5k rows; the `url` column points at two public
dermatology atlases (dermaamin.com, atlasdermatologico.com.br). Many links are
dead now, so this downloads threaded, retries, validates each image, and skips
failures — expect to lose a meaningful fraction.

Of our 5 uncovered classes it can cleanly fill THREE (the other two have no
matching Fitzpatrick label and still need another source):
    rosacea                     <- 'rosacea'
    vitiligo                    <- 'vitiligo'
    contact_dermatitis          <- 'allergic contact dermatitis'
    melasma            -> NOT in Fitzpatrick17k
    hyperpigmentation  -> NOT in Fitzpatrick17k (only specific pigmentary diseases)

Usage (writes into the trainer's data/ dir so a retrain picks it up):
    python download_fitzpatrick.py --csv "C:/Users/you/Downloads/fitzpatrick17k.csv" \
        --out ./data --workers 16

CSV columns: md5hash, fitzpatrick_scale, fitzpatrick_centaur, label,
nine_partition_label, three_partition_label, qc, url, url_alphanum
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import logging
import ssl
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("fitzpatrick")

# Fitzpatrick `label` value -> our class. Only clean 1:1 mappings.
LABEL_MAP = {
    "rosacea": "rosacea",
    "vitiligo": "vitiligo",
    "allergic contact dermatitis": "contact_dermatitis",
}

_UA = "Mozilla/5.0 (research; skin-condition dataset build)"
# Public atlas images; certs are frequently misconfigured, so don't hard-fail on them.
_SSL_CTX = ssl._create_unverified_context()


def _hashed_split(key: str, val_pct: int = 15) -> str:
    h = int(hashlib.md5(key.encode()).hexdigest(), 16)
    return "val" if (h % 100) < val_pct else "train"


def _fetch(url: str, timeout: float, retries: int) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as resp:
                if resp.status != 200:
                    return None
                return resp.read()
        except Exception:  # noqa: BLE001 — dead links are expected; skip
            if attempt == retries:
                return None
    return None


def _download_row(row, out: Path, timeout: float, retries: int) -> tuple[str, bool]:
    cls = LABEL_MAP.get((row.get("label") or "").strip().lower())
    url = (row.get("url") or "").strip()
    md5 = (row.get("md5hash") or "").strip() or hashlib.md5(url.encode()).hexdigest()
    if not cls or not url.startswith("http"):
        return ("", False)
    raw = _fetch(url, timeout, retries)
    if not raw:
        return (cls, False)
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        if min(img.size) < 64:  # reject thumbnails / error placeholders
            return (cls, False)
    except Exception:  # noqa: BLE001
        return (cls, False)
    dest = out / _hashed_split(md5) / cls
    dest.mkdir(parents=True, exist_ok=True)
    img.save(dest / f"fitz_{md5}.jpg", "JPEG", quality=92)
    return (cls, True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--csv", required=True, help="path to fitzpatrick17k.csv")
    ap.add_argument("--out", default="./data", help="ImageFolder root (train/ val/ created)")
    ap.add_argument("--classes", nargs="*", default=sorted(set(LABEL_MAP.values())),
                    help="subset of target classes to download (default: all mappable)")
    ap.add_argument("--max-per-class", type=int, default=0, help="0 = no cap")
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--timeout", type=float, default=10.0)
    ap.add_argument("--retries", type=int, default=1)
    args = ap.parse_args()

    out = Path(args.out)
    want_classes = set(args.classes)
    rows = [
        r for r in csv.DictReader(open(args.csv, encoding="utf-8"))
        if LABEL_MAP.get((r.get("label") or "").strip().lower()) in want_classes
    ]
    # apply per-class cap on candidate rows
    if args.max_per_class:
        seen: Counter = Counter()
        capped = []
        for r in rows:
            c = LABEL_MAP[(r["label"]).strip().lower()]
            if seen[c] < args.max_per_class:
                seen[c] += 1
                capped.append(r)
        rows = capped
    logger.info("candidate rows: %d across %s", len(rows), sorted(want_classes))

    ok, fail = Counter(), Counter()
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(_download_row, r, out, args.timeout, args.retries) for r in rows]
        for f in as_completed(futs):
            cls, success = f.result()
            if cls:
                (ok if success else fail)[cls] += 1
            done += 1
            if done % 100 == 0:
                logger.info("  %d/%d processed…", done, len(rows))

    logger.info("=== done ===")
    for c in sorted(want_classes):
        logger.info("  %-20s downloaded=%-4d failed=%-4d", c, ok[c], fail[c])
    logger.info("total downloaded: %d -> %s", sum(ok.values()), out.resolve())
    if sum(ok.values()) == 0:
        logger.warning("nothing downloaded — atlas links may be blocked from your network.")


if __name__ == "__main__":
    main()
