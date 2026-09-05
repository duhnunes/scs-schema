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
  'dynamicAttributeGroups',
]
const META_FIELD_ORDER = ['version', 'documentationStatus']
const KEY_FIELD_ORDER = [
  'description',
  'type',
  'isArray',
  'arrayElementType',
  'required',
  'versionNote',
  'values',
  'pointsTo',
  'expectedExtensions',
  'supportsLocalization',
  'internalOnly',
  'notes',
]
const DYNAMIC_GROUP_FIELD_ORDER = ['pattern', 'description', 'type', 'notes']

// Only `type`/`arrayElementType` (attribute-level and inside
// dynamicAttributeGroups) get sorted into this canonical order — it's
// the fixed enum from the SCS docs' Attribute types table. `values`,
// `pointsTo`, and `expectedExtensions` are free-form lists (token
// literals, class names, file extensions) with no such canonical order,
// so they're left exactly as written — only wrapped into an array if
// someone typed a bare string instead of a one-item array.
const TYPE_PRIORITY = [
  'string', 'float', 'float2', 'float3', 'float4', 'placement',
  'fixed', 'fixed2', 'fixed3', 'fixed4', 'int2', 'quaternion',
  's16', 's32', 's64', 'u16', 'u32', 'u64', 'bool', 'token',
  'owner_ptr', 'link_ptr', 'resource_tie',
]
const TYPE_PRIORITY_MAP = new Map(TYPE_PRIORITY.map((v, i) => [v, i]))

// Fields that should be a one-item array instead of a bare value when a
// contributor typed it that way by hand — normalized for consistency,
// but never invented when the field is legitimately null/missing (that
// stays a validate.mjs concern, not something formatter.mjs should mask).
const ARRAY_NORMALIZED_FIELDS = new Set([
  'type',
  'arrayElementType',
  'values',
  'pointsTo',
  'expectedExtensions',
])
// Of those, only these two get sorted into TYPE_PRIORITY order.
const TYPE_SORTED_FIELDS = new Set(['type', 'arrayElementType'])

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

function sortTypeArray(arr) {
  if (!Array.isArray(arr)) return arr
  return arr
    .map((v, idx) => ({ v, idx }))
    .sort((a, b) => {
      const pa = TYPE_PRIORITY_MAP.has(a.v) ? TYPE_PRIORITY_MAP.get(a.v) : Infinity
      const pb = TYPE_PRIORITY_MAP.has(b.v) ? TYPE_PRIORITY_MAP.get(b.v) : Infinity
      return pa !== pb ? pa - pb : a.idx - b.idx
    })
    .map((x) => x.v)
}

/** Applies the array-normalization + optional type-sorting rules above
 *  to whichever of ARRAY_NORMALIZED_FIELDS are present on `obj`. Used
 *  for both an attribute object and a dynamicAttributeGroups entry. */
function normalizeArrayFields(obj) {
  for (const field of ARRAY_NORMALIZED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(obj, field)) continue
    if (obj[field] === null || obj[field] === undefined) continue

    let value = normalizeToArray(obj[field])
    if (TYPE_SORTED_FIELDS.has(field)) value = sortTypeArray(value)
    obj[field] = value
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

  if (Array.isArray(ordered.dynamicAttributeGroups)) {
    ordered.dynamicAttributeGroups = ordered.dynamicAttributeGroups.map((group) => {
      if (!group || typeof group !== 'object' || Array.isArray(group)) return group
      const orderedGroup = orderObject(group, DYNAMIC_GROUP_FIELD_ORDER)
      normalizeArrayFields(orderedGroup)
      return orderedGroup
    })
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
