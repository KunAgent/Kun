'use strict'

const { constants, existsSync, realpathSync, statSync } = require('node:fs')
const { access } = require('node:fs/promises')
const { delimiter, extname, isAbsolute, join } = require('node:path')

const MEDIA_EXECUTABLES = ['ffmpeg', 'ffprobe']

function resolveHostMediaExecutables(options = {}) {
  return Object.fromEntries(MEDIA_EXECUTABLES.map((name) => [
    name,
    resolveHostMediaExecutable(name, options)
  ]))
}

function resolveHostMediaExecutable(name, {
  environment = process.env,
  platform = process.platform
} = {}) {
  if (!MEDIA_EXECUTABLES.includes(name)) {
    throw new TypeError(`Unsupported media executable: ${String(name)}`)
  }
  const configuredName = `KUN_${name.toUpperCase()}_PATH`
  const configured = environment[configuredName]?.trim()
  if (configured) {
    if (!isAbsolute(configured)) {
      throw new Error(`${configuredName} must be an absolute path`)
    }
    const executable = inspectExecutable(configured, platform)
    if (!executable) throw new Error(`${configuredName} does not identify an executable file`)
    return executable
  }

  const extensions = platform === 'win32'
    ? executableExtensions(environment.PATHEXT)
    : ['']
  const names = platform === 'win32' && extname(name) === ''
    ? extensions.map((extension) => `${name}${extension}`)
    : [name]
  for (const directory of String(environment.PATH ?? '').split(delimiter).filter(Boolean).slice(0, 128)) {
    if (!isAbsolute(directory)) continue
    for (const candidate of names) {
      const executable = inspectExecutable(join(directory, candidate), platform)
      if (executable) return executable
    }
  }
  throw new Error(
    `Host-native ${name} is required for the fail-closed media smoke; ` +
    `install it or set ${configuredName} to an absolute executable path`
  )
}

function executableExtensions(pathExt) {
  const configured = String(pathExt ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .map((value) => value.startsWith('.') ? value : `.${value}`)
  return [...new Set(['.exe', ...configured])]
}

function inspectExecutable(candidate, platform) {
  try {
    if (!existsSync(candidate)) return undefined
    const canonical = realpathSync(candidate)
    if (!statSync(canonical).isFile()) return undefined
    // Windows executable access is represented by file existence. POSIX hosts
    // must also prove that the selected file is executable.
    require('node:fs').accessSync(
      canonical,
      platform === 'win32' ? constants.F_OK : constants.X_OK
    )
    return canonical
  } catch {
    return undefined
  }
}

function createDeterministicVideoFixtureInvocations({
  ffmpegPath,
  shortOutput,
  cancellationOutput
}) {
  for (const [label, value] of Object.entries({ ffmpegPath, shortOutput, cancellationOutput })) {
    if (typeof value !== 'string' || !isAbsolute(value)) {
      throw new TypeError(`${label} must be an absolute path`)
    }
  }
  return [
    {
      label: 'short deterministic H.264 fixture',
      command: ffmpegPath,
      args: deterministicFixtureArguments(shortOutput, 2)
    },
    {
      label: 'long deterministic cancellation fixture',
      command: ffmpegPath,
      args: deterministicFixtureArguments(cancellationOutput, 45)
    }
  ]
}

function deterministicFixtureArguments(output, durationSeconds) {
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc2=size=320x180:rate=30',
    '-f', 'lavfi',
    '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', String(durationSeconds),
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '32',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '64k',
    '-shortest',
    output
  ]
}

async function assertRegularNonEmptyFile(path, label) {
  await access(path, constants.F_OK)
  const details = statSync(path)
  if (!details.isFile() || details.size <= 0) {
    throw new Error(`${label} is missing or empty`)
  }
  return details.size
}

module.exports = {
  assertRegularNonEmptyFile,
  createDeterministicVideoFixtureInvocations,
  deterministicFixtureArguments,
  executableExtensions,
  resolveHostMediaExecutable,
  resolveHostMediaExecutables
}
