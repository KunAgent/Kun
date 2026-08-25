import {
  closeSync,
  constants,
  copyFileSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statfsSync,
  symlinkSync,
  unlinkSync,
  utimesSync
} from 'node:fs'
import {
  randomUUID
} from 'node:crypto'
import {
  basename,
  dirname,
  join
} from 'node:path'
import {
  DatabaseSync
} from 'node:sqlite'
import {
  CURRENT_KUN_DATA_DIR_TILDE
} from './kun-data-dir-paths'
import {
  COPY_CAPACITY_MIN_RESERVE_BYTES,
  COPY_CAPACITY_SOURCE_RESERVE_RATIO,
  type RuntimeStoreInventory
} from './runtime-data-dir-migration-types'
import {
  fsyncDirectoryBestEffort,
  fsyncFileBestEffort,
  pathState,
  retryRuntimeMigrationMutation,
  writeDurableJson
} from './runtime-data-dir-migration-journal-v2'
import {
  hashRegularFile,
  runtimeStoreInventory,
  uniqueSiblingBackup
} from './runtime-data-dir-migration-inventory'
import { assertSupportedSettingsVersion } from './settings-store-foundation'
import { applyPosixModeSync } from '../../kun/src/security/posix-permissions.js'



export function availableFilesystemBytes(path: string): number {
  const stats = statfsSync(path, { bigint: true })
  const bytes = stats.bavail * stats.bsize
  return bytes > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(bytes)
}

export function assertCandidateCopyCapacity(
  sourceInventory: RuntimeStoreInventory,
  stagingPath: string,
  availableBytes: (path: string) => number = availableFilesystemBytes,
  additionalCopyBytes = 0
): void {
  mkdirSync(dirname(stagingPath), { recursive: true, mode: 0o700 })
  const copyBytes = sourceInventory.bytes + additionalCopyBytes
  const reserve = Math.max(
    COPY_CAPACITY_MIN_RESERVE_BYTES,
    Math.ceil(copyBytes * COPY_CAPACITY_SOURCE_RESERVE_RATIO)
  )
  const required = copyBytes + reserve
  const available = availableBytes(dirname(stagingPath))
  if (available < required) {
    throw new Error(
      `insufficient capacity for history-preserving Runtime copy: ` +
      `requires up to ${copyBytes} bytes for authoritative and displaced history plus ` +
      `${reserve} bytes of safety reserve, ${available} bytes available`
    )
  }
}

export function sameRegularFileContent(left: string, right: string): boolean {
  const leftMetadata = lstatSync(left)
  const rightMetadata = lstatSync(right)
  return leftMetadata.isFile() &&
    rightMetadata.isFile() &&
    leftMetadata.size === rightMetadata.size &&
    hashRegularFile(left) === hashRegularFile(right)
}

export function copyRegularFilePreservingMetadata(sourcePath: string, targetPath: string): void {
  const sourceMetadata = lstatSync(sourcePath)
  const targetState = pathState(targetPath)
  if (targetState !== 'missing') {
    if (targetState === 'other' && sameRegularFileContent(sourcePath, targetPath)) {
      applyPosixModeSync(targetPath, sourceMetadata.mode & 0o7777)
      utimesSync(targetPath, sourceMetadata.atime, sourceMetadata.mtime)
      return
    }
    if (targetState === 'other' && lstatSync(targetPath).isFile()) {
      // The staging directory is migration-owned. A mismatched partial file
      // cannot be user authority and must not prevent deterministic resume.
      unlinkSync(targetPath)
    } else {
      throw new Error(`candidate copy target has an unexpected entry: ${targetPath}`)
    }
  }

  const partialPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.kun-copy-partial-${randomUUID()}`
  )
  try {
    copyFileSync(
      sourcePath,
      partialPath,
      constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE
    )
    applyPosixModeSync(partialPath, sourceMetadata.mode & 0o7777)
    utimesSync(partialPath, sourceMetadata.atime, sourceMetadata.mtime)
    // Source files may intentionally be read-only. A read descriptor is
    // sufficient for fsync and avoids requiring write permission after the
    // exact source mode has been restored on the staged file.
    const handle = openSync(partialPath, 'r')
    try {
      fsyncFileBestEffort(handle)
    } finally {
      closeSync(handle)
    }
    renameSync(partialPath, targetPath)
    fsyncDirectoryBestEffort(dirname(targetPath))
  } catch (error) {
    if (pathState(partialPath) === 'other') unlinkSync(partialPath)
    throw error
  }
}

export function copyRuntimeTreePreservingSource(sourcePath: string, targetPath: string): void {
  const sourceMetadata = lstatSync(sourcePath)
  if (!sourceMetadata.isDirectory()) {
    throw new Error(`Runtime copy source is not a directory: ${sourcePath}`)
  }
  const targetState = pathState(targetPath)
  if (targetState === 'missing') {
    mkdirSync(targetPath, {
      recursive: false,
      // Some Runtime trees intentionally contain immutable extension package
      // directories. Staging must remain writable until every child is copied;
      // the exact source mode is restored after the directory is complete.
      mode: (sourceMetadata.mode & 0o7777) | 0o700
    })
  } else if (targetState !== 'dir') {
    throw new Error(`Runtime copy target is not a directory: ${targetPath}`)
  } else {
    applyPosixModeSync(targetPath, (sourceMetadata.mode & 0o7777) | 0o700)
  }

  for (const targetName of readdirSync(targetPath)) {
    if (!/^\..+\.kun-copy-partial-[0-9a-f-]+$/i.test(targetName)) continue
    const partialPath = join(targetPath, targetName)
    if (pathState(partialPath) === 'other' && lstatSync(partialPath).isFile()) {
      unlinkSync(partialPath)
    }
  }

  for (const name of readdirSync(sourcePath).sort()) {
    const sourceEntry = join(sourcePath, name)
    const targetEntry = join(targetPath, name)
    const metadata = lstatSync(sourceEntry)
    if (metadata.isDirectory()) {
      copyRuntimeTreePreservingSource(sourceEntry, targetEntry)
      continue
    }
    if (metadata.isSymbolicLink()) {
      const linkTarget = readlinkSync(sourceEntry)
      const state = pathState(targetEntry)
      if (state === 'missing') {
        symlinkSync(linkTarget, targetEntry)
      } else if (state !== 'symlink' || readlinkSync(targetEntry) !== linkTarget) {
        throw new Error(`candidate copy contains a different symbolic link: ${targetEntry}`)
      }
      continue
    }
    if (metadata.isFile()) {
      copyRegularFilePreservingMetadata(sourceEntry, targetEntry)
      continue
    }
    throw new Error(`Runtime source contains an unsupported entry: ${sourceEntry}`)
  }
  applyPosixModeSync(targetPath, sourceMetadata.mode & 0o7777)
  utimesSync(targetPath, sourceMetadata.atime, sourceMetadata.mtime)
  fsyncDirectoryBestEffort(targetPath)
}

export function inventoryContains(
  actual: RuntimeStoreInventory,
  expected: RuntimeStoreInventory
): boolean {
  return (
    actual.files >= expected.files &&
    actual.directories >= expected.directories &&
    actual.symlinks >= expected.symlinks &&
    actual.bytes >= expected.bytes
  )
}

export function assertStoreInventoryContains(
  path: string,
  expected: RuntimeStoreInventory | undefined,
  description: string
): void {
  if (!expected) return
  if (!inventoryContains(runtimeStoreInventory(path), expected)) {
    throw new Error(`${description} inventory is smaller than the migration journal inventory`)
  }
}

export function validateSqliteIndex(dataDir: string): 'missing' | 'ok' | 'invalid' {
  const sqlitePath = join(dataDir, 'index.sqlite3')
  const state = pathState(sqlitePath)
  if (state === 'missing') return 'missing'
  if (state !== 'other' && state !== 'symlink') {
    throw new Error(`Runtime SQLite index is not a regular file: ${sqlitePath}`)
  }

  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(sqlitePath, {
      open: true,
      readOnly: true
    })
    const result = database.prepare('PRAGMA quick_check').get() as
      | { quick_check?: unknown }
      | undefined
    return result?.quick_check === 'ok' ? 'ok' : 'invalid'
  } catch {
    // The SQLite index is explicitly rebuildable from thread JSONL. Record the
    // failed validation without deleting or replacing the user's index bytes;
    // Runtime startup falls back to filesystem enumeration.
    return 'invalid'
  } finally {
    try {
      database?.close()
    } catch {
      // Validation is advisory for the rebuildable index.
    }
  }
}

export function assertSameVolume(
  sourcePath: string,
  targetPath: string,
  platform: NodeJS.Platform,
  statDevice: (path: string) => string | number | bigint
): void {
  const targetAncestor = nearestExistingDirectory(dirname(targetPath))
  if (statDevice(sourcePath) !== statDevice(targetAncestor)) {
    const error = new Error(
      `Kun Runtime data migration requires a same-volume atomic directory move: ${sourcePath} -> ${targetPath}`
    ) as NodeJS.ErrnoException
    error.code = 'EXDEV'
    throw error
  }
  if (platform === 'win32') {
    const sourceRoot = sourcePath.replace(/\//g, '\\').match(/^[a-zA-Z]:\\/)?.[0]?.toLowerCase()
    const targetRoot = targetPath.replace(/\//g, '\\').match(/^[a-zA-Z]:\\/)?.[0]?.toLowerCase()
    if (sourceRoot && targetRoot && sourceRoot !== targetRoot) {
      const error = new Error('Windows directory migration cannot cross volumes') as NodeJS.ErrnoException
      error.code = 'EXDEV'
      throw error
    }
  }
}

export function nearestExistingDirectory(path: string): string {
  let candidate = path
  while (true) {
    if (pathState(candidate) === 'dir') return candidate
    const parent = dirname(candidate)
    if (parent === candidate) {
      throw new Error(`could not resolve an existing directory above ${path}`)
    }
    candidate = parent
  }
}

export function linkResolvesToTarget(linkPath: string, targetPath: string, platform: NodeJS.Platform): boolean {
  if (pathState(linkPath) !== 'symlink' || pathState(targetPath) !== 'dir') return false
  try {
    const actual = realpathSync(linkPath)
    const expected = realpathSync(targetPath)
    return platform === 'win32'
      ? actual.toLocaleLowerCase('en-US') === expected.toLocaleLowerCase('en-US')
      : actual === expected
  } catch {
    return false
  }
}

export function createAndVerifyCompatibilityLink(
  sourcePath: string,
  targetPath: string,
  platform: NodeJS.Platform,
  sleep: (milliseconds: number) => void
): void {
  if (pathState(sourcePath) === 'symlink') {
    if (linkResolvesToTarget(sourcePath, targetPath, platform)) return
    throw new Error(`legacy Runtime path is an unexpected link: ${sourcePath}`)
  }
  if (pathState(sourcePath) !== 'missing') {
    throw new Error(`legacy Runtime path is not clear for compatibility link: ${sourcePath}`)
  }
  mkdirSync(dirname(sourcePath), { recursive: true, mode: 0o700 })
  retryRuntimeMigrationMutation(
    () => symlinkSync(targetPath, sourcePath, platform === 'win32' ? 'junction' : 'dir'),
    { platform, sleep }
  )
  if (!linkResolvesToTarget(sourcePath, targetPath, platform)) {
    if (pathState(sourcePath) === 'symlink') unlinkSync(sourcePath)
    throw new Error(`failed to verify compatibility link ${sourcePath} -> ${targetPath}`)
  }
}

export function backUpSettingsFile(
  settingsWritePath: string | undefined,
  now: () => Date
): string[] {
  if (!settingsWritePath) return []
  return [backUpRegularFile(
    settingsWritePath,
    'pre-runtime-data-migration',
    now,
    'active settings file'
  )]
}

export function backUpRegularFile(
  path: string,
  label: string,
  now: () => Date,
  description: string
): string {
  if (pathState(path) !== 'other' || !lstatSync(path).isFile()) {
    throw new Error(`${description} is unavailable: ${path}`)
  }
  const backupPath = uniqueSiblingBackup(path, label, now)
  copyFileSync(path, backupPath, constants.COPYFILE_EXCL)
  applyPosixModeSync(backupPath, 0o600)
  const backupHandle = openSync(backupPath, 'r+')
  try {
    fsyncFileBestEffort(backupHandle)
  } finally {
    closeSync(backupHandle)
  }
  try {
    const directoryHandle = openSync(dirname(backupPath), 'r')
    try {
      fsyncSync(directoryHandle)
    } finally {
      closeSync(directoryHandle)
    }
  } catch {
    // Windows does not consistently allow opening directories for fsync.
  }
  return backupPath
}

export function rewriteSettingsToCurrent(settingsWritePath: string | undefined): void {
  if (!settingsWritePath) return
  const state = pathState(settingsWritePath)
  if (state !== 'other') {
    throw new Error(`active settings file is unavailable: ${settingsWritePath}`)
  }
  const raw = readFileSync(settingsWritePath, 'utf8')
  const parsed = JSON.parse(raw) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`settings file is not an object: ${settingsWritePath}`)
  }
  assertSupportedSettingsVersion(parsed, settingsWritePath)
  const root = parsed as Record<string, unknown>
  const agents = typeof root.agents === 'object' && root.agents !== null && !Array.isArray(root.agents)
    ? root.agents as Record<string, unknown>
    : {}
  const kun = typeof agents.kun === 'object' && agents.kun !== null && !Array.isArray(agents.kun)
    ? agents.kun as Record<string, unknown>
    : {}
  const next = {
    ...root,
    agents: {
      ...agents,
      kun: {
        ...kun,
        dataDir: CURRENT_KUN_DATA_DIR_TILDE
      }
    }
  }
  writeDurableJson(settingsWritePath, next)
}
