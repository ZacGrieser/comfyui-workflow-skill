# Depth Scanner — for After Effects

> Recreate the [aescripts **Depth Scanner**](https://aescripts.com/depth-scanner/) look inside After Effects, driven by a grayscale **depth map** — the kind a ComfyUI ControlNet depth preprocessor (Depth‑Anything / MiDaS / ZoeDepth) produces.

The commercial Depth Scanner plug-in does two jobs: (1) **AI depth estimation** from footage, and (2) a **toolkit** that uses that depth for color maps, depth slicing, fog, and depth‑of‑field. This package covers job #2 with **native AE effects** and lets the AI step happen upstream in ComfyUI (this repo) — so the two halves of the pipeline fit together.

## What it does

Applied to a depth map (and optional footage), it builds one tidy **Effect Controls rig**:

| Control | Effect | Result |
|---|---|---|
| `DS · Depth Map` | Layer pick | Which layer is the depth source |
| `DS · DoF Amount` | Compound Blur | Depth‑based shallow depth‑of‑field |
| `DS · Color Map` | Colorama | Colorful depth visualization (0 = off, 100 = full) |
| `DS · Scan Position` | Threshold sweep | Depth at which the scan plane sits |
| `DS · Scan Width` | Box Blur / Glow | Thickness / softness of the scan line |
| `DS · Scan Color` | Tint | Color of the glowing scan front |
| `DS · Scan Glow` | Glow / Opacity | Brightness of the sweeping contour |

The headline look is the **Scan Front**: a glowing contour line that sweeps *through depth* as you animate `DS · Scan Position` 0 → 100 — a LIDAR/scanner wavefront moving from near to far.

## Why a `.jsx` and not a ready-made `.ffx`

An `.ffx` animation preset is a **binary file that only After Effects itself can write** (`Animation ▸ Save Animation Preset…`). It can't be hand-authored reliably outside AE. This script is the **engine** that builds the exact effect+expression stack the preset would contain — then you export the real `.ffx` in one click (see below).

## Install & use

**Run as a script (simplest):**
1. After Effects ▸ `File ▸ Scripts ▸ Run Script File…` → pick `Depth Scanner.jsx`.

**Install as a dockable panel:**
1. Copy `Depth Scanner.jsx` into your AE `Scripts/ScriptUI Panels/` folder.
   - Windows: `C:\Program Files\Adobe\Adobe After Effects <ver>\Support Files\Scripts\ScriptUI Panels\`
   - macOS: `/Applications/Adobe After Effects <ver>/Scripts/ScriptUI Panels/`
2. Enable `Preferences ▸ Scripting & Expressions ▸ Allow Scripts to Write Files and Access Network`.
3. Restart AE → open it from the **Window** menu.

**Then:**
1. In a comp, select your layer(s):
   - **1 layer** → the depth map itself (color‑map + scan view)
   - **2 layers** → footage **+** its depth map (DoF + scan). The depth map is auto‑detected by name (`depth`, `midas`, `zoe`, `mask`…); if it can't be guessed, you'll be asked which is which.
2. Click **Apply Depth Scanner**.
3. Animate `DS · Scan Position` to sweep the scan; tune the other `DS ·` sliders to taste.

## Export the real `.ffx` preset

1. Apply Depth Scanner to a layer.
2. In **Effect Controls**, select all the `DS …` effects (click the first, shift‑click the last).
3. `Animation ▸ Save Animation Preset…` → save as **`Depth Scanner.ffx`**.
4. Drag that `.ffx` onto any layer to reuse it. (The panel's **How to export .ffx** button repeats these steps.)

## ComfyUI → After Effects pipeline

This package is the AE end of a depth pipeline that starts in this repo:

1. **ComfyUI** — run a ControlNet **depth** preprocessor (e.g. Depth‑Anything / MiDaS) on your image or video frames to render a grayscale **depth map** (white = near, black = far, or invert as needed). Ask this skill, e.g. *"SDXL + ControlNet depth workflow"*.
2. Export the depth map as a PNG sequence / image alongside your footage.
3. **After Effects** — import footage + depth map, select both, and **Apply Depth Scanner**.

## Notes & limitations

- **Compound Blur's Blur Layer is a fixed layer pick** (AE doesn't let expressions choose a layer source). The script wires it to your depth map at apply time. If you later change the `DS · Depth Map` control, also update the *Depth of Field* effect's **Blur Layer** dropdown to match.
- The scan front is built from `Threshold → Box Blur → Find Edges → Glow → Tint` on a duplicate of the depth map (set to **Add** blend). Delete that `DS · Scan Front` layer to remove just the scan.
- Depth map convention: brighter = nearer. If your map is inverted, add an **Invert** effect to it (or flip `Scan Position`).
- Built and verified against the documented AE effect match‑names; minor per‑version tuning inside AE is expected for any preset.

## License

MIT — matches the parent repository.
