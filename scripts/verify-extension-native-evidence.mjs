#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { lstat, readFile, readdir, stat } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256File } from './write-extension-native-evidence.mjs'

const PLATFORMS = ['darwin', 'win32', 'linux']
const FULL_COMMIT = /^[a-f0-9]{40}$/i
const FULL_SHA256 = /^[a-f0-9]{64}$/
const VERSION_PART = '[0-9A-Za-z][0-9A-Za-z._-]*'
const KUN_NAMED_RELEASE_ASSET = /^Kun-/

const FINAL_ARTIFACTS = [
  {
    platform: 'darwin',
    role: 'mac-arm64-dmg',
    pattern: new RegExp(`^Kun-(${VERSION_PART})-mac-arm64\\.dmg$`),
    ancillaryPattern: new RegExp(`^Kun-(${VERSION_PART})-mac-arm64\\.dmg\\.blockmap$`)
  },
  {
    platform: 'darwin',
    role: 'mac-arm64-zip',
    pattern: new RegExp(`^Kun-(${VERSION_PART})-mac-arm64\\.zip$`),
    ancillaryPattern: new RegExp(`^Kun-(${VERSION_PART})-mac-arm64\\.zip\\.blockmap$`)
  },
  {
    platform: 'darwin',
    role: 'mac-x64-dmg',
    pattern: new RegExp(`^Kun-(${VERSION_PART})-mac-x64\\.dmg$`),
    ancillaryPattern: new RegExp(`^Kun-(${VERSION_PART})-mac-x64\\.dmg\\.blockmap$`)
  },
  {
    platform: 'darwin',
    role: 'mac-x64-zip',
    pattern: new RegExp(`^Kun-(${VERSION_PART})-mac-x64\\.zip$`),
    ancillaryPattern: new RegExp(`^Kun-(${VERSION_PART})-mac-x64\\.zip\\.blockmap$`)
  },
  {
    platform: 'win32',
    role: 'win-x64-exe',
    pattern: new RegExp(`^Kun-(${VERSION_PART})-win-x64\\.exe$`),
    ancillaryPattern: new RegExp(`^Kun-(${VERSION_PART})-win-x64\\.exe\\.blockmap$`)
  },
  {
    platform: 'linux',
    role: 'linux-x64-appimage',
    pattern: new RegExp(`^Kun-(${VERSION_PART})-linux-x86_64\\.AppImage$`),
    ancillaryPattern: new RegExp(`^Kun-(${VERSION_PART})-linux-x86_64\\.AppImage\\.blockmap$`)
  }
]

export function resolveExpectedEvidenceCommit({
  expectedCommit,
  checkedOutCommit,
  tagCommit
} = {}) {
  const checkout = normalizeCommit(checkedOutCommit, 'checked-out commit')
  const expected = normalizeCommit(expectedCommit ?? checkout, 'expected commit')
  if (checkout !== expected) {
    throw new Error(`Expected commit ${expected}, but checkout is ${checkout}`)
  }
  if (tagCommit !== undefined && normalizeCommit(tagCommit, 'tag commit') !== expected) {
    throw new Error(`Release tag does not point at expected commit ${expected}`)
  }
  return expected
}

export async function verifyNativeEvidenceBundle({
  directory,
  expectedCommit,
  checkedOutCommit = expectedCommit,
  tagCommit,
  expectedVersion
}) {
  const root = resolve(directory)
  const commit = resolveExpectedEvidenceCommit({ expectedCommit, checkedOutCommit, tagCommit })
  const files = await collectRegularFiles(root)
  const byBasename = new Map()
  for (const file of files) {
    const name = basename(file)
    const values = byBasename.get(name) ?? []
    values.push(file)
    byBasename.set(name, values)
  }
  for (const [name, paths] of byBasename) {
    if (paths.length > 1) {
      throw new Error(`Downloaded release contains duplicate filename ${name}: ${paths.join(', ')}`)
    }
  }

  const evidenceByPlatform = new Map()
  for (const platform of PLATFORMS) {
    const name = `extension-native-evidence-${platform}.json`
    const candidates = byBasename.get(name) ?? []
    if (candidates.length !== 1) {
      throw new Error(`Expected exactly one ${name}, found ${candidates.length}`)
    }
    const evidence = parseEvidence(await readFile(candidates[0], 'utf8'), platform, commit)
    evidenceByPlatform.set(platform, evidence)
  }

  const finalFiles = new Map()
  const ancillaryFiles = []
  for (const file of files) {
    const name = basename(file)
    if (!KUN_NAMED_RELEASE_ASSET.test(name)) continue
    const matches = FINAL_ARTIFACTS.filter((rule) => rule.pattern.test(name))
    if (matches.length > 1) throw new Error(`Ambiguous final native artifact name: ${name}`)
    if (matches.length === 1) {
      finalFiles.set(name, { file, rule: matches[0] })
      continue
    }
    const ancillaryMatches = FINAL_ARTIFACTS.filter((rule) => rule.ancillaryPattern.test(name))
    if (ancillaryMatches.length > 1) throw new Error(`Ambiguous ancillary native artifact name: ${name}`)
    if (ancillaryMatches.length === 1) {
      ancillaryFiles.push({ name, rule: ancillaryMatches[0] })
      continue
    }
    throw new Error(`Downloaded release contains unexpected Kun-named asset: ${name}`)
  }

  const recordedFiles = new Set()
  const versions = new Set()
  for (const rule of FINAL_ARTIFACTS) {
    const evidence = evidenceByPlatform.get(rule.platform)
    const matchingRecords = evidence.artifacts.filter((artifact) => rule.pattern.test(artifact.file))
    if (matchingRecords.length !== 1) {
      throw new Error(
        `Evidence ${rule.platform} must record exactly one ${rule.role} artifact, ` +
        `found ${matchingRecords.length}`
      )
    }
    const artifact = matchingRecords[0]
    if (recordedFiles.has(artifact.file)) {
      throw new Error(`Native artifact is recorded more than once: ${artifact.file}`)
    }
    recordedFiles.add(artifact.file)
    const version = artifact.file.match(rule.pattern)?.[1]
    if (!version) throw new Error(`Cannot identify version from ${artifact.file}`)
    versions.add(version)

    const downloaded = finalFiles.get(artifact.file)
    if (!downloaded) throw new Error(`Evidence references missing final artifact: ${artifact.file}`)
    if (downloaded.rule.platform !== rule.platform) {
      throw new Error(`Evidence platform does not own final artifact: ${artifact.file}`)
    }
    const details = await stat(downloaded.file)
    if (details.size !== artifact.bytes) {
      throw new Error(
        `Native artifact size mismatch for ${artifact.file}: ` +
        `evidence ${artifact.bytes}, downloaded ${details.size}`
      )
    }
    const digest = await sha256File(downloaded.file)
    if (digest !== artifact.sha256) {
      throw new Error(`Native artifact SHA-256 mismatch for ${artifact.file}`)
    }
  }

  for (const [platform, evidence] of evidenceByPlatform) {
    const expectedCount = FINAL_ARTIFACTS.filter((rule) => rule.platform === platform).length
    if (evidence.artifacts.length !== expectedCount) {
      throw new Error(
        `Evidence ${platform} must contain exactly ${expectedCount} final artifacts, ` +
        `found ${evidence.artifacts.length}`
      )
    }
  }
  if (recordedFiles.size !== finalFiles.size) {
    const unrecorded = [...finalFiles.keys()].filter((name) => !recordedFiles.has(name))
    throw new Error(`Downloaded final native artifact is not covered by evidence: ${unrecorded.join(', ')}`)
  }
  if (versions.size !== 1) {
    throw new Error(`Native artifacts do not share one release version: ${[...versions].join(', ')}`)
  }
  const [version] = versions
  if (expectedVersion !== undefined && version !== expectedVersion) {
    throw new Error(`Native artifact version ${version} does not match expected ${expectedVersion}`)
  }
  for (const ancillary of ancillaryFiles) {
    const ancillaryVersion = ancillary.name.match(ancillary.rule.ancillaryPattern)?.[1]
    if (ancillaryVersion !== version) {
      throw new Error(
        `Ancillary native artifact version does not match final artifacts: ${ancillary.name}`
      )
    }
  }

  return {
    commit,
    version,
    evidenceFiles: PLATFORMS.map((platform) =>
      relative(root, (byBasename.get(`extension-native-evidence-${platform}.json`) ?? [])[0])
        .split(sep).join('/')
    ),
    artifacts: [...recordedFiles].sort()
  }
}

async function collectRegularFiles(root) {
  const rootDetails = await lstat(root)
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw new Error(`Native evidence bundle must be a real directory: ${root}`)
  }
  const files = []
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const details = await lstat(path)
      if (details.isSymbolicLink()) {
        throw new Error(`Native evidence bundle must not contain symlinks: ${path}`)
      }
      if (details.isDirectory()) await visit(path)
      else if (details.isFile()) files.push(path)
    }
  }
  await visit(root)
  return files
}

function parseEvidence(source, expectedPlatform, expectedCommit) {
  let value
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new Error(`Evidence ${expectedPlatform} is not valid JSON`, { cause: error })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Evidence ${expectedPlatform} must be an object`)
  }
  if (value.schemaVersion !== 1 || value.platform !== expectedPlatform) {
    throw new Error(`Evidence ${expectedPlatform} has an invalid schema version or platform`)
  }
  if (normalizeCommit(value.commit, `evidence ${expectedPlatform} commit`) !== expectedCommit) {
    throw new Error(`Evidence ${expectedPlatform} commit does not match ${expectedCommit}`)
  }
  parseMediaToolchain(value.mediaToolchain, expectedPlatform)
  if (!Array.isArray(value.artifacts)) {
    throw new Error(`Evidence ${expectedPlatform} artifacts must be an array`)
  }
  const names = new Set()
  const artifacts = value.artifacts.map((artifact, index) => {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      throw new Error(`Evidence ${expectedPlatform} artifact ${index} must be an object`)
    }
    const file = artifact.file
    if (typeof file !== 'string' || basename(file) !== file || file.includes('\\')) {
      throw new Error(`Evidence ${expectedPlatform} contains a non-canonical artifact path`)
    }
    if (names.has(file)) throw new Error(`Evidence ${expectedPlatform} repeats artifact ${file}`)
    names.add(file)
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0) {
      throw new Error(`Evidence ${expectedPlatform} has invalid byte size for ${file}`)
    }
    if (typeof artifact.sha256 !== 'string' || !FULL_SHA256.test(artifact.sha256)) {
      throw new Error(`Evidence ${expectedPlatform} has invalid SHA-256 for ${file}`)
    }
    return { file, bytes: artifact.bytes, sha256: artifact.sha256 }
  })
  return { artifacts }
}

function parseMediaToolchain(value, platform) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Evidence ${platform} is missing mediaToolchain`)
  }
  for (const [field, prefix] of [
    ['ffmpegVersion', 'ffmpeg version '],
    ['ffprobeVersion', 'ffprobe version ']
  ]) {
    const version = value[field]
    if (typeof version !== 'string' || version.length <= prefix.length || version.length > 240 ||
        !version.startsWith(prefix) ||
        /[\r\n\0\\/]/u.test(version)) {
      throw new Error(`Evidence ${platform} has an invalid path-bearing ${field}`)
    }
  }
  if (value.libx264 !== true || value.drawtext !== true) {
    throw new Error(`Evidence ${platform} does not prove required libx264/drawtext capabilities`)
  }
}

function normalizeCommit(value, label) {
  if (typeof value !== 'string' || !FULL_COMMIT.test(value)) {
    throw new Error(`${label} must be a full 40-character commit SHA`)
  }
  return value.toLowerCase()
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function gitCommit(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim()
}

async function main() {
  const expectedCommit = argumentValue('--commit')
  const tag = argumentValue('--tag')
  const checkedOutCommit = gitCommit(['rev-parse', 'HEAD'])
  const tagCommit = tag === undefined ? undefined : gitCommit(['rev-list', '-n', '1', tag])
  const result = await verifyNativeEvidenceBundle({
    directory: argumentValue('--directory') ?? resolve('release-artifacts'),
    expectedCommit: expectedCommit ?? checkedOutCommit,
    checkedOutCommit,
    tagCommit,
    expectedVersion: argumentValue('--version')
  })
  process.stdout.write(
    `Extension native evidence bundle OK: commit ${result.commit}, version ${result.version}, ` +
    `${result.artifacts.length} final artifacts across ${result.evidenceFiles.length} platforms\n`
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
