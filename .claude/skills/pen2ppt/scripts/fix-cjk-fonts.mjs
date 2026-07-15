// fix-cjk-fonts.mjs
// Post-process a .pptx so its font slots resolve to fonts that are guaranteed
// present on the target machine — fixes garbled CJK text and substituted Latin
// fonts in WPS (and missing-font fallbacks in PowerPoint) when the design used
// web fonts that are neither embedded nor installed. See WPS-CJK-FONT-FIX.md.
//
// What it does to every slide/layout/master/notes XML and theme XML:
//   1. <a:ea>  -> CJK system font (default "Microsoft YaHei"). Blanket rewrite:
//      also covers empty typeface="" and theme references (+mn-ea).
//   2. <a:latin> / <a:cs> -> system equivalents for known web fonts (default
//      table below), matched case-insensitively; --map "From=To" extends or
//      overrides, --no-latin-map disables. Unlisted typefaces are kept as-is.
//   3. Theme major/minor fonts: the same rewrites fill <a:ea typeface=""> and
//      map latin/cs, so +mn-*/+mj-* references and presentation.xml's
//      defaultTextStyle resolve to real fonts.
//   4. Runs (<a:r> / <a:fld>) whose text contains CJK characters get
//      lang="zh-CN" so WPS applies Chinese line-breaking rules.
//   5. <a:sym> is deliberately untouched (symbol fonts).
//   The charset attribute (e.g. charset="-122" = GB2312 as a signed byte) is
//   left as-is: Microsoft YaHei covers GB, so the hint stays compatible.
//
// Usage:
//   node scripts/fix-cjk-fonts.mjs deck.pptx [--dry] [--out fixed.pptx]
//        [--ea-font "Microsoft YaHei"] [--map "Anton=Arial Narrow"]... [--no-latin-map]
//
// Library:
//   import { fixCjkFontsFile } from './fix-cjk-fonts.mjs';
//   const stats = await fixCjkFontsFile('deck.pptx', { eaFont, maps, noLatinMap, dry, out });

import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

// XML parts to rewrite. ppt/theme is included so major/minor font slots and
// everything referencing them (+mn-*, defaultTextStyle) resolve correctly.
const XML_TARGET = /^ppt\/(slides\/slide|notesSlides\/notesSlide|slideLayouts\/slideLayout|slideMasters\/slideMaster|notesMasters\/notesMaster)\d+\.xml$|^ppt\/presentation\.xml$|^ppt\/theme\/theme\d+\.xml$/;

// System equivalents for common web fonts (matched case-insensitively).
export const DEFAULT_LATIN_EQUIVALENTS = {
  'Noto Sans SC': 'Microsoft YaHei',
  'Noto Sans': 'Arial',
  'Anton': 'Impact',
  'Inter': 'Arial',
  'Roboto': 'Arial',
  'Geist': 'Arial',
  'Geist Mono': 'Courier New',
};

export const DEFAULT_EA_FONT = 'Microsoft YaHei';

// CJK ideographs + radicals + CJK punctuation + fullwidth forms.
const CJK_RE = /[⺀-鿿豈-﫿　-〿！-～]/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildLatinTable(maps = [], noLatinMap = false) {
  if (noLatinMap) return [];
  // Case-insensitive matching: keep a lowercase lookup of the merged table.
  const merged = { ...DEFAULT_LATIN_EQUIVALENTS };
  for (const m of maps) {
    const i = String(m).indexOf('=');
    if (i <= 0) throw new Error(`--map expects "From=To", got: ${m}`);
    merged[String(m).slice(0, i).trim()] = String(m).slice(i + 1).trim();
  }
  return Object.entries(merged).map(([from, to]) => ({
    re: new RegExp(`(<a:(?:latin|cs)\\b[^>]*?\\btypeface=")${escapeRe(from)}(")`, 'gi'),
    from,
    to,
  }));
}

function rewriteXml(xml, { eaFont, latinTable, stats }) {
  // 1. Every East-Asian slot -> CJK font (covers +mn-ea and empty typeface).
  xml = xml.replace(/(<a:ea\b[^>]*?\btypeface=")[^"]*(")/g, (m, pre, post) => {
    stats.ea++;
    return `${pre}${eaFont}${post}`;
  });

  // 2. Latin / complex-script slots -> system equivalents (case-insensitive).
  for (const { re, to } of latinTable) {
    xml = xml.replace(re, (m, pre, post) => {
      stats.latin++;
      return `${pre}${to}${post}`;
    });
  }

  // 3. Runs containing CJK -> lang="zh-CN" (<a:fld> may carry attributes;
  //    both run kinds store their properties in a child <a:rPr>).
  xml = xml.replace(/<a:(r|fld)\b[^>]*>([\s\S]*?)<\/a:\1>/g, (run) => {
    const text = [...run.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]).join('');
    if (!CJK_RE.test(text)) return run;
    return run.replace(/<a:rPr\b([^>]*?)(\/?>)/, (m, attrs, close) => {
      if (!/lang="/.test(attrs)) {
        stats.lang++;
        return `<a:rPr${attrs} lang="zh-CN"${close}`;
      }
      if (!/lang="zh-CN"/.test(attrs)) {
        stats.lang++;
        return `<a:rPr${attrs.replace(/lang="[^"]*"/, 'lang="zh-CN"')}${close}`;
      }
      return m;
    });
  });

  return xml;
}

function tallyTypefaces(xml, stats) {
  for (const m of xml.matchAll(/<a:(latin|ea|cs)\b[^>]*?\btypeface="([^"]*)"/g)) {
    const key = `a:${m[1]} -> ${m[2] || '(empty)'}`;
    stats.typefaces[key] = (stats.typefaces[key] || 0) + 1;
  }
}

export async function fixCjkFontsFile(file, opts = {}) {
  const eaFont = opts.eaFont || DEFAULT_EA_FONT;
  const latinTable = buildLatinTable(opts.maps, opts.noLatinMap);
  const dry = !!opts.dry;
  const out = opts.out || file;

  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  const zip = await JSZip.loadAsync(fs.readFileSync(file));

  const stats = { files: 0, ea: 0, latin: 0, lang: 0, typefaces: {}, before: {} };
  const targets = Object.keys(zip.files).filter((f) => XML_TARGET.test(f) && !zip.files[f].dir);

  for (const name of targets) {
    const original = await zip.files[name].async('string');
    tallyTypefaces(original, { typefaces: stats.before });
    const fixed = rewriteXml(original, { eaFont, latinTable, stats });
    if (fixed !== original) {
      stats.files++;
      if (!dry) zip.file(name, fixed);
    }
  }
  if (!dry) {
    for (const name of targets) tallyTypefaces(await zip.files[name].async('string'), stats);
  } else {
    // For --dry, simulate the "after" tally without touching the zip.
    for (const name of targets) {
      const original = await zip.files[name].async('string');
      tallyTypefaces(rewriteXml(original, { eaFont, latinTable, stats: { ea: 0, latin: 0, lang: 0 } }), stats);
    }
  }

  if (!dry) {
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, buf);
  }
  return stats;
}

function formatTally(t) {
  const bySlot = {};
  for (const [k, v] of Object.entries(t)) {
    const slot = k.split(' ')[0];
    (bySlot[slot] = bySlot[slot] || {})[k.slice(k.indexOf('->') + 3)] = v;
  }
  return Object.entries(bySlot)
    .map(([slot, fonts]) => `${slot} -> ${JSON.stringify(fonts)}`)
    .join('\n  ');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith('fix-cjk-fonts.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  const get = (flag, dflt) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  const has = (flag) => argv.includes(flag);
  const flagIdx = new Set(
    ['--out', '--ea-font', '--map'].flatMap((f) => {
      const i = argv.indexOf(f);
      return i >= 0 ? [i, i + 1] : [];
    })
  );
  // --map is repeatable: collect every value.
  const maps = argv.filter((a, i) => argv[i - 1] === '--map');
  const input = argv.filter((a, i) => !a.startsWith('--') && !flagIdx.has(i))[0];

  if (!input) {
    console.error('Usage: node scripts/fix-cjk-fonts.mjs deck.pptx [--dry] [--out fixed.pptx] [--ea-font "Microsoft YaHei"] [--map "From=To"]... [--no-latin-map]');
    process.exit(1);
  }

  try {
    const stats = await fixCjkFontsFile(input, {
      dry: has('--dry'),
      out: get('--out', null),
      eaFont: get('--ea-font', DEFAULT_EA_FONT),
      maps,
      noLatinMap: has('--no-latin-map'),
    });
    console.log(`${has('--dry') ? '[dry] ' : ''}${input}`);
    console.log(`  XML parts changed: ${stats.files}`);
    console.log(`  rewrites: a:ea x${stats.ea}, a:latin/a:cs x${stats.latin}, lang=zh-CN x${stats.lang}`);
    console.log(`  before:\n  ${formatTally(stats.before)}`);
    console.log(`  after:\n  ${formatTally(stats.typefaces)}`);
    if (!has('--dry')) console.log(`  wrote: ${path.resolve(get('--out', null) || input)}`);
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
}
