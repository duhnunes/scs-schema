#!/usr/bin/env node
// Used by checker.yml: checks one PR and labels/comments on it.
// Runs from the master checkout only. See pr.mjs for the security rules.
//
// Env: PR_NUMBER, GITHUB_TOKEN, GITHUB_REPOSITORY.

import {
  api,
  approvalReasons,
  checkPr,
  comment,
  fetchPrHead,
  isApproved,
  parsePrNumber,
  setManagedLabels,
} from './pr.mjs'

const number = parsePrNumber(process.env.PR_NUMBER)
const pr = await api('GET', `/pulls/${number}`)

if (pr.state !== 'open') {
  console.log(`PR #${number} is ${pr.state}, nothing to do`)
  process.exit(0)
}
if (pr.draft) {
  console.log(`PR #${number} is a draft, skipping until it's ready for review`)
  process.exit(0)
}

const headSha = fetchPrHead(number)
if (headSha !== pr.head.sha) {
  // A newer push landed between the event and this run; its own run checks it.
  console.log(`PR #${number} moved to ${pr.head.sha}, skipping stale ${headSha}`)
  process.exit(0)
}

const result = checkPr('origin/master', headSha)
const { changes } = result
console.log(JSON.stringify({ number, headSha, ...result }, null, 2))

const reasons = result.autoMergeable ? approvalReasons(pr, changes) : []
const awaiting = reasons.length > 0 && !(await isApproved(number, headSha))

const labels = []
if (!result.valid) labels.push('invalid-schema')
else if (result.autoMergeable) labels.push('validated')
if (awaiting) labels.push('awaiting-approval')
if (changes.docs.length > 0) labels.push('documentation')
if (changes.system.length > 0) labels.push('system')
const added = await setManagedLabels(number, labels)

// Only when the label is new, so later pushes don't repeat the comment.
if (added.includes('awaiting-approval')) {
  await comment(
    number,
    '### ✅ Valid — waiting for approval\n\nThe automated checks passed. This PR will be merged automatically ' +
      'by the next daily build once the repository owner approves it, because ' +
      reasons.join(' and ') +
      '.\n\nPushing new commits after the approval requires a new approval.'
  )
}

if (!result.valid) {
  await comment(
    number,
    `### ❌ Automated check failed\n\nChecked commit ${headSha}.\n\n` +
      result.problems.join('\n\n') +
      '\n\nPush a fix to this branch and the check runs again. ' +
      `See [CONTRIBUTING.md](https://github.com/${process.env.GITHUB_REPOSITORY}/blob/master/CONTRIBUTING.md) for the rules.`
  )
  process.exit(1)
}

if (awaiting) {
  console.log(`PR #${number} is valid but waits for approval: ${reasons.join('; ')}`)
} else if (result.autoMergeable) {
  console.log(`PR #${number} is valid and schema-only: it will be merged by the next build`)
} else {
  console.log(`PR #${number} touches files outside data/schemas/: left for the owner's review`)
}
