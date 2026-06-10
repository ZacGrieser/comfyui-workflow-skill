# Depth Scanner — AI plug-in for After Effects

> An **AI Depth Scanner**: estimates a depth map from your footage with **Depth-Anything V2** (run locally), imports it back into After Effects, and applies a native-effect scanner rig — recreating the [aescripts **Depth Scanner**](https://aescripts.com/depth-scanner/) workflow end to end, free and offline.

```
[AE footage] --render frames--> [Python: Depth-Anything V2]
     --> [grayscale depth PNGs] --import--> [AE]
     --> Depth-of-Field + Color Map + sweeping Scan Front
```

The AI does the hard part (depth estimation from a single image/video); the AE rig turns that depth into the look: depth-of-field, color maps, and a glowing scan front that sweeps near→far.

## Contents

| File | Role |
|---|---|
| `Depth Scanner.jsx` | The AE panel: renders frames, runs the model, imports depth, applies the rig |
| `depth_estimate.py` | Local AI backend — Depth-Anything V2 (PyTorch + transformers) |
| `requirements.txt` | Python dependencies |
| `install.ps1` | One-shot Windows installer (pip install + copy into AE) |

**Windows quick install:** after cloning, run
```powershell
powershell -ExecutionPolicy Bypass -File .\after-effects\install.ps1
```
It installs the Python deps, finds your newest After Effects, copies the panel into `ScriptUI Panels`, and prints the Python path to paste into the panel. Then do the manual steps it lists (restart AE, enable scripting access).

## Setup (one time)

1. **Install the Python backend** (next to the script):
   ```bash
   cd after-effects
   pip install -r requirements.txt
   ```
   First run auto-downloads the model from Hugging Face. For GPU, install the matching [PyTorch build](https://pytorch.org) first (CUDA / Apple MPS both supported; CPU works too, just slower).

2. **Install the panel:** copy `Depth Scanner.jsx` into AE's `Scripts/ScriptUI Panels/` folder, then restart AE and open it from the **Window** menu. (Or just `File ▸ Scripts ▸ Run Script File…` each time.)

3. **Enable scripting access:** `Preferences ▸ Scripting & Expressions ▸ Allow Scripts to Write Files and Access Network` → **ON** (needed to render frames and call Python).

4. **Set the Python path** in the panel if `python3` isn't on PATH. GUI-launched AE often can't see your shell PATH, so use the **full path to your venv's python** (e.g. `/path/to/venv/bin/python`, or `…\venv\Scripts\python.exe` on Windows). The `…` button lets you browse to it. The choice is remembered.

## Use it

### AI mode (estimate depth automatically)
1. Select your **footage** layer in a comp.
2. Pick a model: **vits** (fast) / **vitb** (balanced) / **vitl** (best).
3. Click:
   - **Estimate Depth (current frame)** — single still, per-frame normalization.
   - **Estimate Depth (work area)** — the work-area range as a sequence, **globally normalized** for flicker-free video.
4. The panel solos & renders the layer, runs Depth-Anything, imports the depth map(s) as `<layer> depth`, and applies the rig. Animate `DS · Scan Position` to sweep the scanner — or just set `DS · Sweep Loop (sec)` to e.g. `3` for an automatic looping sweep, no keyframes needed.

> AE's UI is frozen while the model runs (a blocking call). A still on CPU is seconds; a long range on CPU can take minutes — use a GPU build of torch for video.

### Manual mode (you already have a depth map)
Have a depth map from a **ComfyUI ControlNet depth** preprocessor (or anywhere)? Select **footage + depth map** (depth auto-detected by name), click **Apply to selection**. One selected layer = treat it as the depth map itself.

## The rig

One tidy **Effect Controls** group of `DS ·` controls:

| Control | Effect | Result |
|---|---|---|
| `DS · Depth Map` | Layer pick | Which layer is the depth source |
| `DS · DoF Amount` | Compound Blur | Depth-based shallow depth-of-field |
| `DS · Color Map` | Colorama | Colorful depth visualization (0 = off, 100 = full) |
| `DS · Scan Position` | Threshold sweep | Depth the scan plane sits at — **animate this** |
| `DS · Sweep Loop (sec)` | Expression | Auto-loops the scan 0→100 every N seconds (0 = manual) |
| `DS · Scan Width` | Box Blur / Glow | Thickness / softness of the scan line |
| `DS · Scan Color` | Tint | Color of the glowing scan front |
| `DS · Scan Glow` | Glow / Opacity | Brightness of the sweeping contour |
| `DS · Dot Grid` | CC Ball Action | Grid spacing of the point-cloud dots (when enabled) |
| `DS · Fog Color` | Tint | Color of the atmospheric depth fog |
| `DS · Fog Density` | Opacity | Distance fog strength (0 = off) |

**Depth fog** — a `DS · Fog` layer fades far areas toward the fog color (inverted depth tinted in Add blend). Off by default; raise `DS · Fog Density` to dial it in.

**Point-cloud dots** — tick **Look ▸ Point-cloud dots** *before* applying to turn the sweeping scan front into a grid of glowing balls (LIDAR point-cloud plane); `DS · Dot Grid` sets the spacing.

## Export a real `.ffx` preset

A `.ffx` animation preset is a **binary file only After Effects can write**, so the script builds the effect/expression stack and you export it in one click:

1. Apply Depth Scanner to a layer.
2. In **Effect Controls**, select all the `DS …` effects (click first, shift-click last).
3. `Animation ▸ Save Animation Preset…` → save as **`Depth Scanner.ffx`**.
4. Drag that `.ffx` onto any layer to reuse the look. (The **How to export .ffx** button repeats this.)

> The `.ffx` carries the effect rig, not the AI step — keep using the panel to generate fresh depth maps.

## Standalone backend

`depth_estimate.py` works on its own too:
```bash
# single image
python depth_estimate.py -i frame.png -o out/ --encoder vitl

# a folder of frames, temporally stabilized (flicker-free)
python depth_estimate.py -i frames/ -o out/ --encoder vitb --normalize global

# far = bright instead of near = bright
python depth_estimate.py -i frame.png -o out/ --invert
```

## How this fits the repo

This is the After Effects companion to the ComfyUI workflow skill. Same depth model family that ComfyUI's Depth-Anything ControlNet preprocessor uses — so you can generate depth either in ComfyUI (as part of an image/video workflow) or right here in AE.

## Notes & limitations

- **Depth convention:** brighter = nearer (Depth-Anything outputs inverse depth), matching the rig. Use `--invert` (CLI) or add an **Invert** effect if you need it flipped.
- **Compound Blur's Blur Layer is a fixed layer pick** (AE won't let an expression choose a layer source). It's wired to the depth map at apply time; if you change the `DS · Depth Map` control later, also update the *Depth of Field* effect's **Blur Layer** dropdown.
- The scan front is a duplicate of the depth map (`Threshold → Box Blur → Find Edges → Glow → Tint`, **Add** blend). Delete the `DS · Scan Front` layer to remove just the scan; delete `DS · Fog` to remove fog.
- **Point-cloud dots** use **CC Ball Action**, which ships with After Effects but not all OEM/trial builds — if it's missing the scan front still works as a solid line.
- Verified against documented AE effect match-names + Python syntax-checked; the AI step needs a working local Python/torch env, and minor per-version tuning inside AE is expected for any preset.

## License

MIT — matches the parent repository.
