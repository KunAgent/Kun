#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION_PART = '[0-9A-Za-z][0-9A-Za-z._-]*'

export const ARTIFACT_RULES = {
  darwin: {
    platformLike: /^Kun-.*-mac-/i,
    pattern: new RegExp(`^Kun-${VERSION_PART}-mac-(arm64|x64)\\.(dmg|zip)$`),
    ancillary: new RegExp(`^Kun-${VERSION_PART}-mac-(arm64|x64)\\.(dmg|zip)\\.blockmap$`),
    required: [
      /-mac-arm64\.dmg$/,
      /-mac-arm64\.zip$/,
      /-mac-x64\.dmg$/,
      /-mac-x64\.zip$/
    ]
  },
  win32: {
    platformLike: /^Kun-.*-win-/i,
    pattern: new RegExp(`^Kun-${VERSION_PART}-win-x64\\.exe$`),
    ancillary: new RegExp(`^Kun-${VERSION_PART}-win-x64\\.exe\\.blockmap$`),
    required: [/-win-x64\.exe$/]
  },
  linux: {
    platformLike: /^Kun-.*-linux-/i,
    pattern: new RegExp(`^Kun-${VERSION_PART}-linux-x86_64\\.AppImage$`),
    ancillary: new RegExp(`^Kun-${VERSION_PART}-linux-x86_64\\.AppImage\\.blockmap$`),
    required: [/-linux-x86_64\.AppImage$/]
  }
}

export async function collectNativeArtifacts({ distDirectory, platform }) {
  const rule = ARTIFACT_RULES[platform]
  if (!rule) throw new Error(`Unsupported native evidence platform: ${platform}`)

  const directory = resolve(distDirectory)
  const entries = await readdir(directory, { withFileTypes: true })
  const platformLike = entries.filter((entry) => rule.platformLike.test(entry.name))
  const unexpected = platformLike.filter((entry) =>
    !rule.pattern.test(entry.name) && !rule.ancillary.test(entry.name)
  )
  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected native ${platform} artifact(s) in ${directory}: ` +
      unexpected.map((entry) => entry.name).sort().join(', ')
    )
  }
  const matching = platformLike.filter((entry) => rule.pattern.test(entry.name))
  for (const entry of matching) {
    const path = join(directory, entry.name)
    const details = await lstat(path)
    if (!entry.isFile() || details.isSymbolicLink()) {
      throw new Error(`Native evidence artifact must be a regular file: ${path}`)
    }
  }

  const names = matching.map((entry) => entry.name).sort()
  for (const required of rule.required) {
    const candidates = names.filter((name) => required.test(name))
    if (candidates.length !== 1) {
      throw new Error(
        `Expected exactly one native ${platform} artifact matching ${required}, ` +
        `found ${candidates.length}${candidates.length ? `: ${candidates.join(', ')}` : ''}`
      )
    }
  }
  if (names.length !== rule.required.length) {
    throw new Error(
      `Expected exactly ${rule.required.length} native ${platform} artifacts in ${directory}, ` +
      `found ${names.length}: ${names.join(', ') || '(none)'}`
    )
  }

  return names.map((name) => join(directory, name))
}

export async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function createNativeEvidence({
  distDirectory = resolve('dist'),
  platform = process.platform,
  commit,
  environment = process.env,
  mediaToolchain
} = {}) {
  const resolvedCommit = commit ?? resolveEvidenceCommit({ environment })
  if (!/^[0-9a-f]{40}$/i.test(resolvedCommit)) {
    throw new Error(`Native evidence requires a full 40-character commit SHA, got: ${resolvedCommit}`)
  }
  const resolvedMediaToolchain = normalizeMediaToolchain(
    mediaToolchain ?? inspectMediaToolchain({ environment })
  )
  const artifacts = await collectNativeArtifacts({ distDirectory, platform })
  return {
    schemaVersion: 1,
    platform,
    commit: resolvedCommit.toLowerCase(),
    mediaToolchain: resolvedMediaToolchain,
    run: {
      repository: optionalString(environment.GITHUB_REPOSITORY),
      runId: optionalString(environment.GITHUB_RUN_ID),
      runAttempt: optionalString(environment.GITHUB_RUN_ATTEMPT)
    },
    artifacts: await Promise.all(artifacts.map(async (path) => ({
      file: path.slice(resolve(distDirectory).length + 1).replaceAll('\\', '/'),
      bytes: (await stat(path)).size,
      sha256: await sha256File(path)
    })))
  }
}

export function inspectMediaToolchain({
  environment = process.env,
  execute = executeMediaTool
} = {}) {
  const ffmpeg = optionalString(environment.KUN_FFMPEG_PATH) ?? 'ffmpeg'
  const ffprobe = optionalString(environment.KUN_FFPROBE_PATH) ?? 'ffprobe'
  const ffmpegVersion = firstVersionLine('ffmpeg', execute(ffmpeg, ['-version']))
  const ffprobeVersion = firstVersionLine('ffprobe', execute(ffprobe, ['-version']))
  const encoders = execute(ffmpeg, ['-hide_banner', '-encoders'])
  const filters = execute(ffmpeg, ['-hide_banner', '-filters'])
  const mediaToolchain = {
    ffmpegVersion,
    ffprobeVersion,
    libx264: /\blibx264\b/.test(encoders),
    drawtext: /\bdrawtext\b/.test(filters)
  }
  return normalizeMediaToolchain(mediaToolchain)
}

export function normalizeMediaToolchain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native evidence requires bounded media toolchain metadata')
  }
  const ffmpegVersion = boundedVersionLine(value.ffmpegVersion, 'ffmpeg')
  const ffprobeVersion = boundedVersionLine(value.ffprobeVersion, 'ffprobe')
  if (value.libx264 !== true) {
    throw new Error('Native evidence requires FFmpeg libx264 support')
  }
  if (value.drawtext !== true) {
    throw new Error('Native evidence requires FFmpeg drawtext support')
  }
  return { ffmpegVersion, ffprobeVersion, libx264: true, drawtext: true }
}

function executeMediaTool(executable, args) {
  return execFileSync(executable, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true
  })
}

function firstVersionLine(tool, output) {
  return boundedVersionLine(String(output).split(/\r?\n/u, 1)[0], tool)
}

function boundedVersionLine(value, tool) {
  if (typeof value !== 'string' || value.length <= tool.length + 9 || value.length > 240 ||
      !value.startsWith(`${tool} version `) || /[\r\n\0]/u.test(value) || /[\\/]/u.test(value)) {
    throw new Error(`Native evidence ${tool} version must be one bounded path-free first line`)
  }
  return value
}

export async function writeNativeEvidence({ outputPath, ...options } = {}) {
  const evidence = await createNativeEvidence(options)
  const output = resolve(
    outputPath ?? join(options.distDirectory ?? resolve('dist'), `extension-native-evidence-${evidence.platform}.json`)
  )
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' })
  return { evidence, output }
}

export function resolveEvidenceCommit({
  environment = process.env,
  checkedOutCommit
} = {}) {
  const actual = checkedOutCommit ?? execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim()
  if (!/^[0-9a-f]{40}$/i.test(actual)) {
    throw new Error(`Native evidence cannot identify the checked-out commit: ${actual}`)
  }
  const expected = optionalString(environment.KUN_EVIDENCE_COMMIT) ??
    optionalString(environment.GITHUB_SHA)
  if (expected !== undefined && expected.toLowerCase() !== actual.toLowerCase()) {
    throw new Error(
      `Native evidence expected commit ${expected}, but the checked-out commit is ${actual}`
    )
  }
  return actual
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

async function main() {
  const { evidence, output } = await writeNativeEvidence({
    distDirectory: argumentValue('--dist') ?? resolve('dist'),
    platform: argumentValue('--platform') ?? process.platform,
    outputPath: argumentValue('--output')
  })
  process.stdout.write(
    `Extension native evidence OK: ${evidence.platform}, ${evidence.artifacts.length} artifact(s), ${output}\n`
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
