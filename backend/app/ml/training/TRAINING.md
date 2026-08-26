# Training SkinSense weights (configurable backbone, 12 classes)

Turns the random-init model into a real classifier. Produces a **self-describing
checkpoint** you point `WEIGHTS_PATH` at — inference reads the architecture and
calibrated temperature straight from the file, so no inference-code or env
changes are needed when you switch backbones. Grad-CAM becomes meaningful the
moment this checkpoint loads.

## Why the first model was weak (and what changed)

The original EfficientNet-B0 run reached only **~47% val top-1**, with several
classes (`contact_dermatitis`, `hyperpigmentation`, `vitiligo`) collapsing to
**0%** — their samples were absorbed by the high-density "attractor" classes
(`actinic_keratosis`, `seborrheic_keratoses`). It was **not** acne-biased; acne
was simply the one class it learned cleanly (93%), so it won ambiguous inputs.
The training code, class order, and preprocessing were all correct — this is a
data + model-capacity problem. The upgraded recipe attacks it with:

- **Bigger backbone** — ConvNeXt-Tiny (default) or EfficientNet-B3, more capacity
  for fine-grained dermatology than B0. All keep 224×224 input so inference
  preprocessing is unchanged.
- **Class-balanced sampling** — a sqrt inverse-frequency `WeightedRandomSampler`
  shows each class roughly equally per epoch (lifts the starved minority classes
  without wildly oversampling the tiny ones).
- **MixUp** — softens the attractor-class collapse and over-confidence.
- Selection on **macro-recall**, temperature calibration (unchanged).

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

Thin notebook that **calls `train.py`'s `run_training`** from the repo (no more
duplicated recipe). Clones the repo, imports the canonical code, and runs it.

- **Colab (GPU):** run the last cell locally to make `data.zip`, upload it to
  `My Drive/SkinSense/data.zip`, then Runtime → GPU and run top to bottom. The
  checkpoint is copied back to Drive so it survives the session.
- Pick the backbone in the run cell (`ARCH = "convnext_tiny"`).

Output: `skinsense_<arch>.pt` (e.g. `skinsense_convnext_tiny.pt`). Copy it to
`backend/weights/` and set `WEIGHTS_PATH=./weights/skinsense_convnext_tiny.pt`.
No `MODEL_ARCH` needed — the checkpoint carries its arch.

## Train it — `train.py` (CLI, canonical recipe)

```bash
pip install -r requirements-train.txt
# recommended upgrade:
python train.py --data ./data --arch convnext_tiny --epochs 30 --out skinsense_convnext_tiny.pt
# lighter alternative / old baseline:
python train.py --data ./data --arch efficientnet_b3 --out skinsense_b3.pt
python train.py --data ./data --arch efficientnet_b0 --out skinsense_b0.pt
```

| Flag | Meaning |
|---|---|
| `--arch` | `convnext_tiny` (default) · `efficientnet_b3` · `efficientnet_b0`. Baked into the checkpoint. |
| `--mixup 0.2` | MixUp alpha; `0` disables. |
| `--no-balanced` | disable class-balanced sampling (falls back to inverse-freq **loss** weights). |
| `--warmup-epochs 3` | train the head only first, then unfreeze the backbone. |
| `--patience 8` | early-stop after N epochs with no val improvement. |
| Selection metric | **macro recall** on val (robust to imbalance), not accuracy. |
| Calibration | fits the temperature scalar on val after training. |

`run_training(...)` is importable directly (the notebook uses it) with the same
keyword arguments.

## Adding data for the empty classes

`melasma` (0 imgs) and `rosacea` (~3) are the weakest slots. Just drop images
into `data/train/<class>/` and `data/val/<class>/` — the sampler, 12-logit head,
and label remap already reserve their indices, so they start training with no
code changes. Aim for a few hundred train images each to make them usable.

## Important caveats

- **Not a medical device.** Labels are folder-level dataset labels, not
  biopsy-confirmed for every image. Treat outputs as educational/triage signal,
  keep the confidence threshold + low-confidence flag, and keep the UI disclaimer.
- **Checkpoint portability:** training always builds a 12-output head in
  `CLASS_NAMES` order and remaps folder labels to that global index, so a
  checkpoint trained on a subset of classes still loads with `strict=True`.
- **Self-describing format:** checkpoints are saved as
  `{"arch", "class_names", "temperature", "state_dict"}`. Legacy bare
  state_dicts still load (arch falls back to `MODEL_ARCH`, default
  `efficientnet_b0`).
