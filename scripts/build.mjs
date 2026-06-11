#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { glob } from 'glob';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const SCHEMAS_DIR = path.join(DATA_DIR, 'schemas');
const OUT = path.join(DATA_DIR, 'manifest.json');

const REPO_USER = 'duhnunes';
const REPO_NAME = 'scs-schema';

function sha256(buf) { return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex'); }
function gitRevParseHead() { return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); }
function git(cmd) { return execSync(cmd, { stdio: 'inherit' }); }

async function loadManifest() {
  try { return JSON.parse(await fs.readFile(OUT, 'utf8')); }
  catch { return { version: '', generatedAt: '', schemas: {} }; }
}

function makeKeyFromRel(rel) {
  return path.basename(rel, '.json');
}

async function build(ref = null, { doCommit = true } = {}) {
  if (!ref) ref = gitRevParseHead();

  // ensure remote refs available (so BASE_REF like origin/master works)
  try { execSync('git fetch --no-tags --prune origin', { stdio: 'ignore' }); } catch (e) {}

  // load existing manifest
  const manifest = await loadManifest();

  // compute changed files relative to BASE_REF
  const BASE_REF = process.env.BASE_REF || 'origin/master';
  let changedSet = new Set();
  try {
    const diffOut = execSync(`git diff --name-only ${BASE_REF}..HEAD -- ${SCHEMAS_DIR} || true`, { encoding: 'utf8' }).trim();
    if (diffOut) {
      diffOut.split('\n').map(s => s.trim()).filter(Boolean).forEach(p => {
        // normalize to path relative to data dir like rel below (e.g. "schemas/def/.../file.json")
        const relPath = path.relative(DATA_DIR, path.resolve(p)).replace(/\\/g, '/');
        changedSet.add(relPath);
      });
    }
  } catch (e) {
    // ignore; changedSet stays empty
  }

  const pattern = path.join(SCHEMAS_DIR, '**', '*.json').replace(/\\/g, '/');
  const files = await glob(pattern, { nodir: true });

  const urlBase = `https://cdn.jsdelivr.net/gh/${REPO_USER}/${REPO_NAME}@commit/${ref}`;

  for (const file of files) {
    if (path.resolve(file) === path.resolve(OUT)) continue;

    const raw = await fs.readFile(file);
    const parsed = JSON.parse(raw.toString('utf8'));
    const rel = path.relative(DATA_DIR, file).replace(/\\/g, '/'); // same format as changedSet entries
    const key = makeKeyFromRel(rel);
    const computedHash = sha256(raw);
    const computedSize = raw.length;
    const idField = `${rel}`;
    const pathField = `./${rel}`;
    const nameField = path.basename(rel, '.json');
    const metaVersion = parsed.meta?.version || '';
    const description = parsed.meta?.description || '';

    if (!manifest.schemas) manifest.schemas = {};

    const existingEntry = manifest.schemas[key];
    const shouldUpdateUrl = changedSet.has(rel) || !existingEntry || !existingEntry.url;
    const urlValue = shouldUpdateUrl ? `${urlBase}/${rel}` : (existingEntry && existingEntry.url) || '';

    manifest.schemas[key] = {
      id: idField,
      name: nameField,
      path: pathField,
      url: urlValue,
      metaVersion,
      hash: computedHash,
      size: computedSize,
      description
    };

    console.log('Prepared manifest entry for', key, '->', manifest.schemas[key].url || '(no url)');
  }

  // set manifest.version from env or package.json if present
  let pkgVersion = null;
  try {
    const pkg = JSON.parse(await fs.readFile(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
    pkgVersion = pkg.version;
  } catch (e) {}

  const releaseItVersion = process.env.RELEASE_VERSION || process.env.npm_package_version || null;
  if (releaseItVersion) manifest.version = releaseItVersion;
  else if (pkgVersion) manifest.version = pkgVersion;

  manifest.generatedAt = new Date().toISOString();

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('Wrote manifest with ref', ref);

  if (doCommit) {
    try {
      git(`git add ${OUT}`);
      git(`git commit -m "chore(manifest): manifest for ${ref}"`);
      git('git push origin HEAD');
      console.log('Committed and pushed manifest.json');
    } catch (err) {
      console.error('Git commit/push failed:', err);
      throw err;
    }
  }
}

// CLI parsing
const argv = process.argv.slice(2);
let refArg = null;
let doCommit = true;
for (const a of argv) {
  if (a === '--no-commit') doCommit = false;
  else if (!refArg) refArg = a;
}
build(refArg, { doCommit }).catch(e => { console.error(e); process.exit(1); });
