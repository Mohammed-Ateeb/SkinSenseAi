# SkinSense ML — EfficientNet-B0 Inference Service

Real PyTorch inference replacing the mock `/predict` endpoint.  
6 target classes: **Acne · Eczema · Psoriasis · Rosacea · Seborrheic Keratoses · Tinea**

---

## File map → `multimodel-skincare/app/`

```
deliverables/backend/ml/          →  multimodel-skincare/app/ml/
  __init__.py                          __init__.py
  model_loader.py                      model_loader.py
  preprocessing.py                     preprocessing.py
  inference.py                         inference.py
  router.py                            router.py   (replaces app/routes/predict.py)
```

After copying, update `app/main.py`:

```python
# Remove the old fake import:
# from app.routes import upload, predict

# Add the real ML router:
from app.routes import upload
from app.ml import router as ml_router

app.include_router(upload.router)
app.include_router(ml_router)          # exposes POST /predict
```

---

## Loading model weights

Train EfficientNet-B0 on your dataset and save the state-dict:

```python
torch.save(model.state_dict(), "weights/skinsense_effb0.pth")
```

Then set the env var before starting uvicorn:

```
WEIGHTS_PATH=weights/skinsense_effb0.pth
```

The loader accepts both:
- **full TemperatureScaler state-dict** (if you saved `model.state_dict()` after wrapping)
- **bare backbone state-dict** (if you saved just the EfficientNet-B0 weights)

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `USE_MOCK_MODEL` | `false` | `true` → skip inference, return deterministic fake scores |
| `WEIGHTS_PATH` | *(none)* | Path to trained `.pth` state-dict |
| `TEMPERATURE` | `1.5` | Temperature-scaling divisor (post-hoc calibration) |
| `CONFIDENCE_THRESHOLD` | `0.50` | Below this → `confidence_threshold_met: false` |
| `LOW_CONFIDENCE_THRESHOLD` | `0.35` | Below this → `low_confidence_flag: true` |
| `MODEL_VERSION` | `efficientnet-b0-6cls-v1` | Version tag returned in the response |

---

## Temperature calibration

Temperature scaling divides model logits by `T` before softmax, producing better-calibrated probability estimates. The default `T=1.5` softens overconfident predictions.

To tune `T` on a held-out validation set:

```python
from scipy.optimize import minimize_scalar
from torch.nn.functional import cross_entropy

def nll(T):
    scaled_logits = val_logits / T
    return cross_entropy(scaled_logits, val_labels).item()

result = minimize_scalar(nll, bounds=(0.5, 5.0), method="bounded")
best_T = result.x
```

Set `TEMPERATURE=<best_T>` in your `.env` and restart the server.

---

## `/predict` output JSON shape

```json
{
  "image_id": "string (UUID from uploaded_images table)",
  "model_version": "string",
  "primary_condition": "string (top-ranked class slug)",
  "confidence_score": 0.0,
  "predictions": [
    { "condition": "string", "confidence": 0.0 }
  ],
  "differential_diagnoses": [
    { "condition": "string", "confidence": 0.0 }
  ],
  "confidence_threshold_met": true,
  "low_confidence_flag": false
}
```

Field details:

| Field | Type | Notes |
|---|---|---|
| `image_id` | `str` | Echo of request `image_id` |
| `model_version` | `str` | From `MODEL_VERSION` env var |
| `primary_condition` | `str` | Highest-confidence class slug |
| `confidence_score` | `float` | Calibrated softmax prob of primary (0–1) |
| `predictions` | `list[ConditionScore]` | All 6 classes, sorted descending by confidence |
| `differential_diagnoses` | `list[ConditionScore]` | Top-3 conditions after primary |
| `confidence_threshold_met` | `bool` | `confidence_score >= CONFIDENCE_THRESHOLD` |
| `low_confidence_flag` | `bool` | `confidence_score < LOW_CONFIDENCE_THRESHOLD` |

`ConditionScore`: `{ "condition": str, "confidence": float }`

---

## Dependencies

Add to `requirements.txt`:

```
torch>=2.2.0
torchvision>=0.17.0
Pillow>=10.0.0
```
