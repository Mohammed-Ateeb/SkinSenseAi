# Training SkinSense weights (SCIN → EfficientNet-B0)

Turns the random-init model into a real classifier. Produces a checkpoint you
point `WEIGHTS_PATH` at — no inference-code changes needed. Grad-CAM becomes
meaningful the moment this checkpoint loads.

## The 12 classes (order = model output order)

`acne, eczema, psoriasis, rosacea, seborrheic_keratoses, tinea, melasma,
vitiligo, hyperpigmentation, contact_dermatitis, warts, actinic_keratosis`

Defined once in `model_loader.py:CLASS_NAMES`. Everything else derives from it.

## Pipeline

```
prepare_scin.py   SCIN (public GCS) ──►  data/{train,val}/<class>/*.jpg
train.py          ImageFolder       ──►  best_model.pt   (TemperatureScaler state_dict)
inference          WEIGHTS_PATH=best_model.pt
```

## Run it on Colab (GPU)

```python
# 1. Runtime → Change runtime type → GPU
!git clone <your-repo-url> skinsense && cd skinsense/backend/app/ml
!pip install -r requirements-train.txt

# 2. Build the dataset from SCIN (public bucket, no auth).
#    --dry-run first to see how many images each class yields.
!python prepare_scin.py --out ./data --dry-run
!python prepare_scin.py --out ./data --min-weight 0.5 --max-per-class 800

# 3. Fine-tune from ImageNet weights.
!python train.py --data ./data --epochs 25 --batch-size 32 --out best_model.pt

# 4. Download best_model.pt, then serve it:
#    set WEIGHTS_PATH=/abs/path/best_model.pt in the backend env.
```

## Key knobs

| Flag (`prepare_scin.py`) | Meaning |
|---|---|
| `--min-weight 0.5` | keep a case only if its top dermatologist condition weight >= this. Raise for cleaner labels, fewer images. |
| `--max-per-class 800` | cap per class to curb imbalance and download size (`0` = no cap). |
| `--dry-run` | print per-class counts, download nothing. |

| Flag (`train.py`) | Meaning |
|---|---|
| `--warmup-epochs 3` | train the head only first, then unfreeze the backbone. |
| `--patience 6` | early-stop after N epochs with no val improvement. |
| Selection metric | **macro recall** on val (robust to class imbalance), not raw accuracy. |
| Calibration | fits the temperature scalar on val after training (already wired into `TemperatureScaler`). |

## Important caveats

- **SCIN won't cover all 12 classes cleanly.** Melasma, contact dermatitis, and
  hyperpigmentation are sparse; `prepare_scin.py` warns which classes got zero
  images. The model still outputs 12 logits — classes with no data just never
  get predicted. Backfill them from DermNet / ISIC / your own images by dropping
  more JPEGs into `data/train/<class>/` and `data/val/<class>/`.
- **This is not a medical device.** SCIN is crowdsourced consumer photos with
  weighted differentials, not biopsy-confirmed labels. Treat outputs as
  educational/triage signal, keep the existing confidence thresholds and
  low-confidence flag, and keep the disclaimer in the UI.
- **Checkpoint portability:** `train.py` always builds a 12-output head in
  `CLASS_NAMES` order and remaps folder labels to that global index, so a
  checkpoint trained on a subset of classes still loads with `strict=True`.
