'use strict'

const { execFileSync, spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

const JOBS = Object.freeze({
  'linux-package': { commandArgs: ['run', 'dist:linux'] },
  'windows-package': { commandArgs: ['run', 'dist:win'] },
  'macos-package': { commandArgs: ['run', 'dist:mac'] }
})

class UsageError extends Error {}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function parseArgs(argv) {
  let job
  let dryRun = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (arg === '--job') {
      job = argv[index + 1]
      index += 1
      continue
    }
    throw new UsageError(`Unknown argument: ${arg}`)
  }
  if (!job) throw new UsageError('Missing required --job (linux-package, windows-package, or macos-package).')
  if (!Object.hasOwn(JOBS, job)) throw new UsageError(`Unknown job: ${job}`)
  return { job, dryRun }
}

function buildPlan(job, root = process.cwd()) {
  const definition = JOBS[job]
  if (!definition) throw new UsageError(`Unknown job: ${job}`)
  return {
    job,
    root,
    command: npmCommand(),
    args: definition.commandArgs,
    requiredFiles: ['package.json', 'package-lock.json'],
    requiredDirectories: ['node_modules']
  }
}

function readVersion(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32'
    }).trim() || 'unknown'
  } catch {
    return 'unavailable'
  }
}

function collectEnvironment(root) {
  const electronCli = join(root, 'node_modules', 'electron', 'cli.js')
  return {
    node: process.version,
    npm: readVersion(npmCommand(), ['--version']),
    electron: existsSync(electronCli)
      ? readVersion(process.execPath, [electronCli, '--version'])
      : 'missing'
  }
}

function checkDependencies(plan) {
  return {
    files: Object.fromEntries(plan.requiredFiles.map((file) => [file, existsSync(join(plan.root, file))])),
    directories: Object.fromEntries(plan.requiredDirectories.map((directory) => [directory, existsSync(join(plan.root, directory))]))
  }
}

function missingDependencies(status) {
  return [
    ...Object.entries(status.files).filter(([, present]) => !present).map(([name]) => name),
    ...Object.entries(status.directories).filter(([, present]) => !present).map(([name]) => name)
  ]
}

function printPlan(plan, environment, dependencies, dryRun) {
  console.log(`ci-reproduce: job=${plan.job}`)
  console.log(`ci-reproduce: node=${environment.node}`)
  console.log(`ci-reproduce: npm=${environment.npm}`)
  console.log(`ci-reproduce: electron=${environment.electron}`)
  console.log(`ci-reproduce: package.json=${dependencies.files['package.json'] ? 'present' : 'missing'}`)
  console.log(`ci-reproduce: package-lock.json=${dependencies.files['package-lock.json'] ? 'present' : 'missing'}`)
  console.log(`ci-reproduce: node_modules=${dependencies.directories.node_modules ? 'present' : 'missing'}`)
  console.log(`ci-reproduce: command=${plan.command} ${plan.args.join(' ')}`)
  if (dryRun) console.log('ci-reproduce: dry-run=true; command was not executed')
}

function run(argv, root = process.cwd()) {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (error) {
    console.error(`ci-reproduce: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }
  const plan = buildPlan(parsed.job, root)
  const environment = collectEnvironment(root)
  const dependencies = checkDependencies(plan)
  printPlan(plan, environment, dependencies, parsed.dryRun)
  if (parsed.dryRun) return 0
  const missing = missingDependencies(dependencies)
  if (missing.length > 0) {
    console.error(`ci-reproduce: missing prerequisites: ${missing.join(', ')}; run npm ci before reproducing CI.`)
    return 2
  }
  const result = spawnSync(plan.command, plan.args, {
    cwd: plan.root,
    stdio: 'inherit',
    // npm.cmd is a Windows command shim; arguments are fixed by JOBS and
    // never include user-provided text, so shell mode is only for .cmd support.
    shell: process.platform === 'win32'
  })
  if (result.error) {
    console.error(`ci-reproduce: failed to start command: ${result.error.message}`)
    return 1
  }
  return result.status ?? 1
}

if (require.main === module) process.exitCode = run(process.argv.slice(2))

module.exports = {
  JOBS,
  UsageError,
  buildPlan,
  checkDependencies,
  collectEnvironment,
  parseArgs,
  run
}
