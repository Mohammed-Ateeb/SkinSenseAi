# Training SkinSense weights (12 hormonal/seasonal classes)

Produces a **self-describing checkpoint** you point `WEIGHTS_PATH` at — inference
reads the architecture and calibrated temperature straight from the file, so no
code or env changes are needed when you switch backbones.

## Current model

| | |
|---|---|
| Architecture | ConvNeXt-Tiny |
| Checkpoint | `skinsense_convnext_tiny.pt` |
| **Val macro-recall** | **0.654** |
| Temperature | 0.941 (fitted on val) |
| Training set | ~10,360 train / ~1,370 val, after de-duplication |
| Recipe | 30 epochs, batch 32, lr 3e-4, MixUp 0.2, balanced sampling |

Macro-recall is the metric to quote. Top-1 accuracy looks considerably better
but is dominated by the three large classes and hides the weak ones.

## The 12 classes (order = model output order)

Six hormonal, six seasonal. Defined once in `model_loader.py:CLASS_NAMES`;
everything else derives from it.

| # | Class | Group | Train imgs | Abstention floor |
|--:|---|---|--:|--:|
| 0 | `hormonal_acne` | hormonal | 2,690 | 0.35 |
| 1 | `melasma` | hormonal | 34 | 0.65 |
| 2 | `seborrhea` | hormonal | 125 | 0.50 |
| 3 | `hirsutism` | hormonal | 2 | 0.80 |
| 4 | `acanthosis_nigricans` | hormonal | 69 | 0.60 |
| 5 | `hormonal_hyperpigmentation` | hormonal | 480 | 0.45 |
| 6 | `xerosis` | seasonal | 47 | 0.60 |
| 7 | `eczema_flare` | seasonal | 3,365 | 0.35 |
| 8 | `sunburn` | seasonal | 161 | 0.50 |
| 9 | `miliaria` | seasonal | 27 | 0.65 |
| 10 | `fungal_infection` | seasonal | 3,342 | 0.35 |
| 11 | `chapped_lips` | seasonal | 18 | 0.65 |

**The abstention floor is the honest part.** A single global threshold would
treat every class as equally trustworthy, which they are not: 60% from
`eczema_flare` (3,365 images) is evidence, 60% from `hirsutism` (2 images) is
noise. The floors live in `inference.py:_MIN_CONFIDENCE` and describe the
DATASET, not the conditions — revisit them whenever the counts change.

## Two axes, because a photo cannot answer the question

Six of these classes are hormonal and six are seasonal, and that distinction is
largely **not visible in a photo** — hormonal acne and stress acne look
identical. So the model is only half the system:

- **Axis A — the CNN** reads the image and scores all 12 classes.
- **Axis B — `ml/context_rules.py`** reads the user's free-text description
  ("tiny bumps after sweating", "extra coarse hair on my chin") and reweights
  those scores. Weights are clamped, so words re-rank a close call but never
  overturn a confident photo. No description = exact no-op.

This also carries the classes the CNN cannot learn. `hirsutism` has 2 training
images and will never be predicted from pixels, but "excess coarse hair" is
unambiguous in text.

## Known weaknesses (be honest about these)

Five classes are trained on fewer than 50 images: `hirsutism` (2),
`chapped_lips` (18), `miliaria` (27), `melasma` (34), `xerosis` (47). Their
validation sets are 1-6 images, so any per-class metric for them is noise.
They are the ceiling on macro-recall — no amount of tuning fixes 2 images.

`miliaria` and `hirsutism` are absent from every free dataset we surveyed
(SCIN, Fitzpatrick17k, DermNet, Atlas Dermatologico). They need manual
collection.

## Data sources

| Source | Contributes | Script |
|---|---|---|
| Base merged set | acne, eczema, fungal, hyperpigmentation | `remap_base.py` |
| Atlas Dermatologico | miliaria, xerosis, cheilitis, acanthosis, seborrhoea | `prepare_atlas.py` |
| DermNet (23-class) | melasma, xerosis, acanthosis, seborrhoea, sunburn, hirsutism | `prepare_dermnet.py` |
| SCIN (Google) | real consumer photos, diverse skin tones | `prepare_scin.py` |
| Fitzpatrick17k | *images never obtained — CSV only* | `prepare_fitzpatrick.py` |

De-duplication (`dedup_dataset.py`) runs last and is not optional: the merge
introduced 1,526 duplicates including **441 train/val leaks**, which would have
inflated the reported accuracy.

## How the base set was built (historical record)

The base `data/` tree predates the current taxonomy. Many source archives
(DermNet, ACNE04, HAM10000, PAD-UFES-20, SkinDisNet, a 15-class clinical set,
…) were merged, deduplicated and extracted into an ImageFolder tree of 24,132
images across the OLD dermatological classes.

1. `build_ultimate_manifest.py` scanned every archive and emitted
   `dataset_manifest_ultimate.csv`, deduping by CRC32+size (48,314 unique rows;
   22,540 dupes dropped), handling nested zip-in-zip.
2. `extract_final_dataset.py` wrote the capped, RGB-JPEG tree.
3. `remap_base.py` later folded four of those folders into the new taxonomy
   (acne → hormonal_acne, eczema → eczema_flare, tinea → fungal_infection,
   hyperpigmentation → hormonal_hyperpigmentation) and retired the rest to
   `data/_unused/`. See the current counts in the class table above.

The ~27 GB of source zips were deleted after extraction; `data.zip` is now the
only copy. To rebuild you must re-download the archives — see `docs/DATASETS.md`.

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

`hirsutism` (2 imgs), `chapped_lips` (18), `miliaria` (27), `melasma` (34) and
`xerosis` (47) are the weakest slots. Just drop images
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
