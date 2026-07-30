#!/usr/bin/env node

'use strict'

const { spawnSync } = require('node:child_process')
const {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join, resolve } = require('node:path')

const CLI_HELP_SENTINEL = 'kun <command> [options]'
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const CLI_ENTRY_RELATIVE = join(
  'app.asar.unpacked',
  'kun',
  'dist',
  'cli',
  'serve-entry.js'
)

function inspectResources(resourcesDirectory) {
  const resources = resolve(resourcesDirectory)
  const details = lstatSync(resources)
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw new Error(`Packaged resources must be a non-symlink directory: ${resources}`)
  }
  const canonicalResources = realpathSync(resources)
  inspectRegularFile(join(canonicalResources, CLI_ENTRY_RELATIVE), 'packaged Kun CLI entry')
  return canonicalResources
}

function packagedCliInvocation(resourcesDirectory, {
  platform = process.platform,
  commandPath,
  cliArgs = ['--help']
} = {}) {
  const resources = inspectResources(resourcesDirectory)
  const appRoot = dirname(resources)
  if (platform === 'darwin') {
    const packagedLauncher = join(resources, 'bin', 'kun')
    inspectExecutable(packagedLauncher, 'macOS Kun CLI launcher')
    const launcher = commandPath ?? packagedLauncher
    if (!existsSync(launcher)) throw new Error(`Missing macOS Kun CLI command: ${launcher}`)
    return {
      command: launcher,
      args: [...cliArgs],
      options: { env: { ...process.env }, shell: false }
    }
  }
  if (platform === 'linux') {
    const launcher = join(appRoot, 'kun-gui')
    inspectExecutable(launcher, 'Linux Kun product launcher')
    return {
      command: launcher,
      args: [...cliArgs],
      options: {
        env: { ...process.env, KUN_CLI_ENTRY: '1' },
        shell: false
      }
    }
  }
  if (platform === 'win32') {
    const launcher = join(appRoot, 'bin', 'kun.cmd')
    inspectRegularFile(launcher, 'Windows Kun CLI launcher')
    const command = process.env.ComSpec || join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'cmd.exe'
    )
    return {
      command,
      args: ['/d', '/s', '/c', `""${launcher}" ${cliArgs.join(' ')}"`],
      // The final argument is already a complete cmd.exe command string.
      // Letting Node quote it again turns it into a literal quoted executable
      // path on Windows, so the packaged .cmd launcher cannot be found.
      options: {
        env: { ...process.env },
        shell: false,
        windowsVerbatimArguments: true
      }
    }
  }
  throw new Error(`Unsupported packaged CLI smoke platform: ${platform}`)
}

function runPackagedCliSmoke(resourcesDirectory, options = {}) {
  const platform = options.platform ?? process.platform
  let temporaryDirectory
  try {
    let commandPath
    if (platform === 'darwin') {
      temporaryDirectory = mkdtempSync(join(tmpdir(), 'kun-packaged-cli-'))
      commandPath = join(temporaryDirectory, 'kun')
      symlinkSync(join(resolve(resourcesDirectory), 'bin', 'kun'), commandPath)
    }
    const run = (cliArgs) => {
      const invocation = packagedCliInvocation(resourcesDirectory, {
        platform,
        commandPath,
        cliArgs
      })
      return (options.spawnSyncCommand ?? spawnSync)(
        invocation.command,
        invocation.args,
        {
          ...invocation.options,
          encoding: 'utf8',
          windowsHide: true,
          timeout: 30_000
        }
      )
    }
    const help = run(['--help'])
    assertSuccessfulHelp(help, `${platform} packaged Kun CLI`)
    if (options.expectedVersion) {
      const version = run(['--version'])
      assertSuccessfulVersion(
        version,
        `${platform} packaged Kun CLI`,
        options.expectedVersion
      )
    }
    return help.stdout
  } finally {
    if (temporaryDirectory) {
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  }
}

function runDebCliSmoke(debPath, options = {}) {
  if ((options.platform ?? process.platform) !== 'linux') {
    throw new Error('The deb CLI smoke must run on Linux.')
  }
  const archive = resolve(debPath)
  inspectRegularFile(archive, 'Kun deb package')
  const extractionDirectory = mkdtempSync(join(tmpdir(), 'kun-deb-cli-'))
  try {
    const extract = (options.spawnSyncCommand ?? spawnSync)(
      'dpkg-deb',
      ['-x', archive, extractionDirectory],
      {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: 60_000
      }
    )
    if (extract.error || extract.status !== 0) {
      throw new Error(
        `Unable to extract Kun deb package: ${extract.error?.message ?? extract.stderr ?? `exit ${extract.status}`}`
      )
    }
    return runPackagedCliSmoke(
      findExtractedResources(extractionDirectory),
      {
        platform: 'linux',
        spawnSyncCommand: options.spawnSyncCommand,
        expectedVersion: options.expectedVersion
      }
    )
  } finally {
    rmSync(extractionDirectory, { recursive: true, force: true })
  }
}

function findExtractedResources(extractionDirectory) {
  const candidates = []
  const pending = [resolve(extractionDirectory)]
  while (pending.length > 0) {
    const directory = pending.pop()
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const path = join(directory, entry.name)
      if (!entry.isDirectory()) continue
      if (
        entry.name === 'resources' &&
        existsSync(join(path, CLI_ENTRY_RELATIVE))
      ) {
        candidates.push(path)
        continue
      }
      pending.push(path)
    }
  }
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one packaged Kun resources directory in deb, found ${candidates.length}`
    )
  }
  return candidates[0]
}

function assertSuccessfulHelp(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(
      `${label} failed: ${result.error?.message ?? result.stderr ?? `exit ${result.status}`}`
    )
  }
  if (!String(result.stdout).includes(CLI_HELP_SENTINEL)) {
    throw new Error(`${label} did not print the Kun CLI help banner.`)
  }
}

function assertSuccessfulVersion(result, label, expectedVersion) {
  if (!SEMVER.test(expectedVersion)) {
    throw new Error(`Invalid expected Kun version: ${expectedVersion}`)
  }
  if (result.error || result.status !== 0) {
    throw new Error(
      `${label} --version failed: ${result.error?.message ?? result.stderr ?? `exit ${result.status}`}`
    )
  }
  if (String(result.stdout).trim() !== `kun ${expectedVersion}`) {
    throw new Error(
      `${label} reported ${JSON.stringify(String(result.stdout).trim())}, expected "kun ${expectedVersion}".`
    )
  }
}

function inspectExecutable(path, label) {
  inspectRegularFile(path, label)
  if ((lstatSync(path).mode & 0o111) === 0) {
    throw new Error(`${label} is not executable: ${path}`)
  }
}

function inspectRegularFile(path, label) {
  if (!existsSync(path)) throw new Error(`Missing ${label}: ${path}`)
  const details = lstatSync(path)
  if (details.isSymbolicLink() || !details.isFile() || details.size <= 0) {
    throw new Error(`${label} must be a non-empty non-symlink file: ${path}`)
  }
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--resources' || argument === '--deb' || argument === '--expected-version') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`)
      options[argument.slice(2)] = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  if (!options.resources) throw new Error('--resources is required')
  if (options['expected-version'] && !SEMVER.test(options['expected-version'])) {
    throw new Error(`Invalid expected Kun version: ${options['expected-version']}`)
  }
  if (options['expected-version']) {
    options.expectedVersion = options['expected-version']
    delete options['expected-version']
  }
  return options
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2))
    runPackagedCliSmoke(options.resources, { expectedVersion: options.expectedVersion })
    if (options.deb) {
      runDebCliSmoke(options.deb, { expectedVersion: options.expectedVersion })
    }
    process.stdout.write(
      `Packaged Kun CLI smoke OK: ${resolve(options.resources)}${options.deb ? `; ${resolve(options.deb)}` : ''}\n`
    )
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = {
  CLI_HELP_SENTINEL,
  packagedCliInvocation,
  parseArgs,
  runDebCliSmoke,
  runPackagedCliSmoke
}
