"""
Fine-tune EfficientNet-B0 on the 12 skin-condition classes and save a checkpoint
that drops straight into inference (point WEIGHTS_PATH at the output file).

Builds the *exact* architecture the inference stack uses (via model_loader), so
the saved state_dict loads with strict=True. Starts from ImageNet-pretrained
weights and fine-tunes — training from scratch on a few thousand derm images
overfits badly.

Expected data layout (produced by prepare_scin.py):
    <data>/train/<class>/*.jpg
    <data>/val/<class>/*.jpg

Colab quick start:
    !pip install torch torchvision tqdm
    !python train.py --data ./data --epochs 25 --out best_model.pt

The checkpoint is a TemperatureScaler state_dict; load_model() loads it with the
"full" path. After training, the temperature scalar is calibrated on the val set.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader
from torchvision import datasets, transforms

# Import the shared architecture (lives one level up in the ml/ package) so
# training and inference can never drift. Works whether run as a module or as a
# plain script (e.g. on Colab).
try:
    from ..model_loader import CLASS_NAMES, TemperatureScaler, _build_efficientnet_b0
except ImportError:  # run as a script
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from model_loader import CLASS_NAMES, TemperatureScaler, _build_efficientnet_b0

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("train")

_MEAN = (0.485, 0.456, 0.406)
_STD = (0.229, 0.224, 0.225)


def _loaders(data_root: Path, batch_size: int, workers: int):
    train_tf = transforms.Compose(
        [
            transforms.RandomResizedCrop(224, scale=(0.7, 1.0)),
            transforms.RandomHorizontalFlip(),
            transforms.RandomVerticalFlip(),
            transforms.RandomRotation(20),
            transforms.ColorJitter(0.2, 0.2, 0.2, 0.02),
            transforms.ToTensor(),
            transforms.Normalize(_MEAN, _STD),
        ]
    )
    # Val transform mirrors inference preprocessing (Resize 256 -> CenterCrop 224).
    val_tf = transforms.Compose(
        [
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(_MEAN, _STD),
        ]
    )

    train_ds = datasets.ImageFolder(data_root / "train", transform=train_tf)
    val_ds = datasets.ImageFolder(data_root / "val", transform=val_tf)

    # The model always outputs len(CLASS_NAMES) logits in CLASS_NAMES order, but
    # ImageFolder labels by its own (alphabetical, possibly-fewer) folder set.
    # Remap every label into the *global* CLASS_NAMES index so a checkpoint
    # trained on a subset of classes still loads into the 12-class inference model.
    unknown = set(train_ds.classes) - set(CLASS_NAMES)
    if unknown:
        raise ValueError(
            f"Train folders not in CLASS_NAMES: {sorted(unknown)}. "
            f"Folder names must be a subset of {CLASS_NAMES}."
        )
    for ds in (train_ds, val_ds):
        remap = {
            local_idx: CLASS_NAMES.index(name)
            for name, local_idx in ds.class_to_idx.items()
        }
        ds.target_transform = lambda y, _m=remap: _m[y]

    train_loader = DataLoader(
        train_ds, batch_size=batch_size, shuffle=True, num_workers=workers,
        pin_memory=True, drop_last=True,
    )
    val_loader = DataLoader(
        val_ds, batch_size=batch_size, shuffle=False, num_workers=workers,
        pin_memory=True,
    )
    return train_ds, val_ds, train_loader, val_loader


def _class_weights(train_ds, device) -> torch.Tensor:
    """Inverse-frequency weights over the global CLASS_NAMES order (12 slots).

    train_ds.samples holds *local* ImageFolder labels, so remap to global first.
    """
    local_to_global = {
        local_idx: CLASS_NAMES.index(name)
        for name, local_idx in train_ds.class_to_idx.items()
    }
    counts = torch.zeros(len(CLASS_NAMES))
    for _, local_label in train_ds.samples:
        counts[local_to_global[local_label]] += 1

    # Weight ONLY the classes that actually have training samples. Absent classes
    # get weight 0 — otherwise inverse-frequency hands them an enormous weight
    # which, via label smoothing, dominates the loss and collapses predictions
    # onto classes that never appear.
    present = counts > 0
    w = torch.zeros(len(CLASS_NAMES))
    w[present] = counts[present].sum() / (present.sum() * counts[present])
    return w.to(device)


def _build_model(num_classes: int, device) -> TemperatureScaler:
    backbone = _build_efficientnet_b0(num_classes=num_classes, pretrained=True)
    model = TemperatureScaler(backbone, temperature=1.0)  # calibrate after training
    return model.to(device)


def _set_backbone_trainable(model: TemperatureScaler, trainable: bool):
    for name, p in model.base_model.named_parameters():
        # keep the classification head always trainable
        if name.startswith("classifier"):
            p.requires_grad = True
        else:
            p.requires_grad = trainable


@torch.no_grad()
def _evaluate(model, loader, device, n_classes):
    model.eval()
    correct = total = 0
    per_cls_correct = torch.zeros(n_classes)
    per_cls_total = torch.zeros(n_classes)
    for x, y in loader:
        x, y = x.to(device), y.to(device)
        logits = model(x)
        pred = logits.argmax(1)
        correct += (pred == y).sum().item()
        total += y.numel()
        for c in range(n_classes):
            m = y == c
            per_cls_total[c] += m.sum().item()
            per_cls_correct[c] += (pred[m] == c).sum().item()
    acc = correct / max(total, 1)
    recalls = per_cls_correct / per_cls_total.clamp(min=1)
    macro_recall = recalls[per_cls_total > 0].mean().item()
    return acc, macro_recall


def _calibrate_temperature(model, loader, device):
    """Fit a single temperature on val logits (minimise NLL) — standard calibration."""
    model.eval()
    logits_list, labels_list = [], []
    with torch.no_grad():
        for x, y in loader:
            logits_list.append(model.base_model(x.to(device)).cpu())
            labels_list.append(y)
    if not logits_list:
        return 1.0
    logits = torch.cat(logits_list)
    labels = torch.cat(labels_list)

    temperature = torch.nn.Parameter(torch.ones(1))
    optimizer = torch.optim.LBFGS([temperature], lr=0.01, max_iter=100)

    def _closure():
        optimizer.zero_grad()
        loss = F.cross_entropy(logits / temperature.clamp(min=0.05), labels)
        loss.backward()
        return loss

    optimizer.step(_closure)
    # Clamp to a sane calibration range. A value pinned at a bound (esp. the low
    # end) means the model isn't cleanly calibratable yet — fall back to 1.0
    # rather than serve a pathologically over/under-confident temperature.
    raw = float(temperature.detach().item())
    t = min(max(raw, 0.5), 5.0)
    if t in (0.5, 5.0):
        logger.warning("Calibration hit bound (raw=%.3f); using T=1.0 instead.", raw)
        t = 1.0
    logger.info("Calibrated temperature = %.3f (raw %.3f)", t, raw)
    return t


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", default="./data", help="root with train/ and val/")
    ap.add_argument("--out", default="best_model.pt", help="checkpoint output path")
    ap.add_argument("--epochs", type=int, default=25)
    ap.add_argument("--warmup-epochs", type=int, default=3,
                    help="epochs training the head only before unfreezing backbone")
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--weight-decay", type=float, default=1e-4)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--patience", type=int, default=6, help="early-stop patience")
    ap.add_argument("--label-smoothing", type=float, default=0.05)
    args = ap.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info("Device: %s", device)

    data_root = Path(args.data)
    train_ds, val_ds, train_loader, val_loader = _loaders(
        data_root, args.batch_size, args.workers
    )
    # Model always outputs the full 12-class space so checkpoints are portable
    # into the inference model regardless of which classes SCIN provided.
    n_classes = len(CLASS_NAMES)
    logger.info("Present folders (%d): %s", len(train_ds.classes), train_ds.classes)
    logger.info("Model outputs %d classes (CLASS_NAMES order).", n_classes)
    logger.info("Train=%d  Val=%d", len(train_ds), len(val_ds))

    model = _build_model(n_classes, device)
    weights = _class_weights(train_ds, device)
    criterion = nn.CrossEntropyLoss(
        weight=weights, label_smoothing=args.label_smoothing
    )

    optimizer = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad],
        lr=args.lr, weight_decay=args.weight_decay,
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    use_amp = device.type == "cuda"
    scaler = torch.cuda.amp.GradScaler(enabled=use_amp)

    _set_backbone_trainable(model, trainable=False)  # warmup: head only
    best_metric = -1.0
    epochs_no_improve = 0

    for epoch in range(1, args.epochs + 1):
        if epoch == args.warmup_epochs + 1:
            logger.info("Unfreezing backbone.")
            _set_backbone_trainable(model, trainable=True)
            optimizer = torch.optim.AdamW(
                model.parameters(), lr=args.lr, weight_decay=args.weight_decay
            )
            scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
                optimizer, T_max=max(1, args.epochs - epoch + 1)
            )

        model.train()
        running = 0.0
        for x, y in train_loader:
            x, y = x.to(device), y.to(device)
            optimizer.zero_grad(set_to_none=True)
            with torch.cuda.amp.autocast(enabled=use_amp):
                loss = criterion(model(x), y)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            running += loss.item() * y.size(0)
        scheduler.step()

        train_loss = running / max(len(train_ds), 1)
        val_acc, val_macro = _evaluate(model, val_loader, device, n_classes)
        logger.info(
            "epoch %2d/%d  loss=%.4f  val_acc=%.4f  val_macro_recall=%.4f",
            epoch, args.epochs, train_loss, val_acc, val_macro,
        )

        # Select on macro recall (robust to class imbalance).
        if val_macro > best_metric:
            best_metric = val_macro
            epochs_no_improve = 0
            torch.save(model.state_dict(), args.out)
            logger.info("  saved best -> %s (macro_recall=%.4f)", args.out, val_macro)
        else:
            epochs_no_improve += 1
            if epochs_no_improve >= args.patience:
                logger.info("Early stopping (no improvement in %d epochs).", args.patience)
                break

    # Reload best, calibrate temperature on val, re-save.
    model.load_state_dict(torch.load(args.out, map_location=device))
    t = _calibrate_temperature(model, val_loader, device)
    with torch.no_grad():
        model.temperature.copy_(torch.tensor(float(t)))
    torch.save(model.state_dict(), args.out)
    logger.info("Done. Best macro_recall=%.4f. Checkpoint: %s", best_metric, args.out)
    logger.info("Set WEIGHTS_PATH=%s to serve it.", Path(args.out).resolve())


if __name__ == "__main__":
    main()
