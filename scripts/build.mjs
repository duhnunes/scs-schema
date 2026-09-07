#!/usr/bin/env node
import { promises as fs } from 'fs'
import path from 'node:path'
import crypto from 'crypto'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { logBuildSummary } from './log.mjs'
import { resolveAncestorChain, ROOT_SUPERCLASS } from './lib/inheritance.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', 'data')
const SCHEMAS_DIR = path.join(DATA_DIR, 'schemas')
const DIST_DIR = path.join(DATA_DIR, 'dist')
const MANIFEST = path.join(DATA_DIR, 'manifest.json')

const REPO_USER = process.env.REPO_USER || 'duhnunes'
const REPO_NAME = process.env.REPO_NAME || 'scs-schema'
const FORMAT_VERSION = '2.0.0'

function sha256(buf) {
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex')
}

function gitRevParseHead() {
  return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
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

/** scope -> parsed source schema. Keyed by `scope`, not filename, since
 *  that's what `superclass` references. */
async function loadSourceSchemas() {
  const files = await walkJsonFiles(SCHEMAS_DIR)
  const schemas = new Map()

  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8')
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      throw new Error(`Invalid JSON in ${path.basename(file)}: ${err.message}`)
    }
    if (!parsed.scope) {
      throw new Error(`${path.basename(file)} is missing required field "scope"`)
    }
    if (schemas.has(parsed.scope)) {
      throw new Error(`Duplicate scope "${parsed.scope}" — check for a copy-pasted file`)
    }
    schemas.set(parsed.scope, parsed)
  }

  return schemas
}

function flattenKeys(scope, ancestorChain, schemas) {
  const merged = {}
  for (const ancestorScope of ancestorChain) {
    const ancestor = schemas.get(ancestorScope)
    for (const [attrName, attrDef] of Object.entries(ancestor.key || {})) {
      merged[attrName] = { ...attrDef, inheritedFrom: ancestorScope }
    }
  }
  const own = schemas.get(scope)
  for (const [attrName, attrDef] of Object.entries(own.key || {})) {
    merged[attrName] = { ...attrDef }
  }
  return merged
}

function flattenDynamicAttributeGroups(scope, ancestorChain, schemas) {
  const groups = []
  for (const ancestorScope of ancestorChain) {
    const ancestor = schemas.get(ancestorScope)
    for (const group of ancestor.dynamicAttributeGroups || []) {
      groups.push({ ...group, inheritedFrom: ancestorScope })
    }
  }
  const own = schemas.get(scope)
  for (const group of own.dynamicAttributeGroups || []) {
    groups.push({ ...group })
  }
  return groups
}

function buildFlattenedSchema(scope, schemas) {
  const own = schemas.get(scope)
  const ancestorChain = resolveAncestorChain(scope, schemas)
  return {
    ...own,
    inheritsFrom: ancestorChain,
    key: flattenKeys(scope, ancestorChain, schemas),
    dynamicAttributeGroups: flattenDynamicAttributeGroups(scope, ancestorChain, schemas),
  }
}

async function loadExistingManifest() {
  try {
    return JSON.parse(await fs.readFile(MANIFEST, 'utf8'))
  } catch {
    return { formatVersion: FORMAT_VERSION, generatedAt: '', schemas: {} }
  }
}

/**
 * Phase 1: writes data/dist/ ONLY — no manifest, no ref/URL needed at
 * all yet. This is what the workflow commits FIRST, so that by the time
 * phase 2 runs, dist/ genuinely exists at the commit whose SHA is about
 * to be embedded in the manifest's URLs. Doing both phases in one shot
 * (the old behavior) computed the ref BEFORE that commit existed, so
 * every URL pointed at a commit where dist/ was never actually present
 * — a 404 on the CDN, even though the content itself was correct.
 */
async function buildDist() {
  const schemas = await loadSourceSchemas()
  await fs.mkdir(DIST_DIR, { recursive: true })

  const builtScopes = new Set()
  for (const scope of schemas.keys()) {
    const flattened = buildFlattenedSchema(scope, schemas)
    const distContent = JSON.stringify(flattened, null, 2) + '\n'
    await fs.writeFile(path.join(DIST_DIR, `${scope}.json`), distContent, 'utf8')
    builtScopes.add(scope)
  }

  // Remove dist files for classes that no longer exist in data/schemas/.
  const existingDistFiles = await walkJsonFiles(DIST_DIR)
  for (const file of existingDistFiles) {
    const scope = path.basename(file, '.json')
    if (!builtScopes.has(scope)) await fs.rm(file, { force: true })
  }

  console.log(`Wrote ${builtScopes.size} file(s) to data/dist/`)
}

/**
 * Phase 2: reads whatever's already on disk in data/dist/ (written by
 * phase 1, already committed by the time this runs) and writes
 * manifest.json against the now-final `ref`. Never touches data/dist/
 * itself — the hash it records is of exactly the bytes already
 * committed, not a re-flattened copy that could in principle drift.
 */
async function buildManifest(ref, verbose) {
  if (!ref) ref = process.env.REF || gitRevParseHead()
  const urlBase = `https://cdn.jsdelivr.net/gh/${REPO_USER}/${REPO_NAME}@${ref}`

  const schemas = await loadSourceSchemas()
  const existingManifest = await loadExistingManifest()
  const newManifest = {
    formatVersion: FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    schemas: {},
  }

  const stats = { added: 0, updated: 0, removed: 0, unchanged: 0 }

  for (const scope of schemas.keys()) {
    const distPath = path.join(DIST_DIR, `${scope}.json`)
    let distContent
    try {
      distContent = await fs.readFile(distPath, 'utf8')
    } catch {
      throw new Error(
        `data/dist/${scope}.json is missing — run "build.mjs --dist-only" (and commit it) before "build.mjs --manifest-only"`
      )
    }

    const hash = sha256(Buffer.from(distContent, 'utf8'))
    const size = Buffer.byteLength(distContent, 'utf8')
    const existingEntry = existingManifest.schemas[scope]
    const isNew = !existingEntry
    const hashChanged = isNew || existingEntry.hash !== hash

    const own = schemas.get(scope)

    newManifest.schemas[scope] = {
      name: scope,
      description: own.description || '',
      url: hashChanged ? `${urlBase}/data/dist/${scope}.json` : existingEntry.url,
      hash,
      metaVersion: own.meta?.version || '0.1.0',
      size,
      superclass:
        own.superclass && own.superclass !== ROOT_SUPERCLASS ? own.superclass : null,
      documentationStatus: own.meta?.documentationStatus || 'wip',
    }

    if (isNew) stats.added++
    else if (hashChanged) stats.updated++
    else stats.unchanged++
  }

  for (const scope of Object.keys(existingManifest.schemas)) {
    if (!schemas.has(scope)) stats.removed++
  }

  await fs.writeFile(MANIFEST, JSON.stringify(newManifest, null, 2) + '\n', 'utf8')

  if (verbose) {
    for (const [scope, entry] of Object.entries(newManifest.schemas)) {
      console.log(`- ${scope}: ${entry.hash.slice(0, 22)}... -> ${entry.url}`)
    }
  } else {
    logBuildSummary(stats, ref)
  }
}

/** Default, single-shot mode — dist + manifest together, same `ref` for
 *  both. Still useful for local/manual runs where there's no CI commit
 *  boundary to split across (e.g. a contributor previewing the build on
 *  their own machine); NOT what the automated workflow should use
 *  anymore, since it has exactly the ref/dist-doesn't-exist-yet problem
 *  this file's phase split exists to avoid. */
async function buildAll(ref, verbose) {
  await buildDist()
  await buildManifest(ref, verbose)
}

async function main() {
  const startedAt = Date.now()

  const argv = process.argv.slice(2)
  let refArg = null
  let verbose = false
  let mode = 'all'
  for (const a of argv) {
    if (a === '--verbose') verbose = true
    else if (a === '--dist-only') mode = 'dist-only'
    else if (a === '--manifest-only') mode = 'manifest-only'
    else if (!refArg) refArg = a
  }

  if (mode === 'dist-only') await buildDist()
  else if (mode === 'manifest-only') await buildManifest(refArg, verbose)
  else await buildAll(refArg, verbose)

  console.log(`⏱ Finished in ${((Date.now() - startedAt) / 1000).toFixed(2)}s`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
