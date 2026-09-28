// workspace.mjs
// One shared output directory for every pen2ppt export, across projects.
//
// Resolution order (first hit wins):
//   1. PEN2PPT_WORKSPACE environment variable
//   2. config file ~/.config/pen2ppt/workspace (plain text: one absolute path)
//   3. unset — the CLI exits 1 and the agent asks the user for a path, then
//      persists it with `set`.
//
// `set` always writes the config file (the scripts read it, so it takes effect
// immediately) and additionally tries to register a real env var for future
// terminals — setx on Windows, an export line in ~/.bashrc / ~/.zshrc elsewhere.
// The env-var step is best-effort: already-running processes keep their old
// environment, which is exactly why the config file exists.
//
// Usage:
//   node scripts/workspace.mjs get            print the workspace root (exit 1 if unset)
//   node scripts/workspace.mjs set <path>     persist + create the workspace directory
//   node scripts/workspace.mjs dir [name]     print <workspace>/<slug(name)>, creating it

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const ENV_VAR = 'PEN2PPT_WORKSPACE';

const expandHome = (p) =>
  p === '~' || p.startsWith('~/') || p.startsWith('~\\')
    ? path.join(os.homedir(), p.slice(2))
    : p;

// Accept the path spellings users actually paste: ~, and on Windows also
// Git-Bash-style /d/foo (which path.resolve would misread as \d\foo).
const normalize = (raw) => {
  let p = expandHome(String(raw || '').trim());
  if (process.platform === 'win32') {
    const m = p.match(/^\/([a-zA-Z])[\/\\](.*)$/);
    if (m) p = `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
  }
  return p;
};

export const configFile = () => path.join(os.homedir(), '.config', 'pen2ppt', 'workspace');

// Effective workspace root, or null when nothing is configured.
export function resolveWorkspace() {
  const fromEnv = normalize(process.env[ENV_VAR]);
  if (fromEnv) return path.resolve(fromEnv);
  try {
    const fromFile = normalize(fs.readFileSync(configFile(), 'utf8'));
    if (fromFile) return path.resolve(fromFile);
  } catch {}
  return null;
}

// <workspace>/<slug(name)> — one subdirectory per deck so parallel exports
// never collide on slide-01.html. Creates the directory.
export function deckDir(name) {
  const root = resolveWorkspace();
  if (!root) return null;
  const slug =
    String(name || 'deck')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '') || 'deck';
  const dir = path.join(root, slug);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function persist(absPath) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), absPath + os.EOL, 'utf8');
  if (process.platform === 'win32') {
    const r = spawnSync('setx', [ENV_VAR, absPath], { stdio: 'pipe' });
    if (r.status !== 0) {
      console.warn(`WARN: setx failed — env var not persisted for new terminals (${String(r.stderr || r.status).trim()})`);
    }
  } else {
    for (const rc of ['.bashrc', '.zshrc']) {
      const rcPath = path.join(os.homedir(), rc);
      if (!fs.existsSync(rcPath)) continue;
      if (fs.readFileSync(rcPath, 'utf8').includes(ENV_VAR)) continue;
      fs.appendFileSync(rcPath, `\n# pen2ppt workspace\nexport ${ENV_VAR}="${absPath}"\n`, 'utf8');
    }
  }
}

const notConfigured = () => {
  console.error(
    `workspace not configured: set the ${ENV_VAR} env var or run\n` +
      `  node scripts/workspace.mjs set <path>`
  );
  process.exit(1);
};

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith('workspace.mjs');
if (isMain) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'get') {
    const w = resolveWorkspace();
    if (!w) notConfigured();
    console.log(w);
  } else if (cmd === 'set' && arg) {
    const abs = path.resolve(normalize(arg));
    fs.mkdirSync(abs, { recursive: true });
    persist(abs);
    console.log(abs);
  } else if (cmd === 'dir') {
    const d = deckDir(arg);
    if (!d) notConfigured();
    console.log(d);
  } else {
    console.error('Usage: node scripts/workspace.mjs get | set <path> | dir [name]');
    process.exit(cmd ? 1 : 0);
  }
}
