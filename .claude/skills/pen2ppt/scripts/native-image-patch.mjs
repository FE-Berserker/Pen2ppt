// native-image-patch.mjs
// In-memory string surgery on the dom-to-pptx browser bundle (node_modules is
// never modified). Two upgrades over stock dom-to-pptx@2.0.3 image handling:
//
// 1. NATIVE EMBED (the big one). Stock dom-to-pptx re-rasterizes every <img> and
//    CSS background-image through a canvas at 2x the element's rendered size and
//    re-encodes as PNG — hi-res sources get downscaled, JPEGs get re-encoded.
//    The patched call sites first try __pen2pptEmbedNative(): when the CSS
//    semantics map to PowerPoint-native cropping, the ORIGINAL image bytes are
//    embedded unchanged and the crop is expressed as <a:srcRect> via pptxgenjs
//    `sizing: { type: 'crop', ... }`. Supported: object-fit/background-size
//    fill|cover|contain|none|scale-down|auto, no visible tiling, no border
//    radius, source already a data: URL (export-pptx.mjs inlines local files)
//    of type png/jpeg/gif. Anything else falls back to the raster path.
//
// 2. NATIVE-RES RASTER FALLBACK. The remaining rasterized cases (rounded
//    corners, repeat, svg/webp, non-data URLs) render at the image's native
//    resolution instead of a fixed 2x (floored at 2x to keep stock smoothing
//    for lo-res sources, clamped at 8x, canvas capped at 4096px/side).
//
// Each patch carries the exact `find` text from dom-to-pptx@2.0.3's bundle. If
// the dependency is upgraded and a `find` no longer matches, that patch is
// skipped (reported in `missed`) and that code path keeps stock behavior — the
// bundle is only ever rewritten on exact matches, so a miss never corrupts it.

const HELPER = `
// ---- pen2ppt native-image embedding (injected by export-pptx.mjs) ----
window.__pen2pptImgStats = { native: 0, fallback: 0 };

// Parse one object-position/background-position component:
// keywords and percentages -> { f: 0..1 }, px values -> { px: cssPixels }.
function __pen2pptParsePos(v) {
  v = String(v == null ? '' : v).trim().toLowerCase();
  if (v === 'left' || v === 'top') return { f: 0 };
  if (v === 'center') return { f: 0.5 };
  if (v === 'right' || v === 'bottom') return { f: 1 };
  if (v.slice(-1) === '%') { var p = parseFloat(v) / 100; return isFinite(p) ? { f: p } : { f: 0.5 }; }
  if (v.slice(-2) === 'px') { var x = parseFloat(v); return isFinite(x) ? { px: x } : { f: 0.5 }; }
  return { f: 0.5 };
}
function __pen2pptPosOffset(p, box, disp) {
  return p.px !== undefined ? p.px : (box - disp) * p.f;
}

// Try to embed the ORIGINAL image bytes with PowerPoint-native crop instead of
// canvas re-rasterization. Resolves null when the CSS semantics can't be
// reproduced natively (caller then falls back to getProcessedImage).
// All inputs/outputs are in the element's rendered CSS pixels.
window.__pen2pptEmbedNative = function (src, boxW, boxH, radii, fit, position, repeat) {
  return new Promise(function (resolve) {
    function bail() { window.__pen2pptImgStats.fallback++; resolve(null); }
    try {
      if (!src || typeof src !== 'string' || src.slice(0, 5) !== 'data:') return bail(); // remote/local refs: raster (canvas handles CORS)
      if (!/^data:image\\/(png|jpe?g|gif);/i.test(src)) return bail(); // svg/webp: keep raster (compat)
      if (!(boxW > 0) || !(boxH > 0)) return bail();
      if (radii && (radii.tl > 0.5 || radii.tr > 0.5 || radii.br > 0.5 || radii.bl > 0.5)) return bail(); // rounded corners need a mask
      var f = String(fit || 'fill').trim().toLowerCase();
      if (['fill', 'cover', 'contain', 'none', 'scale-down', 'auto'].indexOf(f) < 0) return bail(); // explicit px/% sizes: raster
      var tiles = String(repeat || 'no-repeat').toLowerCase().split(/[\\s,]+/).some(function (t) {
        return t !== '' && t !== 'no-repeat';
      });
      var img = new Image();
      img.onload = function () {
        try {
          var natW = img.naturalWidth || img.width, natH = img.naturalHeight || img.height;
          if (!(natW > 0) || !(natH > 0)) return bail();
          var parts = String(position || '').trim().split(/\\s+/);
          var px = __pen2pptParsePos(parts[0] || '50%');
          var py = parts.length > 1 ? __pen2pptParsePos(parts[1]) : { f: 0.5 };
          var dispW, dispH;
          if (f === 'fill') { dispW = boxW; dispH = boxH; }
          else if (f === 'cover') { var s = Math.max(boxW / natW, boxH / natH); dispW = natW * s; dispH = natH * s; }
          else { // contain | none | scale-down | auto
            var s2 = Math.min(boxW / natW, boxH / natH);
            if (f === 'none' || f === 'auto') s2 = 1;
            if (f === 'scale-down') s2 = Math.min(1, s2);
            dispW = natW * s2; dispH = natH * s2;
          }
          // Tiling only becomes visible when the image is smaller than the box.
          if (tiles && (dispW < boxW - 0.01 || dispH < boxH - 0.01)) return bail();
          var offX = __pen2pptPosOffset(px, boxW, dispW);
          var offY = __pen2pptPosOffset(py, boxH, dispH);
          var crop = null;
          if (dispW > boxW + 0.01 || dispH > boxH + 0.01) {
            crop = { x: -offX, y: -offY, w: boxW, h: boxH };
            if (crop.x + boxW > dispW + 0.5 || crop.y + boxH > dispH + 0.5) return bail(); // crop outside image: raster
            if (crop.x < 0) crop.x = 0;
            if (crop.y < 0) crop.y = 0;
          }
          window.__pen2pptImgStats.native++;
          resolve({ data: src, offXpx: offX, offYpx: offY, dispWpx: dispW, dispHpx: dispH, crop: crop });
        } catch (e) { bail(); }
      };
      img.onerror = function () { bail(); };
      img.src = src;
    } catch (e) { bail(); }
  });
};

// Shared body for the patched call sites: native embed first, canvas raster as
// fallback. 'item' is the dom-to-pptx render-queue item; converts px -> inches
// via the item's own box ratio (options.w corresponds to widthPx).
window.__pen2pptApplyImage = function (item, widthPx, heightPx, src, radii, fit, position, repeat, getProcessedImage) {
  return window.__pen2pptEmbedNative(src, widthPx, heightPx, radii, fit, position, repeat).then(function (native) {
    if (native) {
      var o = item.options, kx = o.w / widthPx, ky = o.h / heightPx;
      o.x += native.offXpx * kx;
      o.y += native.offYpx * ky;
      o.w = native.dispWpx * kx;
      o.h = native.dispHpx * ky;
      if (native.crop) o.sizing = { type: 'crop', x: native.crop.x * kx, y: native.crop.y * ky, w: native.crop.w * kx, h: native.crop.h * ky };
      o.data = native.data;
      return;
    }
    return getProcessedImage(src, widthPx, heightPx, radii, fit, position).then(function (processed) {
      if (processed) item.options.data = processed;
      else item.skip = true;
    });
  });
};
// ---- end pen2ppt ----
`;

const PATCHES = [
  {
    // getProcessedImage(): fixed 2x canvas -> native-resolution canvas.
    name: 'native-res raster fallback (getProcessedImage scale)',
    find: `      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = 2; // Double resolution
        canvas.width = targetW * scale;
        canvas.height = targetH * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);`,
    replace: `      img.onload = () => {
        // pen2ppt: rasterize at the image's native resolution (stock: fixed 2x).
        // Floor of 2 keeps stock smoothing for lo-res sources; capped to bound PNG size.
        const _wR = targetW / img.width, _hR = targetH / img.height;
        let _rw;
        if (objectFit === 'contain') _rw = img.width * Math.min(_wR, _hR);
        else if (objectFit === 'cover') _rw = img.width * Math.max(_wR, _hR);
        else if (objectFit === 'none') _rw = img.width;
        else if (objectFit === 'scale-down') _rw = img.width * Math.min(1, Math.min(_wR, _hR));
        else _rw = targetW;
        let scale = _rw > 0 ? img.width / _rw : 2;
        scale = Math.min(Math.max(scale, 2), 8);
        const _maxSide = Math.max(targetW, targetH) * scale;
        if (_maxSide > 4096) scale *= 4096 / _maxSide;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(targetW * scale);
        canvas.height = Math.round(targetH * scale);
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);`,
  },
  {
    // <img> call site: native embed first.
    name: 'native <img> embedding',
    find: `      const job = async () => {
        const processed = await getProcessedImage(node.src, widthPx, heightPx, radii, objectFit, objectPosition);
        if (processed) item.options.data = processed;
        else item.skip = true;
      };`,
    replace: `      const job = async () => {
        await window.__pen2pptApplyImage(item, widthPx, heightPx, node.src, radii, objectFit, objectPosition, 'no-repeat', getProcessedImage);
      };`,
  },
  {
    // background-image call site: native embed first.
    name: 'native background-image embedding',
    find: `        bgJob = async () => {
          const processed = await getProcessedImage(
            bgUrl,
            widthPx,
            heightPx,
            radii,
            style.backgroundSize || 'cover',
            style.backgroundPosition || '50% 50%'
          );
          if (processed) bgItem.options.data = processed;
          else bgItem.skip = true;
        };`,
    replace: `        bgJob = async () => {
          await window.__pen2pptApplyImage(
            bgItem,
            widthPx,
            heightPx,
            bgUrl,
            radii,
            style.backgroundSize || 'cover',
            style.backgroundPosition || '50% 50%',
            style.backgroundRepeat || 'no-repeat',
            getProcessedImage
          );
        };`,
  },
];

// Returns { content, applied, missed }. `content` always has the helper
// prepended (harmless when every call-site patch missed).
export function patchDomToPptxBundle(src) {
  const applied = [];
  const missed = [];
  // The bundle ships CRLF line endings; the find/replace literals below are LF.
  // Match the file's style so the patches apply either way.
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const fix = (s) => (eol === '\n' ? s : s.replace(/\n/g, eol));
  let content = HELPER + '\n' + src;
  for (const p of PATCHES) {
    const find = fix(p.find);
    if (content.includes(find)) {
      content = content.replace(find, fix(p.replace));
      applied.push(p.name);
    } else {
      missed.push(p.name);
    }
  }
  return { content, applied, missed };
}
