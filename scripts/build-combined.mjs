// build-combined.mjs
// Stitch one or more Pencil export_html files into a single combined.html where
// each exported frame becomes one <section class="slide"> at its NATIVE size.
//
// Policy:
//   - Target deck is fixed 16:9 (set in export-pptx.mjs). Here we only preserve each
//     slide's native size so dom-to-pptx can contain-fit (uniform scale, centered,
//     no distortion) any non-16:9 slide into the deck.
//   - Image fills come out of Pencil as CSS background-image divs. dom-to-pptx
//     rasterizes those natively (background-size/position preserved), and keeping
//     the div keeps its flex geometry — converting to <img> would give it the
//     file's natural size and blow out flex rows. Local files get base64-inlined
//     at render time by export-pptx.mjs (a file:// image taints the canvas and the
//     image is silently dropped); remote URLs load via CORS.
//   - Non-16:9 slides trigger a warning. The original .pen is never modified.
//
// Usage:
//   node scripts/build-combined.mjs [--out exports/combined.html] [--aspect 16:9] <slideA.html> [slideB.html ...]
//   If no input files are given, defaults to exports/slide-*.html (sorted), then exports/spike-*.html.

import fs from 'node:fs';
import path from 'node:path';
import { resolveWorkspace } from './workspace.mjs';

// This script operates on a target project (the directory containing the .pen).
// Pencil's relative asset refs resolve against the cwd first, then each HTML
// file's own directory. Default input/output paths point at the configured
// pen2ppt workspace (PEN2PPT_WORKSPACE / ~/.config/pen2ppt/workspace) when one
// is set, else at ./exports under the cwd.
const PROJECT_ROOT = process.cwd();
const DEFAULT_EXPORTS = resolveWorkspace() ?? path.join(PROJECT_ROOT, 'exports');

const argv = process.argv.slice(2);
const get = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : dflt;
};
const outPath = get('--out', path.join(DEFAULT_EXPORTS, 'combined.html'));
const aspectStr = get('--aspect', '16:9');
const flagValuePositions = new Set(
  ['--out', '--aspect'].flatMap((f) => {
    const i = argv.indexOf(f);
    return i >= 0 ? [i, i + 1] : [];
  })
);
const inputs = argv.filter((a, i) => !a.startsWith('--') && !flagValuePositions.has(i));

const parseAspect = (s) => {
  const m = String(s).match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  return m ? parseFloat(m[1]) / parseFloat(m[2]) : 16 / 9;
};
const TARGET_ASPECT = parseAspect(aspectStr);
const ASPECT_TOL = 0.01;

const globSorted = (pattern) => {
  const dir = path.dirname(pattern);
  const base = path.basename(pattern);
  if (!base.includes('*')) return fs.existsSync(pattern) ? [pattern] : [];
  const re = new RegExp('^' + base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace('*', '.*') + '$');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => re.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => path.join(dir, f));
};

let files = inputs.length
  ? inputs
  : [
      ...globSorted(path.join(DEFAULT_EXPORTS, 'slide-*.html')),
      ...globSorted(path.join(DEFAULT_EXPORTS, 'spike-*.html')),
    ];
files = files.filter((f) => fs.existsSync(f));
if (!files.length) {
  console.error('No input HTML files found. Pass files as args or place exports/slide-*.html.');
  process.exit(1);
}

const DEFAULT_HEAD = `
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<script>tailwind = { config: { corePlugins: { preflight: false } } };</script>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Geist%3Awght%40100..900&family=Geist+Mono%3Awght%40100..900&family=Inter%3Awght%40100..900&display=swap" rel="stylesheet" />
<style>*, ::before, ::after { box-sizing: border-box; } body { margin: 0; }</style>`;

const headInner = (() => {
  const first = fs.readFileSync(files[0], 'utf8');
  const m = first.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  return m ? m[1] : DEFAULT_HEAD;
})();

const parseDims = (body) => {
  const root = body.match(/<div[^>]*class="([^"]*)"/);
  const cls = root ? root[1] : body;
  const wm = cls.match(/w-\[(\d+(?:\.\d+)?)px\]/);
  const hm = cls.match(/h-\[(\d+(?:\.\d+)?)px\]/);
  return { w: wm ? parseFloat(wm[1]) : null, h: hm ? parseFloat(hm[1]) : null };
};

const warnings = [];

// 1. Read raw bodies.
let bodies = files.map((file) => {
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return (m ? m[1] : html).trim();
});

// 2. Copy referenced local image assets next to combined.html (before conversion,
//    while the original bg-[url()] refs are still present).
const outDir = path.dirname(path.resolve(outPath));
const assetRefs = new Set();
const refRe = /(?:url\(\s*['"]?|src=['"])([^'")]+)/gi;
for (const body of bodies) {
  let mm;
  while ((mm = refRe.exec(body)) !== null) {
    const ref = mm[1].trim().replace(/[)'"]+$/, '');
    if (/^(https?:)?\/\//i.test(ref) || ref.startsWith('data:') || ref.startsWith('#')) continue;
    assetRefs.add(ref);
  }
}
const copiedAssets = [];
for (const ref of assetRefs) {
  const candidates = [
    path.join(PROJECT_ROOT, ref),
    ...files.map((f) => path.join(path.dirname(path.resolve(f)), ref)),
  ];
  const src = candidates.find((c) => fs.existsSync(c));
  if (!src) { warnings.push(`asset not found: ${ref}`); continue; }
  const dest = path.join(outDir, ref);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  copiedAssets.push(ref);
}

// 3. Build native-size sections (image fills stay as bg-image divs; see header).

const sections = bodies.map((body, idx) => {
  const { w: Wi, h: Hi } = parseDims(body);
  const id = `slide-${String(idx + 1).padStart(2, '0')}`;
  if (Wi && Hi) {
    const a = Wi / Hi;
    if (Math.abs(a - TARGET_ASPECT) / TARGET_ASPECT > ASPECT_TOL) {
      warnings.push(`slide ${idx + 1} (${path.basename(files[idx])}) is ${Wi}x${Hi} (aspect ${a.toFixed(3)}), not ${aspectStr} -> contain-fit (letterboxed, no distortion).`);
    }
  }
  const style = [
    Wi ? `width:${Wi}px` : null,
    Hi ? `height:${Hi}px` : null,
    'position:relative',
    'margin:0 auto 24px',
  ].filter(Boolean).join(';');
  return `<section class="slide" id="${id}" data-source="${path.basename(files[idx])}" ${Wi ? `data-width="${Wi}"` : ''} ${Hi ? `data-height="${Hi}"` : ''} style="${style}">\n${body}\n</section>`;
});

const doc = `<!doctype html>
<html lang="en">
<head>${headInner}
<style>html,body{margin:0;padding:0;background:#ffffff;}body{padding:24px 0;}</style>
</head>
<body>
${sections.join('\n\n')}
</body>
</html>`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, doc, 'utf8');
console.log(`target aspect: ${aspectStr} (${TARGET_ASPECT.toFixed(4)})`);
console.log(`combined ${files.length} slide(s) -> ${outPath}`);
files.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
copiedAssets.forEach((a) => console.log(`  asset: ${a}`));
for (const w of warnings) console.log(`WARN: ${w}`);
