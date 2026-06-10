#!/usr/bin/env python3
"""
Depth Scanner — AI depth backend
================================
Runs Depth-Anything V2 locally (PyTorch + transformers) to turn footage
frames into grayscale depth maps for the After Effects "Depth Scanner"
panel. Brighter = nearer (Depth-Anything outputs inverse depth), which
matches the AE rig convention.

Called by the AE panel, but also usable standalone:

    # single image
    python depth_estimate.py -i frame.png -o out/

    # a folder of frames (PNG sequence), temporally stabilized
    python depth_estimate.py -i frames/ -o out/ --encoder vitb --normalize global

Models (auto-downloaded from Hugging Face on first run):
    vits -> depth-anything/Depth-Anything-V2-Small-hf   (fastest)
    vitb -> depth-anything/Depth-Anything-V2-Base-hf
    vitl -> depth-anything/Depth-Anything-V2-Large-hf    (best)

License: MIT (matches the parent repo).
"""

import argparse
import os
import sys
import glob
import tempfile

MODEL_IDS = {
    "vits": "depth-anything/Depth-Anything-V2-Small-hf",
    "vitb": "depth-anything/Depth-Anything-V2-Base-hf",
    "vitl": "depth-anything/Depth-Anything-V2-Large-hf",
}

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp")


def log(msg):
    """Print + flush so the AE panel sees progress live."""
    print(msg, flush=True)


def collect_inputs(path):
    if os.path.isdir(path):
        files = []
        for ext in IMAGE_EXTS:
            files.extend(glob.glob(os.path.join(path, "*" + ext)))
            files.extend(glob.glob(os.path.join(path, "*" + ext.upper())))
        return sorted(set(files))
    if os.path.isfile(path):
        return [path]
    return []


def pick_device(requested):
    import torch
    if requested and requested != "auto":
        return requested
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def main():
    ap = argparse.ArgumentParser(description="Depth-Anything V2 depth maps for After Effects")
    ap.add_argument("-i", "--input", required=True, help="Image file or folder of frames")
    ap.add_argument("-o", "--output", required=True, help="Output folder for depth PNGs")
    ap.add_argument("--encoder", default="vits", choices=list(MODEL_IDS.keys()),
                    help="Model size: vits (fast) / vitb / vitl (best)")
    ap.add_argument("--normalize", default="frame", choices=["frame", "global"],
                    help="'frame' = per-image contrast; 'global' = flicker-free over a sequence")
    ap.add_argument("--invert", action="store_true", help="Invert (far = bright)")
    ap.add_argument("--device", default="auto", help="auto / cpu / cuda / mps")
    args = ap.parse_args()

    files = collect_inputs(args.input)
    if not files:
        log("ERROR: no images found at: %s" % args.input)
        return 2
    os.makedirs(args.output, exist_ok=True)

    # Import heavy deps only after arg validation, so --help stays instant.
    try:
        import numpy as np
        import torch
        from PIL import Image
        from transformers import AutoImageProcessor, AutoModelForDepthEstimation
    except Exception as e:
        log("ERROR: missing Python deps (%s). Run: pip install -r requirements.txt" % e)
        return 3

    device = pick_device(args.device)
    model_id = MODEL_IDS[args.encoder]
    log("Loading %s on %s ..." % (model_id, device))
    processor = AutoImageProcessor.from_pretrained(model_id)
    model = AutoModelForDepthEstimation.from_pretrained(model_id).to(device).eval()

    def predict_raw(path):
        image = Image.open(path).convert("RGB")
        inputs = processor(images=image, return_tensors="pt").to(device)
        with torch.no_grad():
            predicted = model(**inputs).predicted_depth
        # Upsample to the original frame size.
        predicted = torch.nn.functional.interpolate(
            predicted.unsqueeze(1), size=image.size[::-1],
            mode="bicubic", align_corners=False,
        ).squeeze().cpu().numpy().astype("float32")
        return predicted

    def to_png(depth, lo, hi, out_path):
        rng = (hi - lo) if (hi - lo) > 1e-6 else 1.0
        norm = (depth - lo) / rng
        if args.invert:
            norm = 1.0 - norm
        arr = np.clip(norm * 255.0, 0, 255).astype("uint8")
        Image.fromarray(arr, mode="L").save(out_path)

    total = len(files)

    if args.normalize == "global" and total > 1:
        # Two passes for flicker-free video: cache raw depth, find global range.
        log("Pass 1/2: estimating depth for %d frames ..." % total)
        cache_dir = tempfile.mkdtemp(prefix="ds_depth_")
        gmin, gmax = float("inf"), float("-inf")
        cache = []
        for idx, f in enumerate(files, 1):
            d = predict_raw(f)
            gmin, gmax = min(gmin, float(d.min())), max(gmax, float(d.max()))
            npy = os.path.join(cache_dir, "%05d.npy" % idx)
            np.save(npy, d.astype("float16"))
            cache.append((f, npy))
            log("  depth %d/%d" % (idx, total))
        log("Pass 2/2: writing normalized PNGs (range %.3f..%.3f) ..." % (gmin, gmax))
        for idx, (src, npy) in enumerate(cache, 1):
            d = np.load(npy).astype("float32")
            out = os.path.join(args.output, "%s_depth.png" % os.path.splitext(os.path.basename(src))[0])
            to_png(d, gmin, gmax, out)
            os.remove(npy)
        try:
            os.rmdir(cache_dir)
        except OSError:
            pass
    else:
        for idx, f in enumerate(files, 1):
            d = predict_raw(f)
            out = os.path.join(args.output, "%s_depth.png" % os.path.splitext(os.path.basename(f))[0])
            to_png(d, float(d.min()), float(d.max()), out)
            log("  depth %d/%d -> %s" % (idx, total, os.path.basename(out)))

    log("DONE: %d depth map(s) in %s" % (total, args.output))
    return 0


if __name__ == "__main__":
    sys.exit(main())
