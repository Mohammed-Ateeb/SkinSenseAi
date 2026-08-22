# Free datasets to strengthen the 12-class model

Goal: get real training data for **all 12 classes**, especially the 5 currently weak/missing:
**rosacea, melasma, vitiligo, hyperpigmentation, contact_dermatitis**.

## Current coverage (what you already have)

| Class | Have data? | From |
|---|---|---|
| acne | strong | DermNet + ACNE04 |
| eczema | yes | DermNet |
| psoriasis | yes | DermNet |
| seborrheic_keratoses | yes | DermNet + HAM10000 + PAD-UFES |
| tinea | yes | DermNet |
| warts | yes | DermNet |
| actinic_keratosis | yes | DermNet + HAM10000 + PAD-UFES |
| **contact_dermatitis** | weak (43) | Fitzpatrick |
| **vitiligo** | weak (43) | Fitzpatrick |
| **rosacea** | almost none (~3) | Fitzpatrick (dead links) |
| **melasma** | none | — |
| **hyperpigmentation** | none | — |

---

## Priority 1 — the two that fill every gap

### 1. SCIN — Skin Condition Image Network (Google)
- **10,000+ images**, crowdsourced from US users, **dermatologist labels**, diverse skin tones (balanced Fitzpatrick — great for melasma/PIH which show mostly on darker skin).
- Covers the gap classes: **melasma, rosacea, hyperpigmentation (PIH), contact dermatitis, vitiligo** — plus acne, eczema, psoriasis, etc.
- **Free (CC-BY-4.0)**, public Google Cloud bucket, no login.
- **You already have the loader**: `backend/app/ml/training/prepare_scin.py` — run it and it maps SCIN's weighted labels straight into the 12-class layout.
- Repo/docs: https://github.com/google-research-datasets/scin · https://research.google/blog/scin-a-new-resource-for-representative-dermatology-images/

### 2. Roboflow Universe — per-condition datasets
Community datasets, **exportable as a classification folder structure** (plugs straight into the trainer). Free account + one-click download or API. Best for the exact gaps:
- **Pigmentation / Melasma / Dark Spots** — 819 images -> *melasma + hyperpigmentation*: https://universe.roboflow.com/alirho/pigmentation-melasma-dark-spots-436l2-cybdd
- **skin-disease (Datasetku)** — 8.7k images incl. **Dermatitis, Rosacea, Vitiligo** classes: https://universe.roboflow.com/datasetku/skin-disease-v4lkp
- **Melasma Detection**: https://universe.roboflow.com/task-wivjr/melasma-detection
- Browse by class: [melasma](https://universe.roboflow.com/search?q=class:melasma) · [pigmentation](https://universe.roboflow.com/search?q=class:pigmentation) · [rosacea](https://universe.roboflow.com/search?q=class:rosacea) · [vitiligo](https://universe.roboflow.com/search?q=class:vitiligo) · [dermatitis](https://universe.roboflow.com/search?q=class:dermatitis)

> Export format on Roboflow: choose **"Folder Structure"** (classification), not YOLO/COCO. You get `train/<class>/…` — rename folders to our names and drop into `data/`.

---

## Priority 2 — broad academic sets (cover rare classes, need a request/registration)

| Dataset | Size | Covers | Access | License |
|---|---|---|---|---|
| **SD-198** | 6,584 imgs / 198 diseases | almost everything incl. melasma, rosacea, PIH | email request (m15051413607@163.com); mirror on [Hugging Face](https://huggingface.co/datasets/resyhgerwshshgdfghsdfgh/SD-198) | research |
| **SD-260** | 20,600 imgs / 260 diseases | broader + more balanced | same email request | research |
| **DDI — Diverse Dermatology Images** | 656 imgs, biopsy-confirmed, dark skin tones | mostly neoplasms (keratoses, actinic) | free registration -> https://ddi-dataset.github.io/ | non-commercial research |
| **PASSION** | 4,145 pediatric, Sub-Saharan Africa | eczema, fungal (tinea), scabies, impetigo on pigmented skin | request via project | research |

---

## Priority 3 — already downloaded / strong-class reinforcement

| Dataset | Covers | Access |
|---|---|---|
| **DermNet** (you have `archive (1).zip`) | 7 classes, folder-based | [Kaggle: shubhamgoel27/dermnet](https://www.kaggle.com/datasets/shubhamgoel27/dermnet) |
| **HAM10000 + ISIC** (you have `archive (3).zip`) | actinic keratosis, seb. keratoses | [ISIC Archive API](https://api.isic-archive.com/) |
| **PAD-UFES-20** (you have `zr7vgbcyr2-1.zip`) | smartphone actinic/seb keratoses | [Mendeley](https://data.mendeley.com/datasets/zr7vgbcyr2) |
| **ACNE04** (you have `archive (2).zip`) | acne grading | Kaggle / GitHub |
| **Kaggle Facial Skin Analysis** | 4,093 facial imgs, skin conditions incl. pigmentation | [killa92/facial-skin-analysis](https://www.kaggle.com/datasets/killa92/facial-skin-analysis-and-type-classification) |
| **Fitzpatrick17k** (you have csv) | rosacea/vitiligo/contact (mostly dead links, ~89 usable) | [GitHub](https://github.com/mattgroh/fitzpatrick17k) |

---

## Recommended download plan (best effort/reward)

1. **Run SCIN first** — it's already coded (`prepare_scin.py`), free, no download step, and covers *every* gap class with diverse skin tones. Biggest single win.
2. **Grab 2-3 Roboflow sets** for melasma, hyperpigmentation, rosacea, vitiligo, contact_dermatitis (export as classification folders).
3. **Optionally add SD-198/260** if you want maximum breadth (needs an email request).
4. Keep DermNet + ACNE04 + HAM + PAD for the 7 strong classes.

Aim for **>= 300 images per class**, roughly balanced. Anything under ~100/class trains poorly.

## How to plug new data into training

Everything the trainer reads is a plain `data/{train,val}/<class>/*.jpg` folder. Two paths:
- **Folder-based sets** (DermNet, Roboflow, Kaggle): rename their folders to our 12 class names and merge with `merge_datasets.py` (extend its mapping dict) or just copy into `data/`.
- **SCIN**: `python prepare_scin.py --out ./data` handles the mapping automatically.
- **Fitzpatrick**: `python download_fitzpatrick.py --csv fitzpatrick17k.csv --out ./data` (limited yield).

Then rebuild `dataset_manifest.csv` (`build_manifest.py`) if you want a single index, and retrain via `SkinSense_Train_Colab.ipynb` on GPU.

The 12 class names (exact folder names) are in `backend/app/ml/model_loader.py:CLASS_NAMES`:
`acne, eczema, psoriasis, rosacea, seborrheic_keratoses, tinea, melasma, vitiligo, hyperpigmentation, contact_dermatitis, warts, actinic_keratosis`
