import {
  closeSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
  statSync
} from 'node:fs'
import {
  createHash
} from 'node:crypto'
import {
  basename,
  dirname,
  join,
  relative,
  sep
} from 'node:path'
import {
  classifyCanonicalKunDataDir
} from './kun-data-dir-paths'
import {
  settingsReadCandidates
} from './settings-file-paths'
import {
  type PathState,
  type RuntimeStoreInventory
} from './runtime-data-dir-migration-types'
import {
  errnoCode,
  pathState,
  type SettingsSelection
} from './runtime-data-dir-migration-journal-v2'
import { assertSupportedSettingsVersion } from './settings-store-foundation'



export function uniqueSiblingBackup(path: string, label: string, now: () => Date): string {
  const stamp = now().toISOString().replace(/[-:.]/g, '')
  const parent = dirname(path)
  const name = basename(path)
  for (let ordinal = 0; ordinal < 10_000; ordinal += 1) {
    const suffix = ordinal === 0 ? '' : `-${ordinal}`
    const candidate = join(parent, `${name}.${label}-${stamp}${suffix}.bak`)
    if (pathState(candidate) === 'missing') return candidate
  }
  throw new Error(`could not allocate a unique migration backup path beside ${path}`)
}

export function readSettingsSelection(
  userDataPath: string,
  homeDir: string,
  platform: NodeJS.Platform,
  legacyState: PathState
): SettingsSelection {
  for (const sourcePath of settingsReadCandidates(userDataPath)) {
    let raw: string
    try {
      raw = readFileSync(sourcePath, 'utf8')
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') continue
      return { authority: 'unknown' }
    }

    let metadata
    try {
      metadata = lstatSync(sourcePath)
    } catch {
      return { authority: 'unknown' }
    }

    let writePath = sourcePath
    try {
      if (metadata.isSymbolicLink()) {
        writePath = realpathSync(sourcePath)
        if (!statSync(writePath).isFile()) return { authority: 'unknown' }
      } else if (!metadata.isFile()) {
        return { authority: 'unknown' }
      }
    } catch {
      return { authority: 'unknown' }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // JsonSettingsStore will back up and replace invalid settings after this
      // startup migration. Prefer the only existing canonical Runtime store so
      // that repair does not strand historical data behind the new default.
      return { authority: legacyState === 'dir' ? 'legacy' : 'current' }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { authority: legacyState === 'dir' ? 'legacy' : 'current' }
    }
    try {
      assertSupportedSettingsVersion(parsed, sourcePath)
    } catch {
      return { authority: 'unknown' }
    }
    const agents = (parsed as Record<string, unknown>).agents
    const kun = typeof agents === 'object' && agents !== null && !Array.isArray(agents)
      ? (agents as Record<string, unknown>).kun
      : undefined
    const dataDir = typeof kun === 'object' && kun !== null && !Array.isArray(kun)
      ? (kun as Record<string, unknown>).dataDir
      : undefined
    if (typeof dataDir === 'string' && dataDir.trim()) {
      return {
        authority: classifyCanonicalKunDataDir(dataDir, { homeDir, platform }),
        sourcePath,
        writePath
      }
    }
    // Older settings without agents.kun came from a profile whose Runtime data
    // lived in the canonical legacy directory.
    return {
      authority: legacyState === 'dir' ? 'legacy' : 'current',
      sourcePath,
      writePath
    }
  }
  return { authority: legacyState === 'dir' ? 'legacy' : 'current' }
}

export function listChildNames(path: string): string[] {
  if (pathState(path) !== 'dir') return []
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .map((entry) => entry.name)
    .sort()
}

export function threadIds(dataDir: string): string[] {
  return listChildNames(join(dataDir, 'threads'))
}

export function runtimeStoreInventory(dataDir: string): RuntimeStoreInventory {
  const inventory: RuntimeStoreInventory = {
    files: 0,
    directories: 0,
    symlinks: 0,
    bytes: 0
  }
  if (pathState(dataDir) === 'missing') return inventory
  if (pathState(dataDir) !== 'dir') {
    throw new Error(`Runtime store inventory root is not a directory: ${dataDir}`)
  }
  const pending = [dataDir]
  while (pending.length > 0) {
    const current = pending.pop()!
    inventory.directories += 1
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      const metadata = lstatSync(path)
      if (metadata.isSymbolicLink()) {
        inventory.symlinks += 1
        inventory.bytes += metadata.size
      } else if (metadata.isDirectory()) {
        pending.push(path)
      } else {
        inventory.files += 1
        inventory.bytes += metadata.size
      }
    }
  }
  return inventory
}

export function inventoriesEqual(
  left: RuntimeStoreInventory,
  right: RuntimeStoreInventory
): boolean {
  return left.files === right.files &&
    left.directories === right.directories &&
    left.symlinks === right.symlinks &&
    left.bytes === right.bytes
}

export type RuntimeTreeFingerprint = {
  fingerprint: string
  inventory: RuntimeStoreInventory
  threadIds: string[]
}

export function hashRegularFile(path: string): string {
  const hash = createHash('sha256')
  const handle = openSync(path, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    while (true) {
      const bytesRead = readSync(handle, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    closeSync(handle)
  }
  return hash.digest('hex')
}

export function canonicalRelativePath(rootPath: string, entryPath: string): string {
  const value = relative(rootPath, entryPath)
  return value === '' ? '.' : value.split(sep).join('/')
}

export function runtimeTreeFingerprint(rootPath: string): RuntimeTreeFingerprint {
  if (pathState(rootPath) !== 'dir') {
    throw new Error(`Runtime fingerprint root is not a directory: ${rootPath}`)
  }
  const hash = createHash('sha256')
  const inventory: RuntimeStoreInventory = {
    files: 0,
    directories: 0,
    symlinks: 0,
    bytes: 0
  }
  const visit = (entryPath: string): void => {
    const metadata = lstatSync(entryPath)
    const relativePath = canonicalRelativePath(rootPath, entryPath)
    if (metadata.isSymbolicLink()) {
      const target = readlinkSync(entryPath)
      inventory.symlinks += 1
      inventory.bytes += metadata.size
      hash.update(`link\0${relativePath}\0${target}\0`)
      return
    }
    if (metadata.isDirectory()) {
      inventory.directories += 1
      hash.update(
        `dir\0${relativePath}\0${metadata.mode & 0o7777}\0`
      )
      for (const name of readdirSync(entryPath).sort()) {
        visit(join(entryPath, name))
      }
      return
    }
    if (metadata.isFile()) {
      inventory.files += 1
      inventory.bytes += metadata.size
      hash.update(
        `file\0${relativePath}\0${metadata.mode & 0o7777}\0${metadata.size}\0` +
        `${hashRegularFile(entryPath)}\0`
      )
      return
    }
    throw new Error(`Runtime tree contains an unsupported entry: ${entryPath}`)
  }
  visit(rootPath)
  return {
    fingerprint: hash.digest('hex'),
    inventory,
    threadIds: threadIds(rootPath)
  }
}

export function assertRuntimeTreeMatchesFingerprint(
  rootPath: string,
  expectedFingerprint: string | undefined,
  description: string
): RuntimeTreeFingerprint {
  if (!expectedFingerprint) {
    throw new Error(`${description} has no authenticated fingerprint`)
  }
  const actual = runtimeTreeFingerprint(rootPath)
  if (actual.fingerprint !== expectedFingerprint) {
    throw new Error(`${description} bytes or identity do not match its authenticated fingerprint`)
  }
  return actual
}

export function assertRuntimeTreeTimestampsPreserved(
  sourcePath: string,
  candidatePath: string
): void {
  const source = lstatSync(sourcePath)
  const candidate = lstatSync(candidatePath)
  if (
    (source.isDirectory() || source.isFile()) &&
    Math.abs(source.mtimeMs - candidate.mtimeMs) > 2000
  ) {
    throw new Error(
      `history-preserving Runtime candidate timestamp differs: ${candidatePath}`
    )
  }
  if (!source.isDirectory()) return
  for (const name of readdirSync(sourcePath).sort()) {
    assertRuntimeTreeTimestampsPreserved(
      join(sourcePath, name),
      join(candidatePath, name)
    )
  }
}
