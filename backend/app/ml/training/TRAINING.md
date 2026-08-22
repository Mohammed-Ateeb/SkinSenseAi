# Training SkinSense weights (EfficientNet-B0, 12 classes)

Turns the random-init model into a real classifier. Produces a checkpoint you
point `WEIGHTS_PATH` at — no inference-code changes needed. Grad-CAM becomes
meaningful the moment this checkpoint loads.

## The 12 classes (order = model output order)

`acne, eczema, psoriasis, rosacea, seborrheic_keratoses, tinea, melasma,
vitiligo, hyperpigmentation, contact_dermatitis, warts, actinic_keratosis`

Defined once in `model_loader.py:CLASS_NAMES`. Everything else derives from it.

## The final dataset (`data/`)

The many source archives (DermNet, ACNE04, HAM10000, PAD-UFES-20, SkinDisNet,
Skin Disease Classification, a 15-class clinical set, IMG_CLASSES, …) were
merged, deduplicated and mapped to the 12 classes, then **extracted once** into a
self-contained ImageFolder tree:

```
data/train/<class>/*.jpg
data/val/<class>/*.jpg
```

**Current set: 24,132 images (20,692 train / 3,440 val), 11 classes**, balanced
at ≤2,500 train / 400 val per class:

| class | train | class | train |
|---|--:|---|--:|
| acne | 2500 | seborrheic_keratoses | 2500 |
| eczema | 2500 | tinea | 2500 |
| actinic_keratosis | 2500 | contact_dermatitis | 2500 |
| psoriasis | 1906 | vitiligo | 1693 |
| warts | 1519 | hyperpigmentation | 571 |
| rosacea | 3 | melasma | 0 |

**`melasma` has no images and `rosacea` only 3** — they exist only in the
URL-based Fitzpatrick17k set (most source URLs are dead). Backfill via
`download_fitzpatrick.py`, or drop JPEGs into `data/{train,val}/<class>/`.

### How `data/` was built (record — the raw zips have been deleted)

1. `build_ultimate_manifest.py` scanned every archive and emitted
   `dataset_manifest_ultimate.csv` (cols `source,zip,inner_zip,entry,label,
   split,crc32,size`), deduping identical images by CRC32+size (48,314 unique
   rows; 22,540 dupes dropped), handling nested zip-in-zip.
2. `extract_final_dataset.py` read that manifest and wrote the capped, RGB-JPEG
   ImageFolder tree above.

The ~27 GB of source zips were removed after extraction. To rebuild `data/` (or
re-extract with different caps) you must re-download the archives first — see
`docs/DATASETS.md`.

## Train it — `SkinSense_Train.ipynb` (recommended)

Self-contained notebook, same architecture as `model_loader.py` (so the
checkpoint loads with `strict=True`).

- **Locally:** open the notebook, run top to bottom (skip the Colab upload cell).
- **Colab (GPU):** run the last cell locally to make `data.zip`, upload it, then
  Runtime → GPU and run top to bottom.

Output: `skinsense_efficientnet_b0.pt`. Copy it to `backend/weights/` and set
`WEIGHTS_PATH=./weights/skinsense_efficientnet_b0.pt`.

## Train it — `train.py` (CLI, same logic)

```bash
pip install -r requirements-train.txt
python train.py --data ./data --epochs 25 --batch-size 32 --out skinsense_efficientnet_b0.pt
```

| Flag | Meaning |
|---|---|
| `--warmup-epochs 3` | train the head only first, then unfreeze the backbone. |
| `--patience 6` | early-stop after N epochs with no val improvement. |
| Selection metric | **macro recall** on val (robust to imbalance), not accuracy. |
| Calibration | fits the temperature scalar on val after training. |

## Important caveats

- **Two classes are effectively unlearnable here:** `melasma` (0 imgs) and
  `rosacea` (3). The model still outputs 12 logits — absent classes get class
  weight 0 and are simply never predicted.
- **Not a medical device.** Labels are folder-level dataset labels, not
  biopsy-confirmed for every image. Treat outputs as educational/triage signal,
  keep the confidence threshold + low-confidence flag, and keep the UI disclaimer.
- **Checkpoint portability:** training always builds a 12-output head in
  `CLASS_NAMES` order and remaps folder labels to that global index, so a
  checkpoint trained on a subset of classes still loads with `strict=True`.
