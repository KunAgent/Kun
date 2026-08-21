'use strict'

const { createHash } = require('node:crypto')
const nodeFs = require('node:fs')
const { existsSync, lstatSync, readFileSync, realpathSync } = nodeFs
let rawFs = nodeFs
try {
  rawFs = require('original-fs')
} catch {
  // Plain Node validation has no original-fs; node:fs is already raw there.
}
const { closeSync, fstatSync, openSync, readSync } = rawFs
const { chmod, lstat, readdir } = require('node:fs/promises')
const { dirname, isAbsolute, join, relative, resolve, sep } = require('node:path')
const { KUN_RUNTIME_REQUIRED_PATHS } = require('./after-pack.cjs')

const DEFAULT_EXTENSION_IDS = [
  'kun-examples.social-media-sidebar'
]
const PACKAGED_EXTENSION_SMOKE_SUCCESS_MARKER = 'Packaged Extension smoke OK ('

function assertExists(path, label) {
  if (!existsSync(path)) throw new Error(`Missing packaged ${label}: ${path}`)
}

function assertPackagedSmokeChildResult(result) {
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `Packaged runtime smoke child failed (${result.signal ?? result.status ?? 'unknown exit'})`
    )
  }
  if (!String(result.stdout ?? '').includes(PACKAGED_EXTENSION_SMOKE_SUCCESS_MARKER)) {
    throw new Error(
      'Packaged runtime smoke child exited without the required completion marker'
    )
  }
}

function createPackagedExtensionSmokeReexecEnvironment(environment = process.env) {
  return {
    ...environment,
    ELECTRON_RUN_AS_NODE: '1',
    KUN_DISABLE_OS_CREDENTIAL_STORE: '1',
    KUN_PACKAGED_EXTENSION_SMOKE_REEXEC: '1'
  }
}

function resolvePackagedRuntimeExecutable(resourcesDir, explicit) {
  if (explicit) {
    const candidate = resolve(explicit)
    assertExists(candidate, 'runtime executable')
    return candidate
  }
  if (process.platform === 'darwin') {
    const normalized = resourcesDir.replaceAll('\\', '/')
    const packagedArch = normalized.includes('/mac-arm64/')
      ? 'arm64'
      : normalized.includes('/mac/')
        ? 'x64'
        : undefined
    if (packagedArch && packagedArch !== process.arch) return undefined
    if (!normalized.endsWith('.app/Contents/Resources')) return undefined
    const candidate = join(dirname(resourcesDir), 'MacOS', 'Kun')
    assertExists(candidate, 'runtime executable')
    return candidate
  }
  const appOutDir = dirname(resourcesDir)
  const names = process.platform === 'win32'
    ? ['Kun.exe']
    : ['kun', 'Kun', 'kun-gui']
  const candidate = names.map((name) => join(appOutDir, name)).find(existsSync)
  if (!candidate) {
    throw new Error(`Cannot find packaged runtime executable beside ${resourcesDir}`)
  }
  return candidate
}

async function makeTreeWritable(root) {
  if (process.platform === 'win32') return
  const details = await lstat(root)
  if (details.isSymbolicLink()) return
  if (!details.isDirectory()) {
    await chmod(root, 0o600)
    return
  }
  await chmod(root, 0o700)
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) await makeTreeWritable(path)
    else await chmod(path, 0o600)
  }
}

function packagedResourceCandidates(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') {
    if (arch === 'arm64') return ['dist/mac-arm64/Kun.app/Contents/Resources']
    if (arch === 'x64') return ['dist/mac/Kun.app/Contents/Resources']
    return []
  }
  if (platform === 'win32') return ['dist/win-unpacked/resources']
  if (platform === 'linux') return ['dist/linux-unpacked/resources']
  return []
}

function resolvedPackagedResourceCandidates(
  platform = process.platform,
  arch = process.arch,
  cwd = process.cwd()
) {
  return packagedResourceCandidates(platform, arch).map((candidate) => resolve(cwd, candidate))
}

function resolveResources(explicit) {
  if (explicit) return resolve(explicit)
  const candidates = resolvedPackagedResourceCandidates()
  const found = candidates.find(existsSync)
  if (!found) {
    throw new Error(`Cannot find packaged resources; pass --resources <path> (checked ${candidates.join(', ')})`)
  }
  return found
}

function validatePackagedResources(resourcesDir, unpackedRoot) {
  assertExists(join(resourcesDir, 'app.asar'), 'app.asar')
  assertExists(unpackedRoot, 'app.asar.unpacked')
  for (const relativePath of KUN_RUNTIME_REQUIRED_PATHS) {
    assertConfinedPackagedPath(unpackedRoot, relativePath)
  }
  validateBundledDefaultExtension(resourcesDir)
  for (const relativePath of [
    'kun/node_modules/@kun/extension-api',
    'kun/node_modules/create-kun-extension'
  ]) {
    const details = lstatSync(join(unpackedRoot, relativePath))
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`Packaged workspace dependency must be a materialized directory: ${relativePath}`)
    }
  }
  const asarHeader = readAsarHeader(join(resourcesDir, 'app.asar'))
  for (const preload of [
    'out/preload/extension-view.cjs',
    'out/preload/extension-protected-surface.cjs'
  ]) {
    if (!hasAsarEntry(asarHeader, preload)) {
      throw new Error(`Packaged app.asar does not contain ${preload}`)
    }
  }
}

function validateBundledDefaultExtension(resourcesDir) {
  const root = join(resourcesDir, 'bundled-extensions')
  const catalogPath = join(root, 'catalog.json')
  assertExists(catalogPath, 'bundled extension catalog')
  const catalogDetails = lstatSync(catalogPath)
  if (!catalogDetails.isFile() || catalogDetails.isSymbolicLink()) {
    throw new Error('Packaged bundled extension catalog is not a regular file')
  }
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.extensions)) {
    throw new Error('Packaged bundled extension catalog is invalid')
  }
  for (const id of DEFAULT_EXTENSION_IDS) {
    const matches = catalog.extensions.filter((entry) => entry?.id === id)
    if (matches.length !== 1) {
      throw new Error(`Packaged bundled extension catalog omits a default extension: ${id}`)
    }
    const entry = matches[0]
    if (
      typeof entry.archive !== 'string' ||
      !/^[0-9A-Za-z][0-9A-Za-z._-]*\.kunx$/u.test(entry.archive) ||
      typeof entry.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256)
    ) {
      throw new Error(`Packaged bundled extension catalog entry is invalid: ${id}`)
    }
    const archivePath = join(root, entry.archive)
    assertExists(archivePath, `bundled extension archive ${id}`)
    const archiveDetails = lstatSync(archivePath)
    if (!archiveDetails.isFile() || archiveDetails.isSymbolicLink() || archiveDetails.size <= 0) {
      throw new Error(`Packaged bundled extension archive is not a regular file: ${id}`)
    }
    const digest = createHash('sha256').update(readFileSync(archivePath)).digest('hex')
    if (digest !== entry.sha256) {
      throw new Error(`Packaged bundled extension archive digest does not match its catalog: ${id}`)
    }
  }
}

function assertConfinedPackagedPath(unpackedRoot, relativePath) {
  const path = join(unpackedRoot, relativePath)
  assertExists(path, relativePath)
  const root = realpathSync(unpackedRoot)
  const target = realpathSync(path)
  const fromRoot = relative(root, target)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Packaged resource escapes app.asar.unpacked: ${relativePath} -> ${target}`)
  }
}

function readAsarHeader(path) {
  const fd = openSync(path, 'r')
  try {
    const stat = fstatSync(fd)
    const prefix = Buffer.alloc(16)
    readExactly(fd, prefix, 0)
    const sizeFieldBytes = prefix.readUInt32LE(0)
    const headerPickleBytes = prefix.readUInt32LE(4)
    const jsonBytes = prefix.readUInt32LE(12)
    if (
      sizeFieldBytes !== 4 ||
      headerPickleBytes < jsonBytes + 4 ||
      jsonBytes < 2 ||
      jsonBytes > 64 * 1024 * 1024 ||
      16 + jsonBytes > stat.size
    ) {
      throw new Error(`Packaged app.asar has an invalid or unbounded header: ${path}`)
    }
    const json = Buffer.alloc(jsonBytes)
    readExactly(fd, json, 16)
    const parsed = JSON.parse(json.toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || !parsed.files || typeof parsed.files !== 'object') {
      throw new Error(`Packaged app.asar header has no file tree: ${path}`)
    }
    return parsed
  } finally {
    closeSync(fd)
  }
}

function readExactly(fd, buffer, position) {
  let offset = 0
  while (offset < buffer.length) {
    const bytes = readSync(fd, buffer, offset, buffer.length - offset, position + offset)
    if (bytes === 0) throw new Error('Unexpected end of packaged app.asar header')
    offset += bytes
  }
}

function hasAsarEntry(header, path) {
  let files = header.files
  const segments = path.split('/')
  for (let index = 0; index < segments.length; index += 1) {
    const entry = files?.[segments[index]]
    if (!entry || typeof entry !== 'object') return false
    if (index === segments.length - 1) {
      return Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.files === undefined
    }
    files = entry.files
  }
  return false
}


module.exports = {
  DEFAULT_EXTENSION_IDS,
  PACKAGED_EXTENSION_SMOKE_SUCCESS_MARKER,
  assertPackagedSmokeChildResult,
  createPackagedExtensionSmokeReexecEnvironment,
  makeTreeWritable,
  packagedResourceCandidates,
  resolvePackagedRuntimeExecutable,
  resolveResources,
  resolvedPackagedResourceCandidates,
  validatePackagedResources
}
