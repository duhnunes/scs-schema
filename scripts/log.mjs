import chalk from 'chalk'

export function logUpdateSummary(stats) {
  console.log(chalk.green(`✔ Added: ${stats.added}`))
  console.log(
    chalk.yellow(
      `⚠ Bumped: ${stats.bumped} (patch: ${stats.patch}, minor: ${stats.minor}, major: ${stats.major})`
    )
  )
  console.log(chalk.blue(`ℹ Unchanged: ${stats.unchanged}`))
}

export function logBuildSummary(stats, ref) {
  console.log(chalk.gray(`Built against ref: ${ref}`))
  console.log(chalk.green(`✔ Added: ${stats.added}`))
  console.log(chalk.yellow(`⚠ URL updated (hash changed): ${stats.updated}`))
  console.log(chalk.red(`✘ Removed: ${stats.removed}`))
  console.log(chalk.blue(`ℹ Unchanged: ${stats.unchanged}`))
}
