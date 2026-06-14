#!/usr/bin/env node
import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { glob } from 'glob'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', 'data')
const SCHEMAS_DIR = path.join(DATA_DIR, 'schemas')
const OUT = path.join(DATA_DIR, 'manifest.json')

const REPO_USER = process.env.REPO_USER || 'duhnunes'
const REPO_NAME = process.env.REPO_NAME || 'scs-schema'

function sha256(buf) { return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex') }
function gitRevParseHead() { return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim() }

async function loadManifest() {
  try { return JSON.parse(await fs.readFile(OUT, 'utf8')) }
  catch { return { version: '', generatedAt: '', schemas: {} } }
}

function makeKeyFromRel(rel) {
  return path.basename(rel, '.json')
}

async function build(ref = null, { doCommit = true } = {}) {
  if (!ref) ref = process.env.REF || gitRevParseHead()

  try { execSync('git fetch --no-tags --prune origin', { stdio: 'ignore' }) } catch (e) {}

  const manifest = await loadManifest()

  const BASE_REF = process.env.BASE_REF || 'origin/master'
  let changedSet = new Set()
  try {
    const diffOut = execSync(`git diff --name-only ${BASE_REF}..HEAD -- ${SCHEMAS_DIR} || true`, { encoding: 'utf8' }).trim()
    if (diffOut) {
      const repoRoot = path.resolve(__dirname, '..')
      diffOut.split('\n').map(s => s.trim()).filter(Boolean).forEach(p => {
        const relPath = path.relative(repoRoot, path.resolve(p)).replace(/\\/g, '/')
        changedSet.add(relPath)
      })
    }
  } catch (e) {}

  const pattern = path.join(SCHEMAS_DIR, '**', '*.json').replace(/\\/g, '/')
  const files = await glob(pattern, { nodir: true })

  const urlBase = `https://cdn.jsdelivr.net/gh/${REPO_USER}/${REPO_NAME}@${ref}`

  for (const file of files) {
    if (path.resolve(file) === path.resolve(OUT)) continue

    const raw = await fs.readFile(file)
    const parsed = JSON.parse(raw.toString('utf8'))
    const repoRoot = path.resolve(__dirname, '..')
    const rel = path.relative(repoRoot, path.resolve(file)).replace(/\\/g, '/')
    const key = makeKeyFromRel(rel)
    const computedHash = sha256(raw)
    const computedSize = raw.length
    const idField = `${rel}`
    const pathField = `./${rel}`
    const nameField = path.basename(rel, '.json')
    const metaVersion = parsed.meta?.version || ''
    const description = parsed.meta?.description || ''

    if (!manifest.schemas) manifest.schemas = {}

    const existingEntry = manifest.schemas[key]
    const shouldUpdateUrl = changedSet.has(rel) || !existingEntry || !existingEntry.url
    const urlValue = shouldUpdateUrl ? `${urlBase}/${rel}` : (existingEntry && existingEntry.url) || ''

    manifest.schemas[key] = {
      id: idField,
      name: nameField,
      path: pathField,
      url: urlValue,
      metaVersion,
      hash: computedHash,
      size: computedSize,
      description
    }

    console.log('Prepared manifest entry for', key, '->', manifest.schemas[key].url || '(no url)')
  }

  // Keep manifest.version untouched (project-level version not used here)
  manifest.generatedAt = new Date().toISOString()

  await fs.mkdir(path.dirname(OUT), { recursive: true })
  await fs.writeFile(OUT, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log('Wrote manifest with ref', ref)

}

// CLI parsing
const argv = process.argv.slice(2)
let refArg = null
let doCommit = true
for (const a of argv) {
  if (a === '--no-commit') doCommit = false
  else if (!refArg) refArg = a
}
build(refArg, { doCommit }).catch(e => { console.error(e); process.exit(1) })
