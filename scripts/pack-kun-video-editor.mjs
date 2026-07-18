#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { isBuiltin } from 'node:module'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runRequiredNpm } from './lib/extension-release-execution.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extensionRoot = join(root, 'examples', 'extensions', 'kun-video-editor')
const manifestPath = join(extensionRoot, 'kun-extension.json')
const cliPath = join(root, 'kun', 'dist', 'cli', 'serve-entry.js')
const bundledExtensionsRoot = join(root, 'resources', 'bundled-extensions')
export const BUNDLED_EXTENSION_CATALOG_FILE = 'catalog.json'

export function videoEditorArchiveName(manifest) {
  if (manifest?.name !== 'kun-video-editor') {
    throw new Error(`Expected the kun-video-editor manifest, got: ${String(manifest?.name)}`)
  }
  if (typeof manifest.version !== 'string' ||
      !/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(manifest.version)) {
    throw new Error(`Invalid Kun Video Editor version: ${String(manifest?.version)}`)
  }
  return `${manifest.name}-${manifest.version}.kunx`
}

export function videoEditorBundledCatalog(manifest, archiveName, sha256) {
  const id = `${String(manifest?.publisher ?? '')}.${String(manifest?.name ?? '')}`
  if (id !== 'kun-examples.kun-video-editor') {
    throw new Error(`Unexpected Kun Video Editor extension id: ${id}`)
  }
  if (!Array.isArray(manifest.permissions) || manifest.permissions.some((permission) =>
    typeof permission !== 'string' || permission.length === 0
  )) {
    throw new Error('Kun Video Editor manifest permissions are invalid')
  }
  if (typeof manifest.engines?.kun !== 'string' || typeof manifest.apiVersion !== 'string') {
    throw new Error('Kun Video Editor compatibility metadata is invalid')
  }
  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new Error(`Invalid Kun Video Editor archive digest: ${String(sha256)}`)
  }
  return {
    schemaVersion: 1,
    extensions: [{
      id,
      version: manifest.version,
      archive: archiveName,
      sha256,
      enginesKun: manifest.engines.kun,
      apiVersion: manifest.apiVersion,
      permissions: [...new Set(manifest.permissions)].sort(),
      ...(manifest.signature === undefined ? {} : { signature: manifest.signature })
    }]
  }
}

export async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function assertDeterministicArchives(first, second) {
  const [firstDetails, secondDetails, firstHash, secondHash] = await Promise.all([
    stat(first),
    stat(second),
    sha256File(first),
    sha256File(second)
  ])
  if (!firstDetails.isFile() || !secondDetails.isFile() ||
      firstDetails.size === 0 || secondDetails.size === 0) {
    throw new Error('Kun Video Editor pack must produce two non-empty regular archives')
  }
  if (firstDetails.size !== secondDetails.size || firstHash !== secondHash) {
    throw new Error(
      `Kun Video Editor pack is not deterministic: ` +
      `${firstDetails.size}/${firstHash} != ${secondDetails.size}/${secondHash}`
    )
  }
  return { bytes: firstDetails.size, sha256: firstHash }
}

/**
 * A packed Host runs outside the repository and cannot resolve workspace
 * dependencies. Fail the fast packaging path when Vite leaves a bare import in
 * any emitted Host module instead of waiting for a native activation smoke.
 */
export async function assertStandaloneVideoEditorHostBundle(hostDirectory) {
  const root = resolve(hostDirectory)
  const entry = join(root, 'extension.js')
  const entryDetails = await lstat(entry)
  if (!entryDetails.isFile() || entryDetails.isSymbolicLink()) {
    throw new Error(`Kun Video Editor Host entry must be a regular file: ${entry}`)
  }
  const modules = []
  const visit = async (directory) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name)
      if (item.isDirectory()) await visit(path)
      else if (item.isFile() && /\.(?:c|m)?js$/u.test(item.name)) modules.push(path)
    }
  }
  await visit(root)
  if (modules.length === 0) throw new Error('Kun Video Editor Host bundle contains no JavaScript modules')

  const bareImports = []
  for (const modulePath of modules.sort()) {
    const source = await readFile(modulePath, 'utf8')
    for (const specifier of moduleSpecifiers(source)) {
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(modulePath), specifier)
        if (target !== root && !target.startsWith(`${root}${sep}`)) {
          bareImports.push(`${relative(root, modulePath)} -> ${specifier} (escapes Host bundle)`)
        }
        continue
      }
      if (specifier.startsWith('node:') || isBuiltin(specifier)) continue
      bareImports.push(`${relative(root, modulePath)} -> ${specifier}`)
    }
  }
  if (bareImports.length > 0) {
    throw new Error(
      `Kun Video Editor Host bundle is not standalone; unresolved imports: ${bareImports.join(', ')}`
    )
  }
  return { modules: modules.length }
}

function moduleSpecifiers(source) {
  const specifiers = new Set()
  const patterns = [
    /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1])
  }
  return [...specifiers]
}

export async function findReleaseArchive(input, expectedName) {
  const candidate = resolve(input)
  const details = await lstat(candidate)
  if (details.isSymbolicLink()) {
    throw new Error(`Kun Video Editor release input must not be a symlink: ${candidate}`)
  }
  if (details.isFile()) {
    if (basename(candidate) !== expectedName) {
      throw new Error(`Expected ${expectedName}, got ${basename(candidate)}`)
    }
    return candidate
  }
  if (!details.isDirectory()) {
    throw new Error(`Kun Video Editor release input must be a file or directory: ${candidate}`)
  }

  const matches = []
  const unexpected = []
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const entryDetails = await lstat(path)
      if (entryDetails.isSymbolicLink()) {
        if (/^kun-video-editor-.+\.kunx$/u.test(entry.name)) {
          throw new Error(`Kun Video Editor release archive must not be a symlink: ${path}`)
        }
        continue
      }
      if (entryDetails.isDirectory()) await visit(path)
      else if (entryDetails.isFile() && /^kun-video-editor-.+\.kunx$/u.test(entry.name)) {
        if (entry.name === expectedName) matches.push(path)
        else unexpected.push(path)
      }
    }
  }
  await visit(candidate)
  if (unexpected.length > 0) {
    throw new Error(
      `Downloaded release contains unexpected Kun Video Editor archives: ${unexpected.join(', ')}`
    )
  }
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${expectedName} below ${candidate}, found ${matches.length}`
    )
  }
  return matches[0]
}

export async function verifyVideoEditorArchive({ input, run = runRequired } = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const expectedName = videoEditorArchiveName(manifest)
  const archive = await findReleaseArchive(input, expectedName)
  const details = await lstat(archive)
  if (!details.isFile() || details.isSymbolicLink() || details.size === 0) {
    throw new Error(`Kun Video Editor release archive must be a non-empty regular file: ${archive}`)
  }
  run(process.execPath, [
    cliPath,
    'extension',
    'validate',
    archive,
    '--json'
  ])
  return {
    archive,
    bytes: details.size,
    sha256: await sha256File(archive),
    version: manifest.version
  }
}

export async function assertVideoEditorMatchesBundledArchive({
  archive,
  version,
  sha256,
  bundledDirectory = bundledExtensionsRoot
}) {
  const catalogPath = join(resolve(bundledDirectory), BUNDLED_EXTENSION_CATALOG_FILE)
  const catalogDetails = await lstat(catalogPath)
  if (!catalogDetails.isFile() || catalogDetails.isSymbolicLink()) {
    throw new Error(`Bundled extension catalog must be a regular file: ${catalogPath}`)
  }
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
  const matches = Array.isArray(catalog?.extensions)
    ? catalog.extensions.filter((entry) => entry?.id === 'kun-examples.kun-video-editor')
    : []
  if (catalog?.schemaVersion !== 1 || matches.length !== 1) {
    throw new Error('Bundled extension catalog must contain exactly one Kun Video Editor entry')
  }
  const entry = matches[0]
  if (entry.version !== version || entry.sha256 !== sha256) {
    throw new Error(
      `Standalone and bundled Kun Video Editor identities differ: ` +
      `${version}/${sha256} != ${String(entry.version)}/${String(entry.sha256)}`
    )
  }
  if (typeof entry.archive !== 'string' || basename(entry.archive) !== entry.archive) {
    throw new Error('Bundled Kun Video Editor archive name is invalid')
  }
  const bundledArchive = join(resolve(bundledDirectory), entry.archive)
  const bundledDetails = await lstat(bundledArchive)
  const releaseDetails = await lstat(archive)
  if (
    !bundledDetails.isFile() ||
    bundledDetails.isSymbolicLink() ||
    bundledDetails.size !== releaseDetails.size ||
    await sha256File(bundledArchive) !== sha256
  ) {
    throw new Error('Standalone and bundled Kun Video Editor archive bytes differ')
  }
  return { bundledArchive, bytes: bundledDetails.size, sha256 }
}

export async function packVideoEditor({ output, catalog = false } = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const archiveName = videoEditorArchiveName(manifest)
  const requestedOutput = resolve(output ?? join(root, 'dist'))
  const archive = extname(requestedOutput).toLowerCase() === '.kunx'
    ? requestedOutput
    : join(requestedOutput, archiveName)
  if (catalog && extname(requestedOutput).toLowerCase() === '.kunx') {
    throw new Error('Bundled catalog output must be a directory')
  }
  if (basename(archive) !== archiveName) {
    throw new Error(`Kun Video Editor release archive must be named ${archiveName}`)
  }

  await mkdir(dirname(archive), { recursive: true, mode: 0o700 })
  const temporary = await mkdtemp(join(dirname(archive), '.kun-video-editor-pack-'))
  const first = join(temporary, 'first.kunx')
  const second = join(temporary, 'second.kunx')
  try {
    runRequiredNpm({
      label: 'Kun Video Editor build',
      args: ['--prefix', extensionRoot, 'run', 'build'],
      cwd: root
    })
    await assertStandaloneVideoEditorHostBundle(join(extensionRoot, 'dist', 'host'))
    runRequired(process.execPath, [
      cliPath,
      'extension',
      'validate',
      extensionRoot,
      '--json'
    ])
    for (const target of [first, second]) {
      runRequired(process.execPath, [
        cliPath,
        'extension',
        'pack',
        extensionRoot,
        '--output',
        target,
        '--overwrite',
        '--json'
      ])
    }
    const identity = await assertDeterministicArchives(first, second)
    if (catalog) await removeStaleVideoEditorArchives(dirname(archive), archiveName)
    await rm(archive, { force: true })
    await rename(first, archive)
    await verifyVideoEditorArchive({ input: archive })
    const catalogPath = catalog
      ? await writeBundledCatalog(
          dirname(archive),
          videoEditorBundledCatalog(manifest, archiveName, identity.sha256)
        )
      : undefined
    return {
      archive,
      version: manifest.version,
      ...identity,
      ...(catalogPath === undefined ? {} : { catalog: catalogPath })
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

async function removeStaleVideoEditorArchives(directory, expectedName) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === expectedName || !/^kun-video-editor-.+\.kunx$/u.test(entry.name)) continue
    await rm(join(directory, entry.name), { recursive: true, force: true })
  }
}

async function writeBundledCatalog(directory, catalog) {
  const path = join(directory, BUNDLED_EXTENSION_CATALOG_FILE)
  const temporary = `${path}.${process.pid}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
  return path
}

function runRequired(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: false
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
  }
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

async function main() {
  const verify = process.argv.includes('--verify')
  const requireBundledIdentity = process.argv.includes('--require-bundled-identity')
  if (verify) {
    const result = await verifyVideoEditorArchive({
      input: argumentValue('--input') ?? join(root, 'dist')
    })
    if (requireBundledIdentity) await assertVideoEditorMatchesBundledArchive(result)
    process.stdout.write(
      `Kun Video Editor release archive OK: ${relative(root, result.archive).split(sep).join('/')}, ` +
      `${result.bytes} bytes, sha256 ${result.sha256}\n`
    )
    return
  }
  const result = await packVideoEditor({
    output: argumentValue('--output'),
    catalog: process.argv.includes('--catalog')
  })
  if (requireBundledIdentity) await assertVideoEditorMatchesBundledArchive(result)
  process.stdout.write(
    `Kun Video Editor deterministic pack OK: ` +
    `${relative(root, result.archive).split(sep).join('/')}, ${result.bytes} bytes, ` +
    `sha256 ${result.sha256}` +
    `${result.catalog ? `, catalog ${relative(root, result.catalog).split(sep).join('/')}` : ''}\n`
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
