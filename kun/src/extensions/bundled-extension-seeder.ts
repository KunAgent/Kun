import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import semver from 'semver'
import { AtomicJsonFile } from './atomic-json.js'
import { asExtensionError, extensionError } from './errors.js'
import { type ExpectedIndexedPackage, ExtensionPackageManager } from './package-manager.js'
import { assertExtensionId } from './paths.js'

export const BUNDLED_EXTENSION_CATALOG_FILE = 'catalog.json'
export const BUNDLED_EXTENSION_SEED_STATE_FILE = '.bundled-extensions-seed-v1.json'

const MAX_CATALOG_BYTES = 1024 * 1024
const MAX_BUNDLED_EXTENSIONS = 64
const ARCHIVE_NAME = /^[0-9A-Za-z][0-9A-Za-z._-]*\.kunx$/
const SHA256 = /^[a-f0-9]{64}$/

export type BundledExtensionCatalogEntry = {
  id: string
  version: string
  archive: string
  sha256: string
  enginesKun: string
  apiVersion: string
  permissions: string[]
  signature?: Record<string, unknown>
}

export type BundledExtensionCatalog = {
  schemaVersion: 1
  extensions: BundledExtensionCatalogEntry[]
}

export type BundledExtensionSeedStatus = 'seeded' | 'user-managed' | 'removed'

export type BundledExtensionSeedEntry = {
  extensionId: string
  status: BundledExtensionSeedStatus
  lastSeenVersion: string
  lastSeenArchiveSha256: string
  managedVersion?: string
  managedArchiveSha256?: string
  updatedAt: string
}

export type BundledExtensionSeedDocument = {
  schemaVersion: 1
  revision: number
  updatedAt: string
  extensions: Record<string, BundledExtensionSeedEntry>
}

export type BundledExtensionSeedOutcome =
  | 'installed'
  | 'updated-selected'
  | 'updated-unselected'
  | 'unchanged'
  | 'user-managed'
  | 'removed'
  | 'skipped-downgrade'
  | 'skipped-permission-change'
  | 'skipped-version-conflict'
  | 'failed'

export type BundledExtensionSeedResult = {
  extensionId: string
  version: string
  outcome: BundledExtensionSeedOutcome
  code?: string
  message?: string
}

export type SeedBundledExtensionsOptions = {
  directory: string
  packageManager: ExtensionPackageManager
  now?: () => Date
}

type LoadedBundle = {
  descriptor: BundledExtensionCatalogEntry
  archivePath: string
}

type ReconcileResult = {
  state?: BundledExtensionSeedEntry
  result: BundledExtensionSeedResult
}

/**
 * Installs product-shipped archives through the ordinary package manager.
 * The separate ledger is deliberately only a seed decision: registry state
 * remains authoritative for packages, enablement, grants, and selection.
 */
export async function seedBundledExtensions(
  options: SeedBundledExtensionsOptions
): Promise<BundledExtensionSeedResult[]> {
  const now = options.now ?? (() => new Date())
  const bundles = await loadBundledExtensionCatalog(options.directory)
  const stateFile = new AtomicJsonFile(
    join(options.packageManager.paths.packageRoot, BUNDLED_EXTENSION_SEED_STATE_FILE),
    validateSeedDocument
  )
  let state = await stateFile.read(() => emptySeedDocument(now()))
  const results: BundledExtensionSeedResult[] = []

  for (const bundle of bundles) {
    const prior = state.extensions[bundle.descriptor.id]
    let reconciled: ReconcileResult
    try {
      reconciled = await reconcileBundle(options.packageManager, bundle, prior, now)
    } catch (error) {
      const normalized = asExtensionError(
        error,
        'EXTENSION_BUNDLED_SEED_FAILED',
        'Bundled extension installation failed'
      )
      results.push({
        extensionId: bundle.descriptor.id,
        version: bundle.descriptor.version,
        outcome: 'failed',
        code: normalized.code,
        message: normalized.message
      })
      continue
    }

    results.push(reconciled.result)
    if (reconciled.state === undefined) continue
    state = await stateFile.update(
      () => state,
      (current) => ({
        ...current,
        revision: current.revision + 1,
        updatedAt: reconciled.state!.updatedAt,
        extensions: {
          ...current.extensions,
          [bundle.descriptor.id]: reconciled.state!
        }
      })
    )
  }
  return results
}

export async function loadBundledExtensionCatalog(directory: string): Promise<LoadedBundle[]> {
  const requestedRoot = resolve(directory)
  const rootDetails = await lstat(requestedRoot).catch((error: unknown) => {
    throw extensionError(
      'EXTENSION_BUNDLED_DIRECTORY_INVALID',
      'Bundled extension directory is unavailable',
      {},
      error
    )
  })
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw extensionError(
      'EXTENSION_BUNDLED_DIRECTORY_INVALID',
      'Bundled extension directory must be a non-symlink directory'
    )
  }
  const canonicalRoot = await realpath(requestedRoot)
  const catalogPath = join(canonicalRoot, BUNDLED_EXTENSION_CATALOG_FILE)
  const catalogDetails = await lstat(catalogPath).catch((error: unknown) => {
    throw extensionError(
      'EXTENSION_BUNDLED_CATALOG_INVALID',
      'Bundled extension catalog is unavailable',
      {},
      error
    )
  })
  if (
    !catalogDetails.isFile() ||
    catalogDetails.isSymbolicLink() ||
    catalogDetails.size <= 0 ||
    catalogDetails.size > MAX_CATALOG_BYTES
  ) {
    throw extensionError(
      'EXTENSION_BUNDLED_CATALOG_INVALID',
      'Bundled extension catalog must be a bounded non-symlink file'
    )
  }

  let raw: unknown
  try {
    raw = JSON.parse(await readFile(catalogPath, 'utf8')) as unknown
  } catch (error) {
    throw extensionError(
      'EXTENSION_BUNDLED_CATALOG_INVALID',
      'Bundled extension catalog is not valid JSON',
      {},
      error
    )
  }
  const catalog = validateCatalog(raw)
  const bundles: LoadedBundle[] = []
  for (const descriptor of catalog.extensions) {
    const archivePath = join(canonicalRoot, descriptor.archive)
    const archiveDetails = await lstat(archivePath).catch((error: unknown) => {
      throw extensionError(
        'EXTENSION_BUNDLED_ARCHIVE_INVALID',
        'A catalogued bundled extension archive is unavailable',
        { extensionId: descriptor.id, version: descriptor.version },
        error
      )
    })
    if (!archiveDetails.isFile() || archiveDetails.isSymbolicLink() || archiveDetails.size <= 0) {
      throw extensionError(
        'EXTENSION_BUNDLED_ARCHIVE_INVALID',
        'A bundled extension archive must be a non-empty non-symlink file',
        { extensionId: descriptor.id, version: descriptor.version }
      )
    }
    const digest = await sha256File(archivePath)
    if (digest !== descriptor.sha256) {
      throw extensionError(
        'EXTENSION_BUNDLED_ARCHIVE_INVALID',
        'Bundled extension archive digest does not match its catalog',
        { extensionId: descriptor.id, version: descriptor.version }
      )
    }
    bundles.push({ descriptor, archivePath })
  }
  return bundles
}

async function reconcileBundle(
  manager: ExtensionPackageManager,
  bundle: LoadedBundle,
  prior: BundledExtensionSeedEntry | undefined,
  now: () => Date
): Promise<ReconcileResult> {
  const { descriptor, archivePath } = bundle
  const current = await manager.registry.get(descriptor.id)
  const timestamp = now().toISOString()

  if (prior === undefined) {
    const existing = current?.versions[descriptor.version]
    const interruptedSeed = existing !== undefined &&
      existing.archiveSha256 === descriptor.sha256 &&
      existing.source.type === 'local' &&
      existing.source.locator === archivePath
    if (interruptedSeed) {
      return seededResult(descriptor, timestamp, 'unchanged')
    }
    if (current !== undefined) {
      return {
        state: observation(descriptor, timestamp, 'user-managed'),
        result: result(descriptor, 'user-managed')
      }
    }
    await manager.installArchive(archivePath, {
      source: { type: 'local', locator: archivePath },
      grantedPermissions: descriptor.permissions,
      select: true,
      enable: true,
      expected: expectedPackage(descriptor)
    })
    return seededResult(descriptor, timestamp, 'installed')
  }

  if (prior.status !== 'seeded') {
    const changed = prior.lastSeenVersion !== descriptor.version ||
      prior.lastSeenArchiveSha256 !== descriptor.sha256
    return {
      ...(changed
        ? {
            state: {
              ...prior,
              lastSeenVersion: descriptor.version,
              lastSeenArchiveSha256: descriptor.sha256,
              updatedAt: timestamp
            }
          }
        : {}),
      result: result(descriptor, prior.status === 'removed' ? 'removed' : 'user-managed')
    }
  }

  const managedVersion = prior.managedVersion
  const managedSha256 = prior.managedArchiveSha256
  const managed = managedVersion === undefined ? undefined : current?.versions[managedVersion]
  if (
    current === undefined ||
    managedVersion === undefined ||
    managed === undefined ||
    managedSha256 === undefined ||
    managed.archiveSha256 !== managedSha256
  ) {
    return {
      state: {
        ...prior,
        status: 'removed',
        lastSeenVersion: descriptor.version,
        lastSeenArchiveSha256: descriptor.sha256,
        updatedAt: timestamp
      },
      result: result(descriptor, 'removed')
    }
  }

  if (descriptor.version === managedVersion && descriptor.sha256 === managedSha256) {
    return {
      result: result(descriptor, 'unchanged')
    }
  }

  const comparison = semver.compare(descriptor.version, managedVersion)
  if (comparison < 0) {
    return skippedResult(prior, descriptor, timestamp, 'skipped-downgrade')
  }
  if (comparison === 0) {
    return skippedResult(prior, descriptor, timestamp, 'skipped-version-conflict')
  }
  if (!isPermissionSubset(descriptor.permissions, managed.requestedPermissions)) {
    return skippedResult(prior, descriptor, timestamp, 'skipped-permission-change')
  }

  const select = !current.useDevelopment && current.selectedVersion === managedVersion
  const target = current.versions[descriptor.version]
  if (target !== undefined) {
    if (target.archiveSha256 !== descriptor.sha256) {
      return skippedResult(prior, descriptor, timestamp, 'skipped-version-conflict')
    }
    if (select && current.selectedVersion !== descriptor.version) {
      await manager.selectVersion(descriptor.id, descriptor.version)
    }
  } else {
    await manager.installArchive(archivePath, {
      source: { type: 'local', locator: archivePath },
      grantedPermissions: descriptor.permissions,
      select,
      enable: current.globallyEnabled,
      expected: expectedPackage(descriptor)
    })
  }
  return seededResult(
    descriptor,
    timestamp,
    select ? 'updated-selected' : 'updated-unselected'
  )
}

function seededResult(
  descriptor: BundledExtensionCatalogEntry,
  timestamp: string,
  outcome: BundledExtensionSeedOutcome
): ReconcileResult {
  return {
    state: {
      ...observation(descriptor, timestamp, 'seeded'),
      managedVersion: descriptor.version,
      managedArchiveSha256: descriptor.sha256
    },
    result: result(descriptor, outcome)
  }
}

function skippedResult(
  prior: BundledExtensionSeedEntry,
  descriptor: BundledExtensionCatalogEntry,
  timestamp: string,
  outcome: BundledExtensionSeedOutcome
): ReconcileResult {
  const changed = prior.lastSeenVersion !== descriptor.version ||
    prior.lastSeenArchiveSha256 !== descriptor.sha256
  return {
    ...(changed
      ? {
          state: {
            ...prior,
            lastSeenVersion: descriptor.version,
            lastSeenArchiveSha256: descriptor.sha256,
            updatedAt: timestamp
          }
        }
      : {}),
    result: result(descriptor, outcome)
  }
}

function observation(
  descriptor: BundledExtensionCatalogEntry,
  timestamp: string,
  status: BundledExtensionSeedStatus
): BundledExtensionSeedEntry {
  return {
    extensionId: descriptor.id,
    status,
    lastSeenVersion: descriptor.version,
    lastSeenArchiveSha256: descriptor.sha256,
    updatedAt: timestamp
  }
}

function result(
  descriptor: BundledExtensionCatalogEntry,
  outcome: BundledExtensionSeedOutcome
): BundledExtensionSeedResult {
  return { extensionId: descriptor.id, version: descriptor.version, outcome }
}

function expectedPackage(descriptor: BundledExtensionCatalogEntry): ExpectedIndexedPackage {
  return {
    extensionId: descriptor.id,
    version: descriptor.version,
    archiveSha256: descriptor.sha256,
    enginesKun: descriptor.enginesKun,
    apiVersion: descriptor.apiVersion,
    permissions: descriptor.permissions,
    ...(descriptor.signature === undefined ? {} : { signature: descriptor.signature })
  }
}

function validateCatalog(value: unknown): BundledExtensionCatalog {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.extensions)) {
    throw extensionError(
      'EXTENSION_BUNDLED_CATALOG_INVALID',
      'Bundled extension catalog shape is invalid'
    )
  }
  if (value.extensions.length < 1 || value.extensions.length > MAX_BUNDLED_EXTENSIONS) {
    throw extensionError(
      'EXTENSION_BUNDLED_CATALOG_INVALID',
      'Bundled extension catalog entry count is invalid'
    )
  }
  const ids = new Set<string>()
  const archives = new Set<string>()
  const extensions = value.extensions.map((entry) => validateCatalogEntry(entry, ids, archives))
  return { schemaVersion: 1, extensions }
}

function validateCatalogEntry(
  value: unknown,
  ids: Set<string>,
  archives: Set<string>
): BundledExtensionCatalogEntry {
  if (!isRecord(value)) invalidCatalogEntry()
  const id = stringField(value, 'id')
  const version = stringField(value, 'version')
  const archive = stringField(value, 'archive')
  const sha256 = stringField(value, 'sha256')
  const enginesKun = stringField(value, 'enginesKun')
  const apiVersion = stringField(value, 'apiVersion')
  assertExtensionId(id)
  if (semver.valid(version) === null || semver.valid(apiVersion) === null || semver.validRange(enginesKun) === null) {
    invalidCatalogEntry()
  }
  if (
    archive !== basename(archive) ||
    extname(archive).toLowerCase() !== '.kunx' ||
    !ARCHIVE_NAME.test(archive) ||
    !SHA256.test(sha256)
  ) {
    invalidCatalogEntry()
  }
  if (!Array.isArray(value.permissions) || value.permissions.some((permission) =>
    typeof permission !== 'string' || permission.length < 1 || permission.length > 256
  )) {
    invalidCatalogEntry()
  }
  const permissions = [...new Set(value.permissions as string[])].sort()
  if (permissions.length !== value.permissions.length) invalidCatalogEntry()
  if (ids.has(id) || archives.has(archive)) invalidCatalogEntry()
  ids.add(id)
  archives.add(archive)
  const signature = value.signature
  if (signature !== undefined && !isRecord(signature)) invalidCatalogEntry()
  return {
    id,
    version,
    archive,
    sha256,
    enginesKun,
    apiVersion,
    permissions,
    ...(signature === undefined ? {} : { signature })
  }
}

function invalidCatalogEntry(): never {
  throw extensionError(
    'EXTENSION_BUNDLED_CATALOG_INVALID',
    'Bundled extension catalog contains an invalid or duplicate entry'
  )
}

function validateSeedDocument(value: unknown): BundledExtensionSeedDocument {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    typeof value.updatedAt !== 'string' ||
    Number.isNaN(Date.parse(value.updatedAt)) ||
    !isRecord(value.extensions)
  ) {
    throw extensionError(
      'EXTENSION_BUNDLED_SEED_STATE_INVALID',
      'Bundled extension seed state is invalid'
    )
  }
  const extensions: Record<string, BundledExtensionSeedEntry> = {}
  for (const [id, entry] of Object.entries(value.extensions)) {
    assertExtensionId(id)
    if (
      !isRecord(entry) ||
      entry.extensionId !== id ||
      !['seeded', 'user-managed', 'removed'].includes(String(entry.status)) ||
      typeof entry.lastSeenVersion !== 'string' ||
      semver.valid(entry.lastSeenVersion) === null ||
      typeof entry.lastSeenArchiveSha256 !== 'string' ||
      !SHA256.test(entry.lastSeenArchiveSha256) ||
      typeof entry.updatedAt !== 'string' ||
      Number.isNaN(Date.parse(entry.updatedAt)) ||
      (entry.managedVersion !== undefined && (
        typeof entry.managedVersion !== 'string' || semver.valid(entry.managedVersion) === null
      )) ||
      (entry.managedArchiveSha256 !== undefined && (
        typeof entry.managedArchiveSha256 !== 'string' || !SHA256.test(entry.managedArchiveSha256)
      )) ||
      ((entry.managedVersion === undefined) !== (entry.managedArchiveSha256 === undefined)) ||
      (entry.status === 'seeded' && entry.managedVersion === undefined)
    ) {
      throw extensionError(
        'EXTENSION_BUNDLED_SEED_STATE_INVALID',
        'Bundled extension seed entry is invalid',
        { extensionId: id }
      )
    }
    extensions[id] = structuredClone(entry) as BundledExtensionSeedEntry
  }
  return {
    schemaVersion: 1,
    revision: Number(value.revision),
    updatedAt: value.updatedAt,
    extensions
  }
}

function emptySeedDocument(now: Date): BundledExtensionSeedDocument {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: now.toISOString(),
    extensions: {}
  }
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  if (typeof field !== 'string' || field.length < 1 || field.length > 4096) invalidCatalogEntry()
  return field
}

function isPermissionSubset(candidate: readonly string[], baseline: readonly string[]): boolean {
  const allowed = new Set(baseline)
  return candidate.every((permission) => allowed.has(permission))
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
