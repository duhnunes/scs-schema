// Shared PR helpers for checker.yml and builder.yml.
//
// SECURITY: both workflows run with a write-capable token, so they must
// NEVER execute code that comes from a pull request. Everything here runs
// from the master checkout; a PR only ever contributes *data*: the blob
// contents of data/schemas/*.json, read with `git show` and written to
// disk by this process. Paths are checked against a strict allowlist
// before use, every git call goes through execFileSync with an argument
// array (no shell), and PR text (title, body, branch name) is only ever
// sent back to the GitHub API as JSON, never interpolated into a command.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT_DIR = path.resolve(__dirname, '..', '..')

const SCHEMA_PATH = /^data\/schemas\/[a-z0-9_]+\.json$/
const GENERATED_PATH = /^data\/(dist\/|manifest\.json$)/
const DOC_PATH = /^(README\.md|CHANGELOG\.md|CONTRIBUTING\.md|CODE_OF_CONDUCT\.md|LICENSE(\.md)?|docs\/)/

export function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: ROOT_DIR,
    encoding: options.encoding === null ? undefined : 'utf8',
    maxBuffer: 1024 * 1024 * 64,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** Fetches a PR's head into a local ref. refs/pull/N/head lives in the
 *  base repository, so this works for fork PRs without touching the fork. */
export function fetchPrHead(number) {
  const ref = `refs/remotes/pr/${number}`
  git(['fetch', '--no-tags', 'origin', `+refs/pull/${number}/head:${ref}`])
  return git(['rev-parse', ref]).trim()
}

/**
 * Lists what a PR changes relative to `baseRef`, from the merge base (the
 * same three-dot diff GitHub shows), and sorts every path into a bucket:
 * - schemas:   regular files matching data/schemas/<class_name>.json
 * - generated: data/dist/ or data/manifest.json (CI-only, always rejected)
 * - docs:      documentation files (needs the owner's review)
 * - system:    anything else (needs the owner's review)
 * - invalid:   paths under data/schemas/ that aren't a plain lowercase
 *              <name>.json regular file (subfolders, symlinks, other names)
 */
export function classifyChanges(baseRef, headSha) {
  const raw = git(['diff', '--name-status', '--no-renames', '-z', `${baseRef}...${headSha}`])
  const parts = raw.split('\0').filter(Boolean)

  const result = { schemas: [], generated: [], docs: [], system: [], invalid: [] }
  for (let i = 0; i < parts.length; i += 2) {
    const status = parts[i]
    const file = parts[i + 1]
    const deleted = status === 'D'

    if (GENERATED_PATH.test(file)) result.generated.push(file)
    else if (file.startsWith('data/schemas/')) {
      if (SCHEMA_PATH.test(file) && (deleted || fileMode(headSha, file) === '100644')) {
        result.schemas.push({ file, deleted })
      } else {
        result.invalid.push(file)
      }
    } else if (DOC_PATH.test(file)) result.docs.push(file)
    else result.system.push(file)
  }
  return result
}

function fileMode(sha, file) {
  const line = git(['ls-tree', sha, '--', file]).trim()
  return line.split(/\s+/)[0]
}

/** Writes the PR's version of each changed schema over the working tree
 *  (which must be a master checkout), deleting the ones the PR deletes.
 *  The result is "master as it would be after merging this PR". */
export function overlaySchemas(headSha, schemas) {
  for (const { file, deleted } of schemas) {
    const abs = path.join(ROOT_DIR, file)
    if (deleted) fs.rmSync(abs, { force: true })
    else fs.writeFileSync(abs, git(['show', `${headSha}:${file}`], { encoding: null }))
  }
}

/** Undoes overlaySchemas(): back to the committed master state. */
export function resetSchemas() {
  git(['checkout', 'HEAD', '--', 'data/schemas'])
  git(['clean', '-fdq', '--', 'data/schemas'])
}

/** Runs master's own validate.mjs against whatever is on disk now. */
export function runValidate() {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT_DIR, 'scripts', 'validate.mjs')], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    })
    return { ok: true, output: out.trim() }
  } catch (err) {
    return { ok: false, output: `${err.stdout || ''}${err.stderr || ''}`.trim() }
  }
}

/** Full check of one PR against the current master checkout. Leaves the
 *  working tree clean again. */
export function checkPr(baseRef, headSha) {
  // resetSchemas() discards local edits, so refuse to start on a dirty
  // tree (e.g. someone running this on their own machine by mistake).
  if (git(['status', '--porcelain', '--', 'data/schemas']).trim()) {
    throw new Error('data/schemas/ has uncommitted changes; run this only on a clean CI checkout')
  }
  const changes = classifyChanges(baseRef, headSha)
  const problems = []

  if (changes.generated.length > 0) {
    problems.push(
      'These files are generated by CI and must not be edited in a PR:\n' +
        changes.generated.map((f) => `- \`${f}\``).join('\n')
    )
  }
  if (changes.invalid.length > 0) {
    problems.push(
      'Files in `data/schemas/` must be regular files named `<class_name>.json` ' +
        '(lowercase letters, digits and `_`), with no subfolders:\n' +
        changes.invalid.map((f) => `- \`${f}\``).join('\n')
    )
  }

  let validation = null
  if (changes.schemas.length > 0 && changes.invalid.length === 0) {
    try {
      overlaySchemas(headSha, changes.schemas)
      validation = runValidate()
    } finally {
      resetSchemas()
    }
    if (!validation.ok) problems.push('Schema validation failed:\n```\n' + validation.output + '\n```')
  }

  const onlySchemas =
    changes.schemas.length > 0 &&
    changes.generated.length + changes.invalid.length + changes.docs.length + changes.system.length === 0

  return { changes, problems, validation, valid: problems.length === 0, autoMergeable: onlySchemas && problems.length === 0 }
}

// ---------------------------------------------------------------- GitHub API

export async function api(method, url, body) {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPOSITORY
  if (!token || !repo) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY must be set')

  const res = await fetch(`https://api.github.com/repos/${repo}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const err = new Error(`${method} ${url} -> ${res.status}: ${data?.message || text}`)
    err.status = res.status
    throw err
  }
  return data
}

const LABELS = {
  validated: ['006400', 'Schema-only PR that passed validation; merged by the next build'],
  'invalid-schema': ['E74C3C', 'PR failed the automated schema checks'],
  documentation: ['0075ca', 'Improvements or additions to documentation'],
  system: ['34495E', "Touches files outside data/schemas/; needs the owner's review"],
  conflict: ['B60205', 'PR conflicts with master; needs to be updated'],
}

/** Sets exactly `wanted` among the labels this automation manages,
 *  leaving any other label (added by a human) untouched. */
export async function setManagedLabels(number, wanted) {
  const current = (await api('GET', `/issues/${number}/labels`)).map((l) => l.name)
  for (const name of current) {
    if (name in LABELS && !wanted.includes(name)) {
      await api('DELETE', `/issues/${number}/labels/${encodeURIComponent(name)}`)
    }
  }
  const missing = wanted.filter((name) => !current.includes(name))
  for (const name of missing) await ensureLabel(name)
  if (missing.length > 0) await api('POST', `/issues/${number}/labels`, { labels: missing })
}

async function ensureLabel(name) {
  const [color, description] = LABELS[name]
  try {
    await api('POST', '/labels', { name, color, description })
  } catch (err) {
    if (err.status !== 422) throw err // 422 = already exists
  }
}

export async function comment(number, body) {
  await api('POST', `/issues/${number}/comments`, { body })
}

export function parsePrNumber(value) {
  if (!/^[1-9][0-9]*$/.test(String(value ?? ''))) throw new Error(`Invalid PR number: "${value}"`)
  return Number(value)
}
