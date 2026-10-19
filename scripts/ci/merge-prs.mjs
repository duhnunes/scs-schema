#!/usr/bin/env node
// Used by builder.yml: squash-merges every open PR labeled `validated`.
// Runs from the master checkout only. See pr.mjs for the security rules.
//
// Each PR is checked again right before merging, against master as it is
// at that moment (including PRs merged earlier in this same run): two PRs
// can each be valid alone and still break each other, e.g. one deletes a
// class the other uses as `superclass`. The merge call is pinned to the
// exact commit that was checked, so a push that lands in between makes
// GitHub refuse the merge instead of merging unchecked code.
//
// PRs from first-time contributors, or that delete a schema, are merged
// only once an approver has approved that exact commit (see
// approvalReasons/isApproved in pr.mjs); until then they're skipped.
//
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY.

import {
  api,
  approvalReasons,
  checkPr,
  comment,
  fetchPrHead,
  git,
  isApproved,
  setManagedLabels,
} from './pr.mjs'

const open = await api('GET', '/pulls?state=open&per_page=100&sort=created&direction=asc')
const candidates = open.filter((pr) => !pr.draft && pr.labels.some((l) => l.name === 'validated'))
console.log(`${candidates.length} validated PR(s): ${candidates.map((pr) => `#${pr.number}`).join(' ') || '-'}`)

let merged = 0
for (const pr of candidates) {
  const number = pr.number
  console.log(`::group::PR #${number}`)
  try {
    const headSha = fetchPrHead(number)
    if (headSha !== pr.head.sha) {
      console.log(`PR #${number} moved since it was listed, leaving it for the next run`)
      continue
    }

    const result = checkPr('HEAD', headSha)
    if (!result.autoMergeable) {
      const labels = result.valid ? [] : ['invalid-schema']
      if (result.changes.docs.length > 0) labels.push('documentation')
      if (result.changes.system.length > 0) labels.push('system')
      await setManagedLabels(number, labels)
      // Valid but not schema-only (e.g. a docs file was added later):
      // the labels already say it waits for the owner, no comment needed.
      if (result.valid) continue
      await comment(
        number,
        '### ❌ Not merged\n\nThe PR no longer passes against the current `master`' +
          (result.problems.length ? ':\n\n' + result.problems.join('\n\n') : '.') +
          '\n\nUpdate the branch and push again.'
      )
      continue
    }

    const reasons = approvalReasons(pr, result.changes)
    if (reasons.length > 0 && !(await isApproved(number, headSha))) {
      console.log(`PR #${number} waits for approval: ${reasons.join('; ')}`)
      continue
    }

    const commits = await api('GET', `/pulls/${number}/commits?per_page=100`)
    const trailers = [
      ...new Set(commits.map((c) => `Co-authored-by: ${c.commit.author.name} <${c.commit.author.email}>`)),
    ].join('\n')

    try {
      await api('PUT', `/pulls/${number}/merge`, {
        merge_method: 'squash',
        sha: headSha,
        commit_title: `${pr.title} (#${number})`,
        commit_message: trailers,
      })
    } catch (err) {
      // 405: not mergeable (conflict); 409: head moved since we checked it.
      if (err.status !== 405 && err.status !== 409) throw err
      console.log(`PR #${number} not merged: ${err.message}`)
      if (err.status === 405) {
        await setManagedLabels(number, ['validated', 'conflict'])
        await comment(
          number,
          '### ⚠️ Conflict with `master`\n\nThis PR is valid but cannot be merged automatically. ' +
            'Update your branch with the latest `master` and push again.'
        )
      }
      continue
    }

    merged++
    console.log(`PR #${number} merged`)
    // Next PR must be checked against master *including* this merge.
    git(['pull', '--ff-only', 'origin', 'master'])
  } finally {
    console.log('::endgroup::')
  }
}

console.log(`Merged ${merged} PR(s)`)
