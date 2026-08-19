# Photorealistic Cinematic Video — Recipe

How to build (or tune) a workflow whose output reads as *filmed footage* rather than
"AI video". Reference implementation: `templates/cinematic-photoreal-video.json`.

## Pipeline shape

```
FLUX.1-dev  ──▶ cinematic keyframe (1280x720, 16:9)
                     │
                     ├──▶ CLIPVisionEncode (crop=none)  ──┐
                     │                                     ├──▶ WanImageToVideo
                     └──▶ start_image ────────────────────┘        │
                                                                    ▼
                        Wan 2.2 I2V 14B, high-noise expert (steps 0-10)
                                                                    │
                        Wan 2.2 I2V 14B, low-noise expert (steps 10-20)
                                                                    │
                        VAEDecode ─▶ ImageSharpen (subtle) ─▶ CreateVideo ─▶ SaveVideo
```

Why a keyframe first: the still carries the photographic look (lens, grade, skin
texture). Wan then only has to *move* an already-cinematic frame, which is far more
reliable than asking a video model to invent photorealism from text alone.

## Prompt formula (keyframe)

Write the FLUX `t5xxl` prompt as a camera report, in this order:

1. **Format** — "cinematic film still from a contemporary drama"
2. **Subject & blocking** — age, wardrobe, pose, eyeline, where they are in frame
3. **Environment & separation** — background, haze, practical light sources
4. **Lighting** — key direction/quality, fill ratio, whether shadows stay deep
5. **Camera & stock** — body, focal length, T-stop, film stock, bokeh shape, halation
6. **Skin & imperfection** — visible pores, flyaways, facial asymmetry, no retouching
7. **Grade** — palette, contrast curve, and an explicit "no digital oversharpening"

The `clip_l` field takes a short tag-style summary; the long description goes in
`t5xxl`. Keep FLUX `guidance` at **2.2–2.8** — high guidance (3.5+) is the main cause
of the plastic, over-contrasted "AI look".

## Prompt formula (motion)

The Wan positive prompt describes **one continuous take**, never a sequence of events:

- One camera move only, named explicitly ("slow dolly in", "static locked-off tripod",
  "slow handheld push"). Two moves in one prompt produces a cut or a warp.
- Secondary motion that sells realism: breathing, weight shift, hair and fabric in wind,
  rain, steam, reflections, background traffic.
- End with the physical constraints: "consistent lighting and exposure", "natural human
  motion at real-world speed", "motion blur consistent with a 180-degree shutter",
  "film grain preserved".

The negative prompt is where the CGI look gets killed: `plastic skin, waxy skin,
airbrushed, 3d render, cgi, oversaturated, morphing, melting, flickering, jittery
motion, sped-up motion, abrupt cut, static frozen image`.

## Parameters that matter

| Setting | Value | Why |
|---------|-------|-----|
| Keyframe resolution | 1280x720 | matches Wan 2.2 14B's 720p training; no rescale between stages |
| FLUX guidance | 2.5 | photoreal; higher bakes in contrast and plastic skin |
| FLUX steps / sampler | 28, euler + simple | stable, no scheduler surprises on older ComfyUI |
| Wan length | 81 frames | 5.0 s at the model's native 16 fps (`length` must be `4n+1`) |
| Wan split | steps 20, boundary at 10 | high-noise expert 0-10, low-noise expert 10-10000 |
| Wan cfg | 3.5 | above ~5 the motion goes rubbery and colors clip |
| Wan shift (ModelSamplingSD3) | 8.0 | Wan 2.2 default; lower = less motion, higher = more drift |
| CreateVideo fps | 16 | Wan 2.2 14B is a 16 fps model — 24 here just plays the clip fast |
| CLIPVisionEncode crop | `none` | `center` crops a 16:9 keyframe and loses the composition |

Both KSamplerAdvanced passes must share the same `noise_seed`, and the first pass must
end with `return_with_leftover_noise: enable` while the second uses
`add_noise: disable`. Breaking that pairing is the usual cause of a washed-out or noisy
second half.

## Common failures

| Symptom | Fix |
|---------|-----|
| Plastic / airbrushed skin | drop FLUX guidance to ~2.2, add pore and flyaway language, add `airbrushed, waxy skin` to the negative |
| Video looks like a slideshow | the subject has no secondary motion — name breathing, wind, fabric, rain |
| Mid-clip cut or morph | two camera moves in the prompt, or shift too high; keep one move, shift 8.0 |
| Subject drifts off-model | `clip_vision_output` not connected, or crop set to `center` |
| Motion is fast and jerky | fps set above 16 in CreateVideo |
| Second half noisy / flat | seeds differ between the two passes, or leftover-noise flags mismatched |
| Out of VRAM at 720p | set both UNETLoader `weight_dtype` to `fp8_e4m3fn`, or drop to 832x480 / 49 frames |

## Cost knobs

- **Faster preview**: 832x480, `length` 49, steps 12 (boundary at 6).
- **Longer shot**: `length` 121 (7.5 s) — VRAM scales roughly linearly with frames.
- **Finishing pass**: add `UpscaleModelLoader` + `ImageUpscaleWithModel` (4x-UltraSharp)
  after the video `VAEDecode`, then `ImageScale` down to 1920x1080 for a true 1080p master.
  This is VRAM-heavy across all frames — run it as a separate pass if needed.
