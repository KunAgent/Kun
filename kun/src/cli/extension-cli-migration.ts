import { cp, lstat, mkdir, readdir, readFile, rename, rm, rmdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { sameFilesystemPath } from '../adapters/tool/workspace-path.js'
import { extensionError } from '../extensions/errors.js'
import { ExtensionPaths } from '../extensions/paths.js'
import {
  isRecord,
  validateRegistryDocument
} from '../extensions/registry-validation.js'
import { defaultKunDataDir } from './kun-data-dir.js'

const REGISTRY_FILE_NAME = 'registry.json'
const REGISTRY_BACKUP_SUFFIX = 'pre-cli-root-migration.bak'
const PACKAGE_ROOT_SKIP = new Set([REGISTRY_FILE_NAME])

export type ExtensionCliRootPair = {
  packageRoot: string
  dataRoot: string
}

/** CLI roots used before `kun extension` shared the runtime data directory. */
export function legacyExtensionCliRoots(homeDir: string = homedir()): ExtensionCliRootPair {
  return {
    packageRoot: join(homeDir, '.kun', 'extensions'),
    dataRoot: join(homeDir, '.kun', 'extension-data')
  }
}

/** Extension roots derived from the shared Kun runtime data directory. */
export function defaultExtensionCliRoots(homeDir: string = homedir()): ExtensionCliRootPair {
  const dataDir = defaultKunDataDir(homeDir)
  return {
    packageRoot: join(dataDir, 'extensions'),
    dataRoot: join(dataDir, 'extension-data')
  }
}

export type LegacyExtensionRootMigration = {
  registry: 'not-default' | 'absent' | 'conflict' | 'migrated'
  rebasedVersions: number
  movedPackageEntries: number
  movedDataEntries: number
  registryBackupPath?: string
}

/**
 * One-shot handoff from the pre-unification CLI roots
 * (~/.kun/extensions + ~/.kun/extension-data) to the roots the CLI shares
 * with `kun serve` and the desktop runtime (<dataDir>/extensions +
 * <dataDir>/extension-data). The migration only runs for default-resolved
 * roots; an explicit --data-dir/--extension-root/--extension-data-root (or a
 * KUN_DATA_DIR pointing elsewhere) opts out.
 *
 * Ordering keeps a crash resumable: package directories move first, the
 * rebased registry is committed atomically, and only then is the legacy
 * registry renamed to a .bak sibling so the next run does not re-migrate.
 * When both registries exist nothing is merged or overwritten; the command
 * keeps using the shared root and reports the leftover legacy root.
 */
export async function migrateLegacyExtensionRoots(options: {
  packageRoot: string
  dataRoot: string
  homeDir?: string
  warn?: (message: string) => void
}): Promise<LegacyExtensionRootMigration> {
  const warn = options.warn ?? (() => undefined)
  const home = options.homeDir ?? homedir()
  const legacy = legacyExtensionCliRoots(home)
  const current = defaultExtensionCliRoots(home)
  const result: LegacyExtensionRootMigration = {
    registry: 'not-default',
    rebasedVersions: 0,
    movedPackageEntries: 0,
    movedDataEntries: 0
  }

  if (
    sameFilesystemPath(options.packageRoot, current.packageRoot) &&
    !sameFilesystemPath(legacy.packageRoot, current.packageRoot)
  ) {
    const legacyRegistryPath = join(legacy.packageRoot, REGISTRY_FILE_NAME)
    const currentRegistryPath = join(current.packageRoot, REGISTRY_FILE_NAME)
    const legacyState = await regularFileState(legacyRegistryPath)
    const currentState = await regularFileState(currentRegistryPath)
    if (legacyState === 'other' || currentState === 'other') {
      throw extensionError(
        'EXTENSION_ROOT_MIGRATION_BLOCKED',
        'Extension registry is not a regular file; resolve it manually before continuing',
        { path: legacyState === 'other' ? legacyRegistryPath : currentRegistryPath }
      )
    }
    if (legacyState === 'present' && currentState === 'present') {
      result.registry = 'conflict'
      warn(
        `the legacy extension root ${legacy.packageRoot} is deprecated and already has a ` +
        `registry at ${currentRegistryPath}; nothing was merged. Review the leftover files ` +
        'and remove them, or manage the legacy root explicitly with --extension-root and ' +
        '--extension-data-root.'
      )
    } else if (legacyState === 'present') {
      const inspection = await inspectRegistryForRebase(
        legacyRegistryPath,
        legacy.packageRoot,
        current.packageRoot
      )
      result.rebasedVersions = inspection.rebasedVersions
      result.movedPackageEntries = await mergeMoveDirectory(
        legacy.packageRoot,
        current.packageRoot,
        warn,
        PACKAGE_ROOT_SKIP
      )
      await atomicWriteFile(
        currentRegistryPath,
        `${JSON.stringify(inspection.document, null, 2)}\n`,
        { durable: true }
      )
      result.registryBackupPath = await backupRegistryFile(legacyRegistryPath)
      await removeIfEmptyDirectory(legacy.packageRoot)
      result.registry = 'migrated'
      warn(
        `migrated the extension registry to ${currentRegistryPath}; the legacy root ` +
        `${legacy.packageRoot} is deprecated. A backup copy was kept at ` +
        `${result.registryBackupPath}.`
      )
    } else {
      result.registry = 'absent'
    }
  }

  if (
    sameFilesystemPath(options.dataRoot, current.dataRoot) &&
    result.registry !== 'conflict' &&
    !sameFilesystemPath(legacy.dataRoot, current.dataRoot)
  ) {
    result.movedDataEntries = await mergeMoveDirectory(legacy.dataRoot, current.dataRoot, warn)
    await removeIfEmptyDirectory(legacy.dataRoot)
  }
  return result
}

/**
 * Read the legacy registry and rewrite every installed-version packagePath
 * from the legacy package root to its canonical location under the shared
 * root. Records that already point at the new root are kept as-is; anything
 * outside both roots is rejected so a corrupt registry cannot be used to
 * redirect package resolution at an arbitrary directory.
 */
async function inspectRegistryForRebase(
  registryPath: string,
  legacyPackageRoot: string,
  currentPackageRoot: string
): Promise<{ document: Record<string, unknown>; rebasedVersions: number }> {
  let document: unknown
  try {
    document = JSON.parse(await readFile(registryPath, 'utf8'))
  } catch (error) {
    throw extensionError(
      'EXTENSION_REGISTRY_INVALID',
      `Legacy extension registry is not valid JSON: ${registryPath}`,
      { path: registryPath },
      error
    )
  }
  if (!isRecord(document) || !isRecord(document.extensions)) {
    throw extensionError(
      'EXTENSION_REGISTRY_INVALID',
      'Legacy extension registry has an invalid root shape',
      { path: registryPath }
    )
  }
  const legacyPaths = new ExtensionPaths({ packageRoot: legacyPackageRoot })
  const currentPaths = new ExtensionPaths({ packageRoot: currentPackageRoot })
  let rebasedVersions = 0
  for (const [extensionId, rawEntry] of Object.entries(document.extensions)) {
    if (!isRecord(rawEntry) || rawEntry.id !== extensionId || !isRecord(rawEntry.versions)) {
      throw extensionError(
        'EXTENSION_REGISTRY_INVALID',
        'Legacy extension registry entry has an invalid shape',
        { extensionId, path: registryPath }
      )
    }
    for (const [version, rawVersion] of Object.entries(rawEntry.versions)) {
      if (!isRecord(rawVersion) || rawVersion.version !== version) {
        throw extensionError(
          'EXTENSION_REGISTRY_INVALID',
          'Legacy extension registry version has an invalid shape',
          { extensionId, version, path: registryPath }
        )
      }
      let legacyPackagePath: string
      let currentPackagePath: string
      try {
        legacyPackagePath = legacyPaths.packageVersion(extensionId, version)
        currentPackagePath = currentPaths.packageVersion(extensionId, version)
      } catch (error) {
        throw extensionError(
          'EXTENSION_REGISTRY_INVALID',
          `Legacy extension registry identity is unsafe: ${extensionId}@${version}`,
          { extensionId, version, path: registryPath },
          error
        )
      }
      if (typeof rawVersion.packagePath !== 'string' || rawVersion.packagePath.length === 0) {
        throw extensionError(
          'EXTENSION_REGISTRY_INVALID',
          'Legacy extension registry packagePath is missing',
          { extensionId, version, path: registryPath }
        )
      }
      if (
        !sameFilesystemPath(rawVersion.packagePath, legacyPackagePath) &&
        !sameFilesystemPath(rawVersion.packagePath, currentPackagePath)
      ) {
        throw extensionError(
          'EXTENSION_REGISTRY_INVALID',
          'Legacy extension registry packagePath is outside the canonical migration roots',
          {
            extensionId,
            version,
            packagePath: rawVersion.packagePath,
            path: registryPath
          }
        )
      }
      if (!sameFilesystemPath(rawVersion.packagePath, currentPackagePath)) {
        rawVersion.packagePath = currentPackagePath
        rebasedVersions += 1
      }
    }
  }
  try {
    // The runtime validator normalizes a narrow legacy manifest shape while
    // validating. Validate a clone so this migration changes packagePath only.
    validateRegistryDocument(structuredClone(document), currentPaths)
  } catch (error) {
    throw extensionError(
      'EXTENSION_REGISTRY_INVALID',
      `Legacy extension registry remains invalid after canonical path rebasing: ${registryPath}`,
      { path: registryPath },
      error
    )
  }
  return { document, rebasedVersions }
}

/**
 * Move each top-level entry from sourceDir into targetDir, recursing into
 * directories that exist on both sides. Conflicting leaves are never
 * overwritten: the legacy entry stays behind and a warning names both paths.
 * Returns the number of entries that were actually moved.
 */
async function mergeMoveDirectory(
  sourceDir: string,
  targetDir: string,
  warn: (message: string) => void,
  skip?: ReadonlySet<string>
): Promise<number> {
  const entries = await readdir(sourceDir, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  })
  let moved = 0
  for (const entry of entries) {
    if (skip?.has(entry.name)) continue
    const source = join(sourceDir, entry.name)
    const target = join(targetDir, entry.name)
    const targetDetails = await lstat(target).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (targetDetails === undefined) {
      await mkdir(targetDir, { recursive: true })
      try {
        await rename(source, target)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
        await cp(source, target, { recursive: true, verbatimSymlinks: true })
        await rm(source, { recursive: true, force: true })
      }
      moved += 1
      continue
    }
    if (entry.isDirectory() && targetDetails.isDirectory() && !targetDetails.isSymbolicLink()) {
      moved += await mergeMoveDirectory(source, target, warn)
      await removeIfEmptyDirectory(source)
      continue
    }
    warn(`kept the existing ${target}; the legacy entry was left at ${source}`)
  }
  return moved
}

/** Rename the migrated legacy registry aside so the migration never re-runs. */
async function backupRegistryFile(registryPath: string): Promise<string> {
  const base = `${registryPath}.${REGISTRY_BACKUP_SUFFIX}`
  let candidate = base
  for (let counter = 2; await lstat(candidate).then(
    () => true,
    () => false
  ); counter += 1) {
    candidate = `${base}.${counter}`
  }
  await rename(registryPath, candidate)
  return candidate
}

async function removeIfEmptyDirectory(path: string): Promise<void> {
  await rmdir(path).catch(() => undefined)
}

async function regularFileState(path: string): Promise<'missing' | 'present' | 'other'> {
  const details = await lstat(path).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })
  if (details === undefined) return 'missing'
  return details.isFile() && !details.isSymbolicLink() ? 'present' : 'other'
}
