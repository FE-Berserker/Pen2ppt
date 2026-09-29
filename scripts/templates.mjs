// templates.mjs
// Template library for pen2ppt: list, scaffold from, and import templates.
//
// Two merged sources (personal templates shadow built-ins with the same id):
//   built-in: <skill>/templates/<id>/            (ships with the repo)
//   personal: <workspace>/_templates/<id>/       (user's machine, never in git)
//
// A template directory holds: template.pen (required; any single *.pen works),
// optional asset dirs referenced by the .pen (images/, assets/, ...), an
// optional template.json ({name, description, tags}), optional SPEC.md
// (design guidance for the agent) and an optional preview.pptx (humans only).
//
// Usage:
//   node scripts/templates.mjs list                          list all templates
//   node scripts/templates.mjs new <id> <deck-name> [--force]  scaffold <workspace>/<deck-name>/ from a template
//   node scripts/templates.mjs add <source-dir> [id] [--force] import a folder as a personal template

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWorkspace, deckDir, slugify, USER_TEMPLATES_DIRNAME } from './workspace.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_ROOT = path.resolve(__dirname, '..', 'templates');

const userTemplatesRoot = () => {
  const w = resolveWorkspace();
  return w ? path.join(w, USER_TEMPLATES_DIRNAME) : null;
};

// Inspect one template directory. Returns null when it holds no usable .pen.
function inspect(dir, source) {
  const id = path.basename(dir);
  let meta = {};
  const metaFile = path.join(dir, 'template.json');
  if (fs.existsSync(metaFile)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    } catch (e) {
      meta = { _warn: `template.json unreadable (${e.message})` };
    }
  }
  const pens = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pen'));
  const pen = pens.includes('template.pen') ? 'template.pen' : pens.length === 1 ? pens[0] : null;
  if (!pen) {
    return { id, source, invalid: pens.length ? `multiple .pen files, name one template.pen` : `no .pen file` };
  }
  return {
    id,
    source,
    dir,
    pen,
    name: typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : id,
    description: typeof meta.description === 'string' ? meta.description.trim() : '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    hasSpec: fs.existsSync(path.join(dir, 'SPEC.md')),
    warn: meta._warn || null,
  };
}

const scanRoot = (root, source) =>
  !root || !fs.existsSync(root)
    ? []
    : fs
        .readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => inspect(path.join(root, e.name), source));

function listTemplates() {
  const builtin = scanRoot(BUILTIN_ROOT, 'built-in');
  const personal = scanRoot(userTemplatesRoot(), 'user');
  const personalIds = new Set(personal.map((t) => t.id));
  for (const t of builtin) if (personalIds.has(t.id)) t.shadowed = true;
  return [...builtin, ...personal];
}

function resolveTemplate(id) {
  const all = listTemplates().filter((t) => t.id === id);
  const personal = all.find((t) => t.source === 'user');
  return personal || all[0] || null;
}

// Files the agent's deck never needs: metadata and human-only previews.
const skipOnScaffold = (name) => name === 'template.json' || /^preview\./i.test(name);

function cmdList() {
  const all = listTemplates();
  if (!all.length) {
    console.log('No templates found.');
    console.log(`  built-in root: ${BUILTIN_ROOT}`);
    console.log(`  personal root: ${userTemplatesRoot() ?? '(workspace not configured)'}`);
    return;
  }
  for (const t of all) {
    if (t.invalid) {
      console.log(`- ${t.id} [${t.source}] INVALID: ${t.invalid}`);
      continue;
    }
    const bits = [`- ${t.id}`, t.name !== t.id ? `— ${t.name}` : null, `[${t.source}${t.shadowed ? ', shadowed by user template' : ''}]`].filter(Boolean);
    console.log(bits.join(' '));
    if (t.description) console.log(`    ${t.description}`);
    if (t.warn) console.log(`    WARN: ${t.warn}`);
  }
}

function cmdNew(id, deckName, force) {
  if (!id || !deckName) {
    console.error('Usage: node scripts/templates.mjs new <template-id> <deck-name> [--force]');
    process.exit(1);
  }
  if (!resolveWorkspace()) {
    console.error('workspace not configured: set PEN2PPT_WORKSPACE or run workspace.mjs set <path>');
    process.exit(1);
  }
  const t = resolveTemplate(id);
  if (!t) {
    console.error(`unknown template "${id}". Available:`);
    cmdList();
    process.exit(1);
  }
  if (t.invalid) {
    console.error(`template "${id}" is invalid: ${t.invalid}`);
    process.exit(1);
  }
  let dir;
  try {
    dir = deckDir(deckName); // creates <workspace>/<slug>
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const slug = path.basename(dir);
  if (!force && fs.readdirSync(dir).length > 0) {
    console.error(`${dir} is not empty — refusing to overwrite an existing deck (use --force to proceed anyway)`);
    process.exit(1);
  }
  for (const entry of fs.readdirSync(t.dir, { withFileTypes: true })) {
    if (skipOnScaffold(entry.name)) continue;
    const destName = entry.name === t.pen ? `${slug}.pen` : entry.name;
    fs.cpSync(path.join(t.dir, entry.name), path.join(dir, destName), { recursive: true });
  }
  console.log(`deck: ${dir}`);
  console.log(`pen:  ${path.join(dir, `${slug}.pen`)}`);
  if (t.hasSpec) console.log(`spec: ${path.join(dir, 'SPEC.md')} (read before authoring new pages)`);
}

function cmdAdd(sourceDir, id, force) {
  if (!sourceDir) {
    console.error('Usage: node scripts/templates.mjs add <source-dir> [id] [--force]');
    process.exit(1);
  }
  const src = path.resolve(sourceDir);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    console.error(`not a directory: ${src}`);
    process.exit(1);
  }
  const root = userTemplatesRoot();
  if (!root) {
    console.error('workspace not configured: set PEN2PPT_WORKSPACE or run workspace.mjs set <path>');
    process.exit(1);
  }
  const tplId = slugify(id || path.basename(src));
  if (tplId.toLowerCase() === USER_TEMPLATES_DIRNAME.toLowerCase()) {
    console.error(`"${tplId}" is reserved; pick another template id.`);
    process.exit(1);
  }
  const dest = path.join(root, tplId);
  if (fs.existsSync(dest)) {
    if (!force) {
      console.error(`${dest} already exists (use --force to overwrite)`);
      process.exit(1);
    }
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.cpSync(src, dest, { recursive: true });

  // Normalize: one template.pen, one SPEC.md, one preview.pptx.
  const pens = fs.readdirSync(dest).filter((f) => f.toLowerCase().endsWith('.pen'));
  const pen = pens.includes('template.pen') ? 'template.pen' : pens.length === 1 ? pens[0] : null;
  if (!pen) {
    fs.rmSync(dest, { recursive: true, force: true });
    console.error(
      pens.length
        ? `multiple .pen files found (${pens.join(', ')}) — keep exactly one, or name it template.pen`
        : `no .pen file found in ${src}`
    );
    process.exit(1);
  }
  if (pen !== 'template.pen') fs.renameSync(path.join(dest, pen), path.join(dest, 'template.pen'));
  const singles = (re) => {
    const hits = fs.readdirSync(dest).filter((f) => re.test(f));
    return hits.length === 1 ? hits[0] : null;
  };
  const md = singles(/\.md$/i);
  if (md && md !== 'SPEC.md') fs.renameSync(path.join(dest, md), path.join(dest, 'SPEC.md'));
  const pptx = singles(/\.pptx$/i);
  if (pptx && pptx !== 'preview.pptx') fs.renameSync(path.join(dest, pptx), path.join(dest, 'preview.pptx'));
  if (!fs.existsSync(path.join(dest, 'template.json'))) {
    fs.writeFileSync(
      path.join(dest, 'template.json'),
      JSON.stringify({ name: tplId, description: '', tags: [] }, null, 2) + '\n',
      'utf8'
    );
  }
  console.log(`imported: ${dest}`);
  console.log('edit template.json there to set a display name and description.');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith('templates.mjs');
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const force = rest.includes('--force');
  const args = rest.filter((a) => a !== '--force');
  if (cmd === 'list') cmdList();
  else if (cmd === 'new') cmdNew(args[0], args[1], force);
  else if (cmd === 'add') cmdAdd(args[0], args[1], force);
  else {
    console.error('Usage: node scripts/templates.mjs list | new <id> <deck-name> [--force] | add <source-dir> [id] [--force]');
    process.exit(cmd ? 1 : 0);
  }
}
