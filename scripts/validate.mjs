#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { glob } from 'glob'
import Ajv from 'ajv'
import { resolveAncestorChain } from './lib/inheritance.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')

const ajv = new Ajv({ allErrors: true })
const schemaPath = path.join(ROOT_DIR, '.vscode', 'db.schema.json')
const jsonSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
const validateShape = ajv.compile(jsonSchema)

function main() {
  const files = glob.sync('data/schemas/*.json', { cwd: ROOT_DIR })
  const errors = []
  const schemas = new Map() // scope -> parsed schema, for the cross-file checks below
  const scopeOwners = new Map() // scope -> file that claims it, to catch duplicates

  // Pass 1: parse + shape-validate each file on its own. A file that
  // fails here (bad JSON, or doesn't match db.schema.json) is skipped
  // for the cross-file checks in pass 2 — there's nothing reliable to
  // check inheritance against if the shape itself is already wrong.
  for (const file of files) {
    const abs = path.join(ROOT_DIR, file)
    const raw = fs.readFileSync(abs, 'utf8')

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      errors.push(`${file}: invalid JSON (${err.message})`)
      continue
    }

    if (!validateShape(parsed)) {
      for (const err of validateShape.errors) {
        errors.push(`${file}: ${err.instancePath || '/'} ${err.message}`)
      }
      continue
    }

    const expectedScope = path.basename(file, '.json')
    if (parsed.scope !== expectedScope) {
      errors.push(
        `${file}: "scope" is "${parsed.scope}", but the file name implies "${expectedScope}" — they must match`
      )
    }

    const existingOwner = scopeOwners.get(parsed.scope)
    if (existingOwner) {
      errors.push(`${file}: scope "${parsed.scope}" is already used by ${existingOwner}`)
      continue
    }

    scopeOwners.set(parsed.scope, file)
    schemas.set(parsed.scope, parsed)
  }

  // Pass 2: cross-file checks that need every schema loaded first —
  // JSON Schema alone can only validate one file in isolation, so a bad
  // `superclass` (typo, or a genuine cycle) can't be caught in pass 1.
  for (const scope of schemas.keys()) {
    try {
      resolveAncestorChain(scope, schemas)
    } catch (err) {
      errors.push(`${scopeOwners.get(scope)}: ${err.message}`)
    }
  }

  if (errors.length > 0) {
    console.error(`❌ ${errors.length} problem(s) found:\n`)
    for (const message of errors) {
      console.error(`   - ${message}`)
    }
    process.exit(1)
  }

  console.log(`✅ All ${schemas.size} schema file(s) are valid!`)
}

main()
