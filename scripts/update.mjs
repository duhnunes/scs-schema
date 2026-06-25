#!/usr/bin/env node

import { promises as fs } from 'fs'
import path from 'node:path'
import crypto from 'crypto'
import { execSync } from 'node:child_process'
import semver from 'semver'
import { fileURLToPath } from 'node:url'
import { logSummary } from './log.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', 'data')
const SCHEMAS_DIR = path.join(DATA_DIR, 'schemas')
const MANIFEST = path.join(DATA_DIR, 'manifest.json')

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: opts.stdio || 'pipe' }).trim()
}

function sha256(buf){
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex')
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) files.push(...await walk(full))
    else if (e.isFile() && e.name.endsWith('.json')) files.push(full)
  }
  return files
}

function getLatestTag() {
  try { return run('git describe --tags --abbrev=0') } catch { return null }
}

function getCommitsSince(range) {
  try { return run(`git log ${range} --pretty=%B`) }
  catch { return '' }
}

function decideBumpFromCommits(commits) {
  if (!commits.trim()) return 'patch'
  const msgs = commits.split('\n').map(s => s.trim()).filter(Boolean)
  let bump = 'patch'
  for (const m of msgs) {
    if (/BREAKING CHANGE|!:/.test(m)) return 'major'
    if (/^feat(\(|:)/.test(m)) bump = bump === 'patch' ? 'minor' : bump
  }
  return bump
}

function getFileBumps(range) {
  const output = run(`git log --pretty=%H --name-only ${range}`)
  const lines = output.split('\n')
  const fileBumps = {}
  let currentCommit = null

  for (const line of lines) {
    if (/^[0-9a-f]{40}$/.test(line)) {
      currentCommit = line
    } else if (line.trim()) {
      const msg = run(`git log -1 --pretty=%B ${currentCommit}`)
      const bumpType = decideBumpFromCommits(msg)

      const prev = fileBumps[line]
      if (prev === 'major' || bumpType === 'major') {
        fileBumps[line] = 'major'
      } else if (prev === 'minor' || bumpType === 'minor') {
        fileBumps[line] = 'minor'
      } else {
        fileBumps[line] = 'patch'
      }
    }
  }
  return fileBumps
}

async function loadManifest() {
  try { return JSON.parse(await fs.readFile(MANIFEST, 'utf8')) }
  catch { return { version: '', generatedAt: '', schemas: {} } }
}

async function main() {
  const startMain = Date.now()

  const manifest = await loadManifest()
  const files = await walk(SCHEMAS_DIR)

  let baseRef = getLatestTag() || 'origin/master'
  const fileBumps = getFileBumps(`${baseRef}..HEAD`)

  const seenKeys = new Set()
  let updatedCount = 0

  const stats = {
    added: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
    patch: 0,
    minor: 0,
    major: 0
  }

  for (const file of files) {
    const raw = await fs.readFile(file)
    const parsed = JSON.parse(raw.toString('utf8'))
    
    // Update manifest
    const rel = path.relative(path.resolve(__dirname, '..'), file).replace(/\\/g, '/')
    const key = path.basename(rel, '.json')
    const hash = sha256(raw)
    const size = raw.length
    const description = parsed.meta?.description || ''

    seenKeys.add(key)

    // update only if have changes version or hash
    const prevEntry = manifest.schemas[key]
    const currentVersion = parsed.meta?.version && semver.valid(parsed.meta.version) ? parsed.meta.version : '0.1.0'

    // bump version
    let newVersion = currentVersion
    const isNewFile = !prevEntry
    const needsUpdate = isNewFile || prevEntry.hash !== hash || prevEntry.size !== size

    if (needsUpdate) {
      const bumpType = fileBumps[rel] || 'patch'

      if (isNewFile) {
        newVersion = '0.1.0'
        stats.added++
      } else {
        newVersion = semver.inc(currentVersion, bumpType)
        stats.updated++
        stats[bumpType]++
      }
        parsed.meta.version = newVersion

        const updatedRaw = raw.toString('utf8').replace(
          /"version"\s*:\s*"[^"]+"/,
          `"version": "${newVersion}"`
        )
        await fs.writeFile(file, updatedRaw, 'utf8')

        manifest.schemas[key] = {
          id: rel,
          name: key,
          path: './' + rel,
          metaVersion: parsed.meta.version,
          url: prevEntry?.url || '',
          hash: sha256(Buffer.from(updatedRaw, 'utf8')),
          size: updatedRaw.length,
          description
        }

        updatedCount++
      } else {
        stats.unchanged++
      }
    }

  // remove stale entries
  for (const existingKey of Object.keys(manifest.schemas)) {
    if (!seenKeys.has(existingKey)) {
      stats.removed++
      delete manifest.schemas[existingKey]
      updatedCount++
    }
  }

  if (updatedCount > 0) {
    manifest.generatedAt = new Date().toISOString()
    await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    console.log(`Manifest updated - ${updatedCount} changes.`)
  } else {
    console.log(`No changes detected, manifest untouched.`)
  }

  if(verbose) {
    console.log('\nDetailed changes:')
    for (const key of Object.keys(manifest.schemas)) {
      const schema = manifest.schemas[key]
      if (!schema) continue
      console.log(`- ${key}: version=${schema.metaVersion}`)
    }
  } else {
    logSummary(stats)
  }
  const endMain = Date.now()
  const duration = (endMain - startMain) / 1000
  console.log(`⏱ Finished in ${duration.toFixed(2)} seconds`)
}

// CLI
const argv = process.argv.slice(2)
let refArg = argv[0] || null
let verbose = false
for (const a of argv) {
  if (a === '--verbose') verbose = true
  else if (!refArg) refArg = a
}

main().catch(err => { console.error(err.message); process.exit(1) })
