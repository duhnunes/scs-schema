#!/usr/bin/env node
import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import semver from 'semver';

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: opts.stdio || 'pipe' }).trim();
}

async function bumpFileVersionFromFile(filePath, bumpType) {
  const raw = await fs.readFile(filePath, 'utf8')
  let parsed
  try { parsed = JSON.parse(raw) }
  catch (e) { throw new Error(`Invalid JSON is ${filePath}: ${e.message}`) }

  if (!parsed.meta) parsed.meta = {}
  const currentFileVersion = parsed.meta.version && semver.valid(parsed.meta.version) ? parsed.meta.version : '0.0.0'

  const fileNewVersion = semver.inc(currentFileVersion, bumpType)
  if (!fileNewVersion) {
    throw new Error(`Failed to increment version for ${filePath} from ${currentFileVersion} using bump ${bumpType}`)
  }

  if (parsed.meta.version === fileNewVersion) return false

  parsed.meta.version = fileNewVersion
  await fs.writeFile(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf8')
  return fileNewVersion
}

function getLatestTag() {
  try { return run('git describe --tags --abbrev=0'); } catch { return null; }
}

function getCommitsSince(range) {
  try { return run(`git log ${range} --pretty=%B`); } catch { return ''; }
}

function decideBumpFromCommits(commits) {
  if (!commits || !commits.trim()) return 'patch';
  const msgs = commits.split('\n\n').map(s => s.trim()).filter(Boolean);
  let bump = 'patch';
  for (const m of msgs) {
    const header = m.split('\n')[0] || '';
    if (/BREAKING CHANGE|BREAKING-CHANGE|!:/.test(m) || /!$/.test(header)) {
      return 'major';
    }
    if (/^feat(\(|:)/m.test(header)) {
      bump = bump === 'patch' ? 'minor' : bump;
    }
    if (/^fix(\(|:)/m.test(header)) {
      bump = bump; // patch
    }
  }
  return bump;
}

async function listChangedSchemaFiles(baseRef) {
  try {
    const out = run('git diff --name-only --diff-filter=AM ${baseRef}..HEAD -- data/schemas || true')
    if (out) return out.split('\n').filter(Boolean)
      return []
  } catch (e) {
    if (!baseRef) {
      try {
        const tracked = run('git ls-files data/schemas || true').split('\n').filter(Boolean)
        const untracked = run('git ls-files --others --exclude-standard data/schemas || true').split('\n').filter(Boolean)
        const set = new Set([...tracked, ...untracked])
        return Array.from(set)
      } catch (err) {
        throw new Error('Failed to list schema files: ' + err.message)
      }
    }
    return []
  }
}

async function main() {
  try {
    // Ensure we have remote refs
    try { run('git fetch --no-tags --prune origin'); } catch {}

    // Determine baseRef for diff: prefer env BASE_REF, else latest tag, else origin/master if exists, else root
    const envBase = process.env.BASE_REF;
    let baseRef = envBase || getLatestTag();
    if (!baseRef) {
      try {
        // try origin/master or origin/main
        try { run('git rev-parse --verify origin/master'); baseRef = 'origin/master'; } catch {}
        if (!baseRef) { try { run('git rev-parse --verify origin/main'); baseRef = 'origin/main'; } catch {} }
      } catch {}
    }
    if (!baseRef) {
      try { baseRef = run('git rev-list --max-parents=0 HEAD'); } catch { baseRef = 'HEAD~1'; }
    }
    console.log('Using baseRef for diff:', baseRef);

    // Determine current version: prefer package.json, else 0.0.0
    let currentVersion = '0.0.0';
    try {
      const pkgRaw = await fs.readFile('package.json', 'utf8');
      const pkg = JSON.parse(pkgRaw);
      if (pkg.version && semver.valid(pkg.version)) {
        currentVersion = pkg.version;
        console.log('Using package.json version as current version:', currentVersion);
      } else {
        console.log('package.json has no valid version; defaulting to 0.0.0');
      }
    } catch {
      console.log('package.json not found or invalid; defaulting to 0.0.0');
    }

    // Decide bump type from commits since baseRef
    const commits = getCommitsSince(baseRef ? `${baseRef}..HEAD` : 'HEAD');
    const autoBump = decideBumpFromCommits(commits);
    console.log('Auto-detected bump type from commits:', autoBump);

    const envBump = (process.env.BUMP_TYPE || '').toLowerCase();
    const bumpType = envBump && envBump !== 'auto' ? envBump : autoBump;
    if (!['major','minor','patch'].includes(bumpType)) {
      console.error('Invalid bump type:', bumpType);
      process.exit(1);
    }

    const newVersion = semver.inc(currentVersion, bumpType);
    if (!newVersion) {
      console.error('Failed to calculate new version from', currentVersion, bumpType);
      process.exit(1);
    }

    console.log(`Current version: ${currentVersion}`);
    console.log(`Bump type: ${bumpType}`);
    console.log(`New version: ${newVersion}`);

    // Find changed schema files relative to baseRef
    const changed = await listChangedSchemaFiles(baseRef);
    if (!changed.length) {
      console.log('No schema files changed since', baseRef);
      process.exit(0);
    }
    console.log('Schema files to consider:', changed);

    const updated = [];
    for (const f of changed) {
      const full = path.resolve(f)
      if (!full.startsWith(path.resolve('data', 'schemas'))) {
        console.log('Skipping non-schema file:', f)
        continue
      }
      try {
        const fileNewVersion = await bumpFileVersionFromFile(full, bumpType)
        if (fileNewVersion) {
          updated.push(f)
          console.log(`Bumped ${f} -> ${fileNewVersion}`)
        } else {
          console.log(`No bump needed for ${f} (already at target)`)
        }
      } catch (err) {
        console.error('Failed to bump version for', f, err)
        process.exit(1)
      }
    }

    if (!updated.length) {
      console.log('No schema files needed version bump (already at', newVersion, ')');
      process.exit(0);
    }

    // commit + push (no tag)
    try {
      run('git config user.name "github-actions[bot]"');
      run('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
      run(`git add ${updated.map(f => `"${f}"`).join(' ')}`);
      run(`git commit -m "chore(schema): bump meta.version to ${newVersion} for ${updated.length} file(s) [ci skip]"`);
    } catch (err) {
      console.error('Failed to commit bumped files:', err);
      process.exit(1);
    }

    // push: try direct push; if fails (protected branch), create release branch and push that
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    let remoteUrl = null;
    try { remoteUrl = run('git config --get remote.origin.url'); } catch {}

    const pushRef = 'HEAD';
    try {
      if (GITHUB_TOKEN && remoteUrl && remoteUrl.startsWith('https://')) {
        const authUrl = remoteUrl.replace('https://', `https://${GITHUB_TOKEN}@`);
        run(`git push ${authUrl} ${pushRef}`);
      } else {
        run(`git push origin ${pushRef}`);
      }
      console.log('Pushed commit to origin');
    } catch (err) {
      console.warn('Direct push failed (branch protection?), creating release branch and pushing that instead.');
      const releaseBranch = `release/v${newVersion}`;
      try {
        run(`git checkout -b ${releaseBranch}`);
        if (GITHUB_TOKEN && remoteUrl && remoteUrl.startsWith('https://')) {
          const authUrl = remoteUrl.replace('https://', `https://${GITHUB_TOKEN}@`);
          run(`git push ${authUrl} ${releaseBranch}`);
        } else {
          run(`git push origin ${releaseBranch}`);
        }
        console.log(`Pushed to branch ${releaseBranch}. Please open a PR to merge into the main branch.`);
      } catch (err2) {
        console.error('Failed to push release branch:', err2);
        process.exit(1);
      }
    }

    console.log('Bump completed. Updated files:', updated.length);
    process.exit(0);
  } catch (err) {
    console.error('Unexpected error:', err);
    process.exit(1);
  }
}

main();
