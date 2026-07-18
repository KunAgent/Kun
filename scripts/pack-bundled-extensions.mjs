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
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runRequiredNpm } from './lib/extension-release-execution.mjs'
import { assertStandaloneVideoEditorHostBundle } from './pack-kun-video-editor.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cliPath = join(root, 'kun', 'dist', 'cli', 'serve-entry.js')
const defaultOutput = join(root, 'resources', 'bundled-extensions')

export const BUNDLED_EXTENSION_CATALOG_FILE = 'catalog.json'
export const BUNDLED_EXTENSION_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'kun-examples.kun-video-editor',
    name: 'kun-video-editor',
    root: join(root, 'examples', 'extensions', 'kun-video-editor')
  }),
  Object.freeze({
    id: 'kun-examples.presentation-studio',
    name: 'presentation-studio',
    root: join(root, 'examples', 'extensions', 'presentation-studio')
  }),
  Object.freeze({
    id: 'kun-examples.social-media-sidebar',
    name: 'social-media-sidebar',
    root: join(root, 'examples', 'extensions', 'social-media-sidebar')
  })
])

export function bundledArchiveName(manifest, expectedName) {
  if (manifest?.name !== expectedName) {
    throw new Error(`Expected the ${expectedName} manifest, got: ${String(manifest?.name)}`)
  }
  if (
    typeof manifest.version !== 'string' ||
    !/^[0-9A-Za-z][0-9A-Za-z._-]*$/u.test(manifest.version)
  ) {
    throw new Error(`Invalid ${expectedName} version: ${String(manifest?.version)}`)
  }
  return `${manifest.name}-${manifest.version}.kunx`
}

export function bundledCatalogEntry(definition, manifest, archive, sha256) {
  const id = `${String(manifest?.publisher ?? '')}.${String(manifest?.name ?? '')}`
  if (id !== definition.id || manifest?.name !== definition.name) {
    throw new Error(`Unexpected bundled extension id: ${id}`)
  }
  if (
    !Array.isArray(manifest.permissions) ||
    manifest.permissions.some((permission) =>
      typeof permission !== 'string' || permission.length === 0
    )
  ) {
    throw new Error(`Bundled extension permissions are invalid: ${id}`)
  }
  if (typeof manifest.engines?.kun !== 'string' || typeof manifest.apiVersion !== 'string') {
    throw new Error(`Bundled extension compatibility metadata is invalid: ${id}`)
  }
  if (basename(archive) !== archive || !/^[0-9A-Za-z][0-9A-Za-z._-]*\.kunx$/u.test(archive)) {
    throw new Error(`Bundled extension archive name is invalid: ${archive}`)
  }
  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new Error(`Bundled extension archive digest is invalid: ${id}`)
  }
  return {
    id,
    version: manifest.version,
    archive,
    sha256,
    enginesKun: manifest.engines.kun,
    apiVersion: manifest.apiVersion,
    permissions: [...new Set(manifest.permissions)].sort(),
    ...(manifest.signature === undefined ? {} : { signature: manifest.signature })
  }
}

export function bundledExtensionCatalog(entries) {
  const sorted = [...entries].sort((left, right) => left.id.localeCompare(right.id))
  if (new Set(sorted.map((entry) => entry.id)).size !== sorted.length) {
    throw new Error('Bundled extension catalog contains duplicate extension ids')
  }
  return { schemaVersion: 1, extensions: sorted }
}

export async function packBundledExtensions({ output = defaultOutput } = {}) {
  const directory = resolve(output)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const packed = []
  for (const definition of BUNDLED_EXTENSION_DEFINITIONS) {
    packed.push(await packBundledExtension(definition, directory))
  }
  await removeStaleBundledArchives(directory, new Set(packed.map((entry) => entry.archive)))
  const catalog = bundledExtensionCatalog(packed.map((entry) => entry.catalogEntry))
  const catalogPath = await writeBundledCatalog(directory, catalog)
  return { directory, catalog: catalogPath, extensions: packed }
}

async function packBundledExtension(definition, directory) {
  const manifestPath = join(definition.root, 'kun-extension.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const archiveName = bundledArchiveName(manifest, definition.name)
  const archive = join(directory, archiveName)
  const temporary = await mkdtemp(join(directory, `.${definition.name}-pack-`))
  const first = join(temporary, 'first.kunx')
  const second = join(temporary, 'second.kunx')
  try {
    runRequiredNpm({
      label: `${definition.name} build`,
      args: ['--prefix', definition.root, 'run', 'build'],
      cwd: root
    })
    if (definition.id === 'kun-examples.kun-video-editor') {
      await assertStandaloneVideoEditorHostBundle(join(definition.root, 'dist', 'host'))
    }
    runRequired(process.execPath, [
      cliPath,
      'extension',
      'validate',
      definition.root,
      '--json'
    ])
    for (const target of [first, second]) {
      runRequired(process.execPath, [
        cliPath,
        'extension',
        'pack',
        definition.root,
        '--output',
        target,
        '--overwrite',
        '--json'
      ])
    }
    const identity = await assertDeterministicArchives(definition.id, first, second)
    await rm(archive, { force: true })
    await rename(first, archive)
    const details = await lstat(archive)
    if (!details.isFile() || details.isSymbolicLink() || details.size <= 0) {
      throw new Error(`Bundled extension archive is not a regular file: ${archive}`)
    }
    runRequired(process.execPath, [cliPath, 'extension', 'validate', archive, '--json'])
    return {
      id: definition.id,
      archive: archiveName,
      path: archive,
      ...identity,
      catalogEntry: bundledCatalogEntry(definition, manifest, archiveName, identity.sha256)
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

async function assertDeterministicArchives(id, first, second) {
  const [firstDetails, secondDetails, firstHash, secondHash] = await Promise.all([
    stat(first),
    stat(second),
    sha256File(first),
    sha256File(second)
  ])
  if (
    !firstDetails.isFile() ||
    !secondDetails.isFile() ||
    firstDetails.size <= 0 ||
    secondDetails.size <= 0
  ) {
    throw new Error(`Bundled extension pack produced an empty archive: ${id}`)
  }
  if (firstDetails.size !== secondDetails.size || firstHash !== secondHash) {
    throw new Error(`Bundled extension pack is not deterministic: ${id}`)
  }
  return { bytes: firstDetails.size, sha256: firstHash }
}

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function removeStaleBundledArchives(directory, expected) {
  const names = BUNDLED_EXTENSION_DEFINITIONS.map((entry) => entry.name)
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (expected.has(entry.name)) continue
    if (!names.some((name) => entry.name.startsWith(`${name}-`) && entry.name.endsWith('.kunx'))) {
      continue
    }
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
  const result = await packBundledExtensions({ output: argumentValue('--output') })
  const summary = result.extensions
    .map((entry) => `${entry.id} ${entry.bytes} bytes sha256 ${entry.sha256}`)
    .join('; ')
  process.stdout.write(
    `Bundled extensions deterministic pack OK: ${summary}; catalog ` +
    `${relative(root, result.catalog).split(sep).join('/')}\n`
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
