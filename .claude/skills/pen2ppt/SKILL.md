---
name: pen2ppt
description: Export frames from a Pencil (.pen) design to an editable PowerPoint (.pptx). Use when the user wants to turn Pencil pages/frames into PowerPoint slides — "pen to ppt", "export to PowerPoint", "make a deck from this .pen", "convert these frames to slides". Pipeline: pencil MCP export_html per top-level frame -> stitch into one HTML -> render to .pptx with dom-to-pptx (text stays editable; solid shapes stay native). Deck is fixed 16:9; non-16:9 slides are contain-fit and the user is warned.
---

# pen2ppt — Pencil frames → editable PowerPoint

Closes the loop `.pen → HTML → PPTX`. The first half (`.pen → HTML`) is provided by the pencil MCP `export_html` tool. This skill adds the second half (HTML → PPTX) and the glue.

**Never modify the original `.pen`.** This skill only reads it (sizes, frames, `export_html`). All size conversion happens in the HTML→PPTX step.

## Mental model

**One entry in Pencil's Slides panel = one slide** (in practice, the top-level frames of the `.pen`, in slide order). There is no slide node type; read the top-level frames via pencil MCP.

**Deck is fixed 16:9** (PowerPoint default = 13.333×7.5 in = 1280×720 px). Every slide's page is exactly 16:9.

- A slide that is **already 16:9** → placed **1:1 native** (just DPI scaling if it was authored larger, e.g. 1920×1080).
- A slide that is **not 16:9** → **contain-fit**: scaled **uniformly** to fit inside the 16:9 page, centered, with **letterboxing** (empty bars on the short sides). **No distortion, no cropping.** This size conversion happens entirely in HTML→PPTX; the `.pen` is untouched.
- Whenever a slide deviates from 16:9, **warn the user** (which slides, their size, that they were contain-fit / letterboxed).

## Prerequisites (already set up in this repo)

- Skill dir: `<repo>/.claude/skills/pen2ppt/` with `package.json` (dep: `dom-to-pptx`) and `node_modules` installed (pulls `puppeteer` + a bundled Chromium).
- Outputs land in `<repo>/exports/`.
- If `node_modules` is missing: `cd <repo>/.claude/skills/pen2ppt && npm install`.

**Run the Node scripts from the skill directory** (or via absolute path) so its `node_modules` resolve. Below, `<skill>` = `<repo>/.claude/skills/pen2ppt`, `<repo>` = project root containing the `.pen`.

## Run steps

1. **Pick the slides, read their sizes, and pre-compute the deviation warning.** pencil `batch_get` the active `.pen`'s top-level frames (the Slides-panel entries), in slide order (fallback: canvas reading order). For each, record `nodeId`, `name`, native `width`/`height`. For each frame whose aspect ratio (`width/height`) differs from `16/9` by more than ~1%, note a deviation — you'll surface these to the user in the final report. (This authoritative check also covers `h-fit`/auto-height frames that the stitch script can't size from HTML.)

2. **Export each frame to HTML** (pencil `export_html`, `format: "html-tailwind"`, scaffold on), one per frame, in slide order:
   - `<repo>/exports/slide-01.html`, `slide-02.html`, … (zero-padded).
   - Image fills land as relative-path assets next to the HTML — keep them in `exports/`.

3. **Stitch** at native size (no scaling here; conversion is at export):
   ```
   cd <skill>
   node scripts/build-combined.mjs --out <repo>/exports/combined.html \
        <repo>/exports/slide-01.html <repo>/exports/slide-02.html ...
   ```
   Pass files explicitly in slide order. The script also prints best-effort `WARN:` lines for frames it can size.

4. **Render to PPTX** at fixed 16:9 (always use `export-pptx.mjs`, never the `dom-to-pptx-exporter` CLI — see Troubleshooting):
   ```
   node scripts/export-pptx.mjs <repo>/exports/combined.html \
        -o <repo>/exports/<name>.pptx --selector .slide
   ```
   Deck defaults to 13.333×7.5 in (1280×720). Override with `--width <in> --height <in>` only if the user wants a different 16:9 size (e.g. 1920×1080 → `--width 20 --height 11.25`); keep the 16:9 ratio.

5. **Report**: output path, deck size (16:9), slide count, and **the deviation warning** — list every non-16:9 slide (name + native size) and state it was contain-fit (letterboxed, not distorted). If none deviated, say all slides were native 16:9.

## User-facing args (parse from the request)

- Output name → `<name>.pptx` (default `deck.pptx`).
- Slide selection / order ("only the cover and agenda", "slide 3 first") → export those nodeIds in that order.
- Different 16:9 size ("use 1920×1080") → pass `--width 20 --height 11.25` to `export-pptx.mjs`. (Still 16:9.)

## Fidelity (set expectations)

- **Editable / native:** text (real selectable text), solid-color rectangles/ellipses, basic layout.
- **Rasterized to image (looks right, not vector-editable):** CSS gradients, `filter: blur()` / soft-edge, some transforms. Appearance still matches.
- **Image fills embed at original fidelity.** Pencil exports image fills as CSS `background-image` divs — keep them as-is (do NOT convert to `<img>`, which takes the file's natural size and breaks flex rows). `export-pptx.mjs` patches dom-to-pptx in memory (see `scripts/native-image-patch.mjs`) so images are embedded as **original bytes with PowerPoint-native cropping** (`<a:srcRect>`) whenever CSS semantics allow: `object-fit`/`background-size` of `fill|cover|contain|none|scale-down|auto`, no visible tiling, no border radius, local file (inlined to a data URL) of type png/jpeg/gif. No downscaling, no re-encoding — a 4000×3000 JPEG stays a 4000×3000 JPEG. **Fallback cases are still rasterized** (rounded corners, repeat, svg/webp, remote URLs) but now at the image's **native resolution** instead of a fixed 2× (clamped 2–8×, canvas capped at 4096px/side). The console log reports `images: N embedded as original bytes, M rasterized`. Use `--no-native-images` to restore stock dom-to-pptx behavior (2× canvas raster) if a deck ever misbehaves. Local files are base64-inlined at render time (a `file://` image taints the canvas and the picture is silently dropped); remote URLs load via CORS.
- **Non-16:9 slides are letterboxed**, never stretched or cropped — that's the contain-fit conversion. If the user wants a different behavior (crop-to-fill, one file per slide, per-slide native sizes), that's a different policy — ask, because PPTX supports only one slide size per deck.

## Troubleshooting

- **`Failed to launch headless browser ... Code: 0` / it picks Microsoft Edge.** `dom-to-pptx@2.0.3` mis-handles `puppeteer@25`'s async `executablePath()` and falls back to Edge, which fails to launch here. Always use `scripts/export-pptx.mjs` (launches the bundled Chromium with `--no-sandbox` + a fresh `--user-data-dir`). If launch still fails, force a binary: `--browser "C:/path/to/chrome.exe"` (or set `PUPPETEER_EXECUTABLE_PATH`).
- **Fonts or Tailwind look wrong.** Both load from CDN at render time — export needs internet. Offline: fonts fall back to system; layout survives but appearance shifts. (Offline inlining is a future enhancement.)
- **A slide has empty side/top bars.** Expected for non-16:9 slides (contain-fit letterboxing). Re-author the slide to 16:9 in Pencil for a full-bleed page, or accept the bars.
- **Text isn't editable in PowerPoint.** Confirm you used `export-pptx.mjs` (it calls `exportToPptx(..., { skipDownload: true })` and writes the returned buffer) and that the source HTML had real text nodes (Pencil `text`), not flattened images.
- **Images missing from the PPTX.** The page loads via `file://`; dom-to-pptx rasterizes images to a canvas with `crossOrigin='Anonymous'`, and a `file://` image taints it → picture silently skipped. `export-pptx.mjs` already inlines local images as base64 before render — if a picture is still missing, check the `<img src>` / `url()` ref resolves relative to the combined HTML, or that the remote URL sends CORS headers.
- **A picture looks wrong after the native-image upgrade** (misplaced crop, distorted, low quality). Re-run with `--no-native-images` to get stock dom-to-pptx behavior and compare. If stock is correct, the in-memory bundle patch misfired for that case — check the `WARN: bundle patch missed` lines at export time (a `dom-to-pptx` upgrade can invalidate the patch strings; unpatched paths silently keep stock behavior).
- **Images oversized / overflowing the slide, or accent bars too short.** dom-to-pptx mis-measures flex-dependent geometry (flex children get container width, stretch bars get content height). `export-pptx.mjs` runs a layout-freeze pass before conversion (locks every element to its rendered px, neutralizes flex grow/shrink). If a layout is still off, render the combined HTML in Chrome and compare — a mismatch there means the HTML itself is wrong (e.g. an `<img>` without explicit size taking its natural width).

## Files

- `scripts/build-combined.mjs` — stitches per-frame `export_html` files into one `combined.html` of native-size `<section class="slide">` elements (shared Tailwind + Fonts head). Prints best-effort deviation warnings. Copies referenced local image assets next to the output.
- `scripts/export-pptx.mjs` — headless Chromium (bundled) + dom-to-pptx browser bundle → fixed-16:9 `.pptx` → file. Before converting it (1) inlines local images as base64 (avoids `file://` canvas taint) and (2) layout-freezes every slide element to its rendered pixel rect (fixes flex mis-measurement: oversized images, collapsed bars). Injects a patched dom-to-pptx bundle (native image embedding, on by default; `--no-native-images` opts out).
- `scripts/native-image-patch.mjs` — in-memory string surgery on the dom-to-pptx bundle (node_modules untouched). (1) `<img>` / background-image call sites embed the original image bytes with PowerPoint-native `srcRect` cropping when CSS semantics allow; (2) the raster fallback renders at native resolution instead of fixed 2×. Patches match exact `dom-to-pptx@2.0.3` bundle text and skip with a WARN on dependency upgrades.
- `package.json` — `dom-to-pptx` dependency (brings puppeteer + Chromium).
