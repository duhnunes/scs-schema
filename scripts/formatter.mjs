#!/usr/bin/env node
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { glob } from 'glob'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SCHEMAS_GLOB = 'data/schemas/*.json'

const ROOT_ORDER = [
  'meta',
  'scope',
  'description',
  'superclass',
  'versionNote',
  'allowsSiiNunitRoot',
  'key',
]
const META_FIELD_ORDER = ['version', 'documentationStatus']
const KEY_FIELD_ORDER = [
  'description',
  'type',
  'isArray',
  'values',
  'pointsTo',
  'status',
  'default',
  'expectedExtensions',
  'required',
  'versionNote',
  'supportsLocalization',
  'internalOnly',
  'notes',
]

// List fields that should be a one-item array instead of a bare value when
// a contributor typed it that way by hand — normalized for consistency, but
// never invented when the field is legitimately null/missing (that stays a
// validate.mjs concern, not something formatter.mjs should mask). Their
// order is kept as written: enum values follow the engine's order.
const ARRAY_NORMALIZED_FIELDS = new Set(['values', 'pointsTo', 'expectedExtensions'])

function orderObject(obj, desiredOrder) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj
  const out = {}
  for (const k of desiredOrder) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k]
  }
  for (const k of Object.keys(obj)) {
    if (!desiredOrder.includes(k)) out[k] = obj[k]
  }
  return out
}

function normalizeToArray(val) {
  if (val === null || val === undefined) return val
  if (Array.isArray(val)) return val.slice()
  return [String(val)]
}

/** Applies the array-normalization rule above to whichever of
 *  ARRAY_NORMALIZED_FIELDS are present on an attribute object. */
function normalizeArrayFields(obj) {
  for (const field of ARRAY_NORMALIZED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(obj, field)) continue
    if (obj[field] === null || obj[field] === undefined) continue

    obj[field] = normalizeToArray(obj[field])
  }
}

function reorderSchema(schema) {
  const ordered = orderObject(schema, ROOT_ORDER)

  if (ordered.meta && typeof ordered.meta === 'object') {
    ordered.meta = orderObject(ordered.meta, META_FIELD_ORDER)
  }

  if (ordered.key && typeof ordered.key === 'object' && !Array.isArray(ordered.key)) {
    const newKey = {}
    for (const attrName of Object.keys(ordered.key)) {
      const attr = ordered.key[attrName]
      if (!attr || typeof attr !== 'object' || Array.isArray(attr)) {
        newKey[attrName] = attr
        continue
      }
      const orderedAttr = orderObject(attr, KEY_FIELD_ORDER)
      normalizeArrayFields(orderedAttr)
      newKey[attrName] = orderedAttr
    }
    ordered.key = newKey
  }

  return ordered
}

async function processFile(relPath) {
  const abs = path.resolve(__dirname, '..', relPath)
  const raw = await fs.readFile(abs, 'utf8')

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    console.error(`Skipping ${relPath} - invalid JSON: ${err.message}`)
    return false
  }

  const reordered = reorderSchema(parsed)
  const out = JSON.stringify(reordered, null, 2) + '\n'

  if (out !== raw) {
    await fs.writeFile(abs, out, 'utf8')
    console.log(`Formatted ${relPath}`)
    return true
  }
  console.log(`No changes for ${relPath}`)
  return false
}

async function main() {
  const files = glob.sync(SCHEMAS_GLOB, { nodir: true })
  console.log(`Found ${files.length} files`)
  if (files.length === 0) {
    console.log('No schema files found')
    return
  }

  let changedAny = false
  for (const file of files) {
    try {
      if (await processFile(file)) changedAny = true
    } catch (err) {
      console.error(`Error processing ${file}: ${err.stack || err}`)
    }
  }

  console.log(
    changedAny
      ? 'Some files were reformatted. Commit the changes or fail CI as desired.'
      : 'All schemas already formatted.'
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
