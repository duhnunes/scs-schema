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

/**
 * Merges `key` maps root-first, so a closer ancestor (or the class
 * itself) always wins on a name collision. Attributes copied in from an
 * ancestor are stamped with `inheritedFrom`; the class's own attributes
 * are left exactly as authored, with no `inheritedFrom` at all.
 */
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

async function build(ref, verbose) {
  const startedAt = Date.now()

  if (!ref) ref = process.env.REF || gitRevParseHead()
  const urlBase = `https://cdn.jsdelivr.net/gh/${REPO_USER}/${REPO_NAME}@${ref}`

  const schemas = await loadSourceSchemas()
  const existingManifest = await loadExistingManifest()
  const newManifest = {
    formatVersion: FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    schemas: {},
  }

  await fs.mkdir(DIST_DIR, { recursive: true })

  const stats = { added: 0, updated: 0, removed: 0, unchanged: 0 }

  // Every class is reprocessed on every run, not just ones that changed
  // in some git diff — a change to a parent's file changes every
  // descendant's flattened output too, even though the descendant's own
  // source file didn't change at all. Re-flattening everything is cheap
  // (pure local JSON work, no network); what's NOT cheap-to-churn is the
  // manifest, so the URL for a class only gets rewritten when its hash
  // actually changed.
  for (const scope of schemas.keys()) {
    const flattened = buildFlattenedSchema(scope, schemas)
    const distContent = JSON.stringify(flattened, null, 2) + '\n'
    await fs.writeFile(path.join(DIST_DIR, `${scope}.json`), distContent, 'utf8')

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
    if (!schemas.has(scope)) {
      stats.removed++
      await fs.rm(path.join(DIST_DIR, `${scope}.json`), { force: true })
    }
  }

  await fs.writeFile(MANIFEST, JSON.stringify(newManifest, null, 2) + '\n', 'utf8')

  if (verbose) {
    for (const [scope, entry] of Object.entries(newManifest.schemas)) {
      console.log(`- ${scope}: ${entry.hash.slice(0, 22)}... -> ${entry.url}`)
    }
  } else {
    logBuildSummary(stats, ref)
  }

  console.log(`⏱ Finished in ${((Date.now() - startedAt) / 1000).toFixed(2)}s`)
}

const argv = process.argv.slice(2)
let refArg = null
let verbose = false
for (const a of argv) {
  if (a === '--verbose') verbose = true
  else if (!refArg) refArg = a
}

build(refArg, verbose).catch((err) => {
  console.error(err.message)
  process.exit(1)
})
