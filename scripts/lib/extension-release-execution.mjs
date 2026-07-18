import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const LOCAL_DEPENDENCY_PREFIXES = ['file:', 'link:', 'workspace:']

export function npmExecutable(platform = process.platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm'
}

export function npmInvocation({
  args = [],
  env = process.env,
  execPath = process.execPath,
  platform = process.platform
} = {}) {
  const npmCli = typeof env.npm_execpath === 'string' && env.npm_execpath.length > 0
    ? env.npm_execpath
    : discoverBundledNpmCli(execPath, platform)
  return npmCli
    ? { command: execPath, args: [npmCli, ...args] }
    : { command: npmExecutable(platform), args }
}

export function runRequiredNpm(options = {}) {
  const invocation = npmInvocation({
    args: options.args ?? [],
    env: { ...process.env, ...(options.env ?? {}) }
  })
  return runRequiredCommand({
    ...options,
    command: invocation.command,
    args: invocation.args
  })
}

export function runRequiredCommand({
  label,
  command,
  args = [],
  cwd,
  env = {},
  capture = false,
  timeoutMs = 10 * 60 * 1000
}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: false,
    timeout: timeoutMs
  })
  if (result.error) {
    throw new Error(`${label} could not start: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const output = capture
      ? `\nstdout:\n${result.stdout || '(empty)'}\nstderr:\n${result.stderr || '(empty)'}`
      : ''
    throw new Error(`${label} failed with exit code ${String(result.status)}${output}`)
  }
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }
}

export function assertPathOutsideSourceTree(sourceRoot, candidate, label = 'External project') {
  const source = resolve(sourceRoot)
  const target = resolve(candidate)
  const relation = relative(source, target)
  const outside = relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)
  if (!outside) {
    throw new Error(`${label} must be outside the source tree: ${target}`)
  }
}

export function expectedApiMajors(currentVersion) {
  const currentMajor = parseMajor(currentVersion)
  return currentMajor === 1 ? [1] : [currentMajor, currentMajor - 1]
}

/**
 * A major is counted only after a behavioral conformance project has executed.
 * Negotiating a manifest version does not count as Host adaptation evidence.
 */
export function assertExecutableApiConformance({ currentVersion, supportedVersions, executedMajors }) {
  const expected = expectedApiMajors(currentVersion)
  const supported = [...new Set(supportedVersions.map(parseMajor))].sort((left, right) => right - left)
  const executed = [...new Set(executedMajors)].sort((left, right) => right - left)
  if (!sameNumbers(supported, expected)) {
    throw new Error(
      `Supported Extension API majors must be ${expected.join(', ')}, got ${supported.join(', ')}`
    )
  }
  if (!sameNumbers(executed, expected)) {
    const missing = expected.filter((major) => !executed.includes(major))
    throw new Error(
      `Executable Extension API conformance is missing for major(s): ${missing.join(', ')}. ` +
      'A previous-major manifest negotiation result is not a Host adapter test.'
    )
  }
}

export function assertPublishableManifest(manifest, label = manifest?.name ?? 'package') {
  if (!manifest || typeof manifest !== 'object') throw new Error(`${label} package manifest is invalid`)
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const dependencies = manifest[field]
    if (dependencies === undefined) continue
    for (const [name, specifier] of Object.entries(dependencies)) {
      if (
        typeof specifier !== 'string' ||
        LOCAL_DEPENDENCY_PREFIXES.some((prefix) => specifier.startsWith(prefix))
      ) {
        throw new Error(
          `${label} ${field}.${name} must use a publishable version, got ${String(specifier)}`
        )
      }
    }
  }
}

function parseMajor(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version))
  if (!match) throw new Error(`Invalid SemVer: ${String(version)}`)
  return Number(match[1])
}

function sameNumbers(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function discoverBundledNpmCli(execPath, platform) {
  if (platform !== 'win32') return undefined
  const candidate = join(dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  return existsSync(candidate) ? candidate : undefined
}
