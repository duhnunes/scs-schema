#!/usr/bin/env node
import { promises as fs } from 'fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { logBuildSummary, logSummary } from './log.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', 'data')
const SCHEMAS_DIR = path.join(DATA_DIR, 'schemas')
const MANIFEST = path.join(DATA_DIR, 'manifest.json')

const REPO_USER = process.env.REPO_USER || 'duhnunes'
const REPO_NAME = process.env.REPO_NAME || 'scs-schema'

function gitRevParseHead() {
  return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
}

async function loadManifest() {
  return JSON.parse(await fs.readFile(MANIFEST, 'utf8'))
}

function getChangedFiles(baseRef, headRef) {
  try {
    const diffOut = execSync(
      `git diff --name-only ${baseRef}..${headRef} -- ${SCHEMAS_DIR}`,
      { encoding: 'utf8' }
    ).trim()
    return diffOut ? diffOut.split('\n').map(s => s.trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

async function build(ref = null, verbose = false) {
  const startBuild = Date.now()

  if (!ref) {
    try {
      ref = process.env.REF || gitRevParseHead()
    } catch {
      ref = 'HEAD'
    }
  }

  const urlBase = `https://cdn.jsdelivr.net/gh/${REPO_USER}/${REPO_NAME}@${ref}`

  const manifest = await loadManifest()

  const baseRef = process.env.BASE_REF || 'origin/master'
  const changedFiles = new Set(getChangedFiles(baseRef, ref))

  let updatedUrls = 0
  for (const key of Object.keys(manifest.schemas)) {
    const schema = manifest.schemas[key]
    if (changedFiles.has(schema.id) || !schema.url) {
      const newUrl = `${urlBase}/${schema.id}`
      if (schema.url !== newUrl) {
        schema.url = newUrl
        updatedUrls++
      }
    }
  }

  manifest.generatedAt = new Date().toISOString()
  await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  if(verbose) {
    console.log('Datailed build changes:')
    for (const key of Object.keys(manifest.schemas)) {
      const schema = manifest.schemas[key]
      if (changedFiles.has(schema.id)) {
        console.log(`⚠ Updated URL for ${schema.id} -> ${schema.url}`)
      }
    }
  } else {
    logBuildSummary({
      updated: updatedUrls,
      unchanged: Object.keys(manifest.schemas).length - updatedUrls
    }, ref)
  }

  const endBuild = Date.now()
  const duration = (endBuild - startBuild) / 1000
  console.log(`⏱ Finished in ${duration.toFixed(2)} seconds`)
}

// CLI
const argv = process.argv.slice(2)
let refArg = null
let verbose = false

for (const a of argv) {
  if (a === '--verbose') verbose = true
  else if (!refArg) refArg = a
}

build(refArg, verbose).catch(e => {
  console.error(e)
  process.exit(1)
})
