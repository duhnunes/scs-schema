#!/usr/bin/env node
import { promises as fs } from 'fs'
import { execSync } from 'child_process'
import path from 'path'
import semver from 'semver'

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: opts.stdio || 'pipe' }).trim()
}

async function bumpFileVersionFromFile(filePath, bumpType) {
  const raw = await fs.readFile(filePath, 'utf8')
  let parsed
  try { parsed = JSON.parse(raw) }
  catch (e) { throw new Error(`Invalid JSON in ${filePath}: ${e.message}`) }

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
  try { return run('git describe --tags --abbrev=0') } catch { return null }
}

function getCommitsSince(range) {
  try {
    // <hash>\x1f<author-name>\x1f<author-email>\x1f<header>x1f<body>\x1e
    const out = run(`git log ${range} --pretty=format:%H%x1f%an%x1f%ae%x1f%s%x1f%b%x1e`)
    if (!out) return ''
    // parse into array
    const raw = out.split('\x1e').filter(Boolean)
    const commits = raw.map(r => {
      const [hash, author, email, header, body] = r.split('\x1f')
      return { hash, author, email, header, body }
    })
    // filter bot commits / automatic commits
    const filtered = commits.filter(c => {
      const authorLower = (c.author || '').toLowerCase()
      const emailLower = (c.email || '').toLowerCase()
      const header = c.header || ''
      
      if (authorLower.includes('github-actions') || emailLower.includes('noreply')) return false
      if (/chore: bump schema/i.test(header)) return false
      return true
    })
    return filtered.map(c => `${c.header}\n\n${c.body}`).join('\n\n')
  } catch (e) {
    try {
      return run(`git log ${range} --pretty=%B`)
    } catch (err) {
      return ''
    }
  }
}

function decideBumpFromCommits(commits) {
  if (!commits || !commits.trim()) return 'patch'
  const msgs = commits.split('\n\n').map(s => s.trim()).filter(Boolean)
  let bump = 'patch'
  for (const m of msgs) {
    const header = m.split('\n')[0] || ''
    if (/BREAKING CHANGE|BREAKING-CHANGE|!:/.test(m) || /!$/.test(header)) return 'major'
    if (/^feat(\(|:)/m.test(header)) bump = bump === 'patch' ? 'minor' : bump
    if (/^fix(\(|:)/m.test(header)) bump = bump
  }
  return bump
}

async function listChangedSchemaFiles(baseRef) {
  try {
    const cmd = `git diff --name-only --diff-filter=AM ${baseRef}..HEAD -- data/schemas || true`
    const out = run(cmd)
    if (out) return out.split('\n').filter(Boolean)
    return []
  } catch (e) {
    // fallback: list tracked + untracked under data/schemas
    try {
      const tracked = run('git ls-files data/schemas || true').split('\n').filter(Boolean)
      const untracked = run('git ls-files --others --exclude-standard data/schemas || true').split('\n').filter(Boolean)
      const set = new Set([...tracked, ...untracked])
      return Array.from(set)
    } catch (err) {
      throw new Error('Failed to list schema files: ' + err.message)
    }
  }
}

async function main() {
  try {
    try { run('git fetch --no-tags --prune origin') } catch {}

    const envBase = process.env.BASE_REF
    let baseRef = envBase || getLatestTag()
    if (!baseRef) {
      try { run('git rev-parse --verify origin/master'); baseRef = 'origin/master' } catch {}
      if (!baseRef) { try { run('git rev-parse --verify origin/main'); baseRef = 'origin/main' } catch {} }
    }
    if (!baseRef) {
      try { baseRef = run('git rev-list --max-parents=0 HEAD') } catch { baseRef = 'HEAD~1' }
    }
    console.log('Using baseRef for diff:', baseRef)

    const commits = getCommitsSince(baseRef ? `${baseRef}..HEAD` : 'HEAD')
    const autoBump = decideBumpFromCommits(commits)
    const envBump = (process.env.BUMP_TYPE || '').toLowerCase()
    const bumpType = envBump && envBump !== 'auto' ? envBump : autoBump
    if (!['major','minor','patch'].includes(bumpType)) {
      console.error('Invalid bump type:', bumpType)
      process.exit(1)
    }

    console.log('Determined bump type:', bumpType)

    const changed = await listChangedSchemaFiles(baseRef)
    if (!changed.length) {
      console.log('No schema files changed since', baseRef)
      process.exit(0)
    }

    const updated = []
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
          console.log(`No bump needed for ${f}`)
        }
      } catch (err) {
        console.error('Failed to bump version for', f, err)
        process.exit(1)
      }
    }

    if (!updated.length) {
      console.log('No schema files needed version bump')
      process.exit(0)
    }

    console.log('--- bumped-files-start ---')
    for (const u of updated) console.log(u)
    console.log('--- bumped-files-end ---')

    process.exit(0)
  } catch (err) {
    console.error('Unexpected error:', err)
    process.exit(1)
  }
}

main()
