import chalk from 'chalk'

export function logSummary(stats) {
  console.log(chalk.green(`✔ Added: ${stats.added}`))
  console.log(chalk.yellow(`⚠ Updated: ${stats.updated} (patch: ${stats.patch}, minor: ${stats.minor}, major: ${stats.major})`))
  console.log(chalk.red(`✘ Removed: ${stats.removed}`))
  console.log(chalk.blue(`ℹ Unchanged: ${stats.unchanged}`))
}

export function logBuildSummary(stats) {
  console.log(chalk.yellow(`⚠ URLs updated: ${stats.updated}`))
  console.log(chalk.blue(`ℹ URTLs unchanged: ${stats.unchanged}`))
}
