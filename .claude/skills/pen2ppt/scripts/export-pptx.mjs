// export-pptx.mjs
// Headless HTML -> editable PPTX, using dom-to-pptx's browser bundle but with our
// own puppeteer launch (dom-to-pptx 2.0.3 mis-handles puppeteer 25's async
// executablePath() and falls back to Microsoft Edge, which fails to launch here).
//
// Usage:
//   node scripts/export-pptx.mjs <input.html|url> [-o out.pptx] [--selector .slide]
//        [--width 13.333] [--height 7.5] [--browser <path to chrome/msedge>]

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const get = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const has = (flag) => argv.includes(flag);
const flagIdx = new Set(
  ['-o', '--output', '--selector', '--width', '--height', '--browser'].flatMap((f) => {
    const i = argv.indexOf(f);
    return i >= 0 ? [i, i + 1] : [];
  })
);
const inputs = argv.filter((a, i) => !a.startsWith('-') && !flagIdx.has(i));
const input = inputs[0];
if (!input) {
  console.error('Usage: node scripts/export-pptx.mjs <input.html> [-o out.pptx] [--selector .slide] [--width 13.333] [--height 7.5]');
  process.exit(1);
}
const output = get('-o', get('--output', 'exports/deck.pptx'));
const selector = get('--selector', '.slide');
// Deck page size: fixed 16:9 (PowerPoint default = 13.333 x 7.5 in). Override with --width/--height (inches).
const width = parseFloat(get('--width', '13.333'));
const height = parseFloat(get('--height', '7.5'));
const browserOverride = get('--browser', null) || process.env.PUPPETEER_EXECUTABLE_PATH || null;

const bundleCandidates = [
  path.resolve(__dirname, '..', 'node_modules', 'dom-to-pptx', 'dist', 'dom-to-pptx.bundle.js'),
];
const bundlePath = bundleCandidates.find((p) => fs.existsSync(p));
if (!bundlePath) throw new Error('dom-to-pptx browser bundle not found in node_modules.');

console.log(`deck size: ${(width * 96).toFixed(0)} x ${(height * 96).toFixed(0)} px (${width.toFixed(3)} x ${height.toFixed(3)} in)`);

async function resolveExecutable() {
  if (browserOverride) {
    if (!fs.existsSync(browserOverride)) throw new Error(`Browser not found at: ${browserOverride}`);
    return browserOverride;
  }
  try {
    const p = await puppeteer.executablePath(); // async in puppeteer >= 21
    if (p && fs.existsSync(p)) return p;
  } catch (_) {
    /* fall through */
  }
  throw new Error(
    'No usable Chromium found. Pass --browser <path> or set PUPPETEER_EXECUTABLE_PATH.'
  );
}

const executablePath = await resolveExecutable();
const profileDir = path.join(os.tmpdir(), `pen2ppt-profile-${process.pid}`);
fs.mkdirSync(profileDir, { recursive: true });

// dom-to-pptx rasterizes <img> by drawing to a canvas with crossOrigin='Anonymous'.
// When the page (and its images) are loaded via file://, the canvas gets tainted
// and every image is silently dropped (item.skip = true). Inline any local image
// refs as base64 data: URLs up front so the canvas stays clean. The .pen / source
// HTML is never modified — we write a temp copy and point Puppeteer at that.
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
const isRemote = (u) => /^(https?:)?\/\//i.test(u) || u.startsWith('data:') || u.startsWith('#');
const dataUrlFor = (abs) => {
  const mime = MIME[path.extname(abs).toLowerCase()];
  if (!mime || !fs.existsSync(abs)) return null;
  return `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
};
function inlineLocalImages(html, baseDir) {
  let inlined = 0;
  const toData = (ref) => {
    const u = ref.trim().replace(/[)'"]+$/, '');
    if (!u || isRemote(u)) return null;
    const abs = path.resolve(baseDir, u);
    const d = dataUrlFor(abs);
    if (d) inlined++;
    return d;
  };
  // <img src="...">
  html = html.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(['"])([^'"]+)\2/gi, (m, pre, q, ref) => {
    const d = toData(ref);
    return d ? `${pre}${q}${d}${q}` : m;
  });
  // url(...) in inline styles / <style> blocks (bg images)
  html = html.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi, (m, ref) => {
    const d = toData(ref);
    return d ? `url('${d}')` : m;
  });
  return { html, inlined };
}

let inlinedTmp = null;
if (fs.existsSync(input)) {
  const baseDir = path.dirname(path.resolve(input));
  const raw = fs.readFileSync(input, 'utf8');
  const { html, inlined } = inlineLocalImages(raw, baseDir);
  if (inlined > 0) {
    inlinedTmp = path.join(os.tmpdir(), `pen2ppt-inlined-${process.pid}.html`);
    fs.writeFileSync(inlinedTmp, html, 'utf8');
    console.log(`inlined ${inlined} local image(s) -> ${inlinedTmp}`);
  }
}

console.log(`browser: ${executablePath}`);
const browser = await puppeteer.launch({
  headless: true,
  executablePath,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    `--user-data-dir=${profileDir}`,
  ],
});

try {
  const page = await browser.newPage();
  const target = inlinedTmp
    ? pathToFileURL(inlinedTmp).href
    : fs.existsSync(input)
      ? pathToFileURL(path.resolve(input)).href
      : input;
  await page.goto(target, { waitUntil: 'networkidle0' });
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
  await new Promise((r) => setTimeout(r, 400)); // let Tailwind Play CDN finish generating CSS

  // Layout freeze. dom-to-pptx mis-measures flex-dependent geometry: children of a
  // flex row can come out at container width (images overflow the slide) and a
  // stretch-sized bar collapses to content height (quote accent bars render short).
  // Lock every element inside a slide to its rendered pixel rect, and neutralize
  // flex grow/shrink so nothing re-flows. All rects are collected BEFORE any style
  // is written so measurement isn't disturbed mid-pass.
  const frozen = await page.evaluate((sel) => {
    const jobs = [];
    for (const root of document.querySelectorAll(sel)) {
      for (const el of root.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.display === 'contents') continue;
        const r = el.getBoundingClientRect();
        const pcs = el.parentElement ? getComputedStyle(el.parentElement) : null;
        const inFlex = !!pcs && (pcs.display === 'flex' || pcs.display === 'inline-flex');
        jobs.push({ el, w: r.width, h: r.height, inFlex });
      }
    }
    for (const j of jobs) {
      if (j.w > 0) j.el.style.width = `${j.w}px`;
      if (j.h > 0) j.el.style.height = `${j.h}px`;
      if (j.inFlex) j.el.style.flex = '0 0 auto';
    }
    return jobs.length;
  }, selector);
  console.log(`layout freeze: ${frozen} element(s) locked to rendered px`);

  await page.addScriptTag({ path: bundlePath });
  const ok = await page.evaluate(() => !!(window.domToPptx && window.domToPptx.exportToPptx));
  if (!ok) throw new Error('dom-to-pptx failed to load in page.');

  const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, selector);
  if (!count) throw new Error(`No elements match slide selector "${selector}".`);
  console.log(`slides: ${count} (selector: ${selector})`);

  const dataUrl = await page.evaluate(
    async (sel, pptxOpts) => {
      const targets = Array.from(document.querySelectorAll(sel));
      const blob = await window.domToPptx.exportToPptx(targets, { ...pptxOpts, skipDownload: true });
      return await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
    },
    selector,
    { width, height }
  );

  const base64 = String(dataUrl).split(',')[1];
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, Buffer.from(base64, 'base64'));
  console.log(`wrote: ${path.resolve(output)}`);
} finally {
  await browser.close();
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {}
  if (inlinedTmp) { try { fs.unlinkSync(inlinedTmp); } catch (_) {} }
}
