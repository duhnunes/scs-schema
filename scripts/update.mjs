#!/usr/bin/env node
import { promises as fs } from 'fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import semver from 'semver'
import { fileURLToPath } from 'node:url'
import { logUpdateSummary } from './log.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const SCHEMAS_DIR = path.join(ROOT_DIR, 'data', 'schemas')

/**
 * update.mjs's ONLY job is bumping `meta.version` in source schema files,
 * based on conventional-commit messages touching each file since the
 * last tag. It never touches the manifest, hashes, or CDN URLs — those
 * depend on the *flattened* (inheritance-resolved) content, which only
 * build.mjs computes. Splitting it this way means a change to a parent
 * class's file can never leave a descendant's manifest entry stale: the
 * descendant's own meta.version doesn't need to change for that (its
 * own attributes didn't change), but its flattened dist output and hash
 * still get recomputed correctly every time build.mjs runs, since that
 * always processes every file, not just ones that changed in this diff.
 */

function run(cmd) {
  return execSync(cmd, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 32,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function getLatestTag() {
  try {
    return run('git describe --tags --abbrev=0')
  } catch {
    return null
  }
}

/**
 * builder.yml commits with a message starting "ci(update):" after every
 * successful run of this script. Diffing from that commit (rather than
 * the last tag) means a file this script already bumped is never
 * re-bumped again just because nobody has cut a new tag since — none of
 * the current workflows ever create one, so relying on tags here would
 * mean every file gets "bumped" again on every single run, forever.
 */
function getLastAutomationCommit() {
  try {
    const hash = run('git log --grep="^ci(update):" --format=%H -n 1')
    return hash || null
  } catch {
    return null
  }
}

function refExists(ref) {
  try {
    execSync(`git rev-parse --verify ${ref}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function existedAtRef(ref, relPath) {
  try {
    execSync(`git cat-file -e ${ref}:${relPath}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function walkJsonFiles(dir) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walkJsonFiles(full)))
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(full)
  }
  return files
}

function decideBumpFromCommitBody(body) {
  if (/BREAKING CHANGE|!:/.test(body)) return 'major'
  if (/^feat(\(|:)/m.test(body)) return 'minor'
  return 'patch'
}

const BUMP_RANK = { patch: 0, minor: 1, major: 2 }
function strongerBump(a, b) {
  if (!a) return b
  if (!b) return a
  return BUMP_RANK[b] > BUMP_RANK[a] ? b : a
}

/** hash -> full commit message body (subject + footers), one git call. */
function getCommitBodies(range) {
  const SEP = '\x1f'
  let output
  try {
    output = run(`git log --pretty=format:%H${SEP}%B${SEP}${SEP} ${range}`)
  } catch (err) {
    console.error(`Warning: could not read commit bodies for ${range}: ${err.message}`)
    return {}
  }
  if (!output) return {}

  const bodies = {}
  for (const chunk of output.split(SEP + SEP)) {
    const sepIndex = chunk.indexOf(SEP)
    if (sepIndex === -1) continue
    const hash = chunk.slice(0, sepIndex).trim()
    if (hash) bodies[hash] = chunk.slice(sepIndex + 1)
  }
  return bodies
}

/** hash -> files touched, one git call (instead of one call per file, like
 *  the previous version of this script did). */
function getCommitFiles(range) {
  const MARK = '\x1f'
  let output
  try {
    output = run(`git log --name-only --pretty=format:${MARK}%H ${range}`)
  } catch (err) {
    console.error(`Warning: could not read commit file lists for ${range}: ${err.message}`)
    return {}
  }
  if (!output) return {}

  const filesByCommit = {}
  let current = null
  for (const line of output.split('\n')) {
    if (line.startsWith(MARK)) {
      current = line.slice(MARK.length).trim()
      filesByCommit[current] = []
    } else if (line.trim() && current) {
      filesByCommit[current].push(line.trim())
    }
  }
  return filesByCommit
}

/** relative file path -> strongest bump type any commit touching it since
 *  `range` implies. A file untouched by any commit in range has no entry. */
function getFileBumps(range) {
  const bodies = getCommitBodies(range)
  const filesByCommit = getCommitFiles(range)

  const fileBumps = {}
  for (const [hash, files] of Object.entries(filesByCommit)) {
    const bumpType = decideBumpFromCommitBody(bodies[hash] || '')
    for (const file of files) {
      fileBumps[file] = strongerBump(fileBumps[file], bumpType)
    }
  }
  return fileBumps
}

async function main() {
  const startedAt = Date.now()

  // Preference order: the bot's own last commit (advances every run, so
  // nothing gets re-bumped twice) > the latest tag (advances only if a
  // human cuts one) > origin/master (best-effort fallback) > nothing (a
  // brand new repo with no history to diff against at all).
  let baseRef = getLastAutomationCommit() || getLatestTag()
  if (!baseRef) {
    baseRef = refExists('origin/master') ? 'origin/master' : null
  }

  const fileBumps = baseRef ? getFileBumps(`${baseRef}..HEAD`) : {}
  const files = await walkJsonFiles(SCHEMAS_DIR)

  const stats = { added: 0, bumped: 0, unchanged: 0, patch: 0, minor: 0, major: 0 }

  for (const file of files) {
    const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/')

    // No baseRef at all (very first run in a fresh repo) means there's no
    // history to compare against — treat everything as newly added.
    const isNewFile = !baseRef || !existedAtRef(baseRef, rel)
    const bumpType = fileBumps[rel]

    if (!isNewFile && !bumpType) {
      stats.unchanged++
      continue
    }

    const raw = await fs.readFile(file, 'utf8')
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      console.error(`Skipping ${rel}: invalid JSON (${err.message})`)
      continue
    }

    parsed.meta = parsed.meta || {}

    if (isNewFile) {
      parsed.meta.version = '0.1.0'
      stats.added++
    } else {
      const currentVersion = semver.valid(parsed.meta.version) ? parsed.meta.version : '0.1.0'
      parsed.meta.version = semver.inc(currentVersion, bumpType)
      stats.bumped++
      stats[bumpType]++
    }

    await fs.writeFile(file, JSON.stringify(parsed, null, 2) + '\n', 'utf8')
  }

  logUpdateSummary(stats)
  console.log(`⏱ Finished in ${((Date.now() - startedAt) / 1000).toFixed(2)}s`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
