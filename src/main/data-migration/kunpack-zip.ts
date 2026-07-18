import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, lstat, mkdir, rm } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import * as yauzl from 'yauzl'
import * as yazl from 'yazl'
import {
  DataMigrationPackageEntrySchema,
  PackageRelativePathSchema,
  type DataMigrationPackageEntry,
  type DataMigrationPackageEntryKind,
  type PackageRelativePath
} from '../../shared/data-migration'

const FIXED_ZIP_TIME = new Date('1980-01-01T00:00:00.000Z')
const DEFAULT_FILE_MODE = 0o100600

export type Zip64ArchiveEntryInput = {
  path: PackageRelativePath
  kind: DataMigrationPackageEntryKind
  ownerId?: string
  source:
    | { kind: 'buffer'; data: Buffer }
    | { kind: 'file'; path: string }
  sha256?: string
  logicalBytes?: number
  mode?: number
  modifiedAt?: string
  linkTarget?: PackageRelativePath
  compress?: boolean
}

export type PreparedZip64ArchiveEntry = Zip64ArchiveEntryInput & {
  metadata: DataMigrationPackageEntry
}

export type Zip64DirectoryEntry = {
  path: string
  compressedBytes: number
  logicalBytes: number
  compressionMethod: number
  encrypted: boolean
  directory: boolean
  mode: number
  modifiedAt: string
}

export async function prepareZip64ArchiveEntries(
  entries: readonly Zip64ArchiveEntryInput[]
): Promise<PreparedZip64ArchiveEntry[]> {
  const paths = new Set<string>()
  const prepared: PreparedZip64ArchiveEntry[] = []
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    PackageRelativePathSchema.parse(entry.path)
    if (paths.has(entry.path)) throw new Error(`duplicate Kunpack entry: ${entry.path}`)
    paths.add(entry.path)

    let logicalBytes: number
    let sha256: string
    let mode = entry.mode ?? DEFAULT_FILE_MODE
    let modifiedAt = entry.modifiedAt
    if (entry.source.kind === 'buffer') {
      logicalBytes = entry.source.data.length
      sha256 = createHash('sha256').update(entry.source.data).digest('hex')
    } else {
      const details = await lstat(entry.source.path)
      if (!details.isFile() || details.isSymbolicLink()) {
        throw new Error(`Kunpack source must be a regular non-link file: ${entry.path}`)
      }
      logicalBytes = details.size
      sha256 = await sha256File(entry.source.path)
      mode = entry.mode ?? (0o100000 | (details.mode & 0o777))
      modifiedAt = entry.modifiedAt ?? details.mtime.toISOString()
    }
    if (entry.logicalBytes !== undefined && entry.logicalBytes !== logicalBytes) {
      throw new Error(`Kunpack source size changed before packaging: ${entry.path}`)
    }
    if (entry.sha256 !== undefined && entry.sha256 !== sha256) {
      throw new Error(`Kunpack source digest changed before packaging: ${entry.path}`)
    }
    const metadata = DataMigrationPackageEntrySchema.parse({
      path: entry.path,
      kind: entry.kind,
      ...(entry.ownerId ? { ownerId: entry.ownerId } : {}),
      logicalBytes,
      sha256,
      mode,
      ...(modifiedAt ? { modifiedAt } : {}),
      ...(entry.linkTarget ? { linkTarget: entry.linkTarget } : {})
    })
    prepared.push({ ...entry, metadata })
  }
  return prepared
}

export async function writeZip64Archive(input: {
  outputPath: string
  entries: readonly PreparedZip64ArchiveEntry[]
}): Promise<DataMigrationPackageEntry[]> {
  await mkdir(dirname(input.outputPath), { recursive: true, mode: 0o700 })
  const zipfile = new yazl.ZipFile()
  for (const entry of input.entries) {
    const options = {
      mtime: entry.modifiedAt ? new Date(entry.modifiedAt) : FIXED_ZIP_TIME,
      mode: entry.mode ?? DEFAULT_FILE_MODE,
      compress: entry.compress ?? true,
      forceZip64Format: true
    }
    if (entry.source.kind === 'buffer') {
      zipfile.addBuffer(entry.source.data, entry.path, options)
    } else {
      zipfile.addFile(entry.source.path, entry.path, options)
    }
  }

  try {
    const output = createWriteStream(input.outputPath, { flags: 'wx', mode: 0o600 })
    zipfile.end({ forceZip64Format: true, comment: '' })
    await pipeline(zipfile.outputStream, output)
    return input.entries.map((entry) => entry.metadata)
  } catch (error) {
    await rm(input.outputPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function readZip64Directory(archivePath: string): Promise<Zip64DirectoryEntry[]> {
  const zipfile = await openZip64(archivePath)
  const entries: Zip64DirectoryEntry[] = []
  try {
    for await (const entry of zipfile.eachEntry()) {
      entries.push({
        path: entry.fileName,
        compressedBytes: entry.compressedSize,
        logicalBytes: entry.uncompressedSize,
        compressionMethod: entry.compressionMethod,
        encrypted: entry.isEncrypted(),
        directory: entry.fileName.endsWith('/'),
        mode: entry.externalFileAttributes >>> 16,
        modifiedAt: entry.getLastModDate({ timezone: 'UTC' }).toISOString()
      })
    }
    return entries
  } finally {
    zipfile.close()
  }
}

export async function readZip64EntryBuffer(
  archivePath: string,
  requestedPath: PackageRelativePath,
  maximumBytes: number
): Promise<Buffer> {
  PackageRelativePathSchema.parse(requestedPath)
  if (!Number.isInteger(maximumBytes) || maximumBytes < 0) throw new Error('maximum entry bytes must be non-negative')
  const zipfile = await openZip64(archivePath)
  try {
    for await (const entry of zipfile.eachEntry()) {
      if (entry.fileName !== requestedPath) continue
      if (entry.isEncrypted()) throw new Error(`nested ZIP encryption is not supported: ${requestedPath}`)
      if (entry.uncompressedSize > maximumBytes) throw new Error(`Kunpack entry exceeds read limit: ${requestedPath}`)
      const stream = await zipfile.openReadStreamPromise(entry)
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > maximumBytes) {
          stream.destroy()
          throw new Error(`Kunpack entry exceeds read limit: ${requestedPath}`)
        }
        chunks.push(buffer)
      }
      return Buffer.concat(chunks, bytes)
    }
    throw new Error(`Kunpack entry is missing: ${requestedPath}`)
  } finally {
    zipfile.close()
  }
}

export async function verifyZip64ArchiveEntries(
  archivePath: string,
  expectedEntries: readonly DataMigrationPackageEntry[],
  allowedUnlistedPaths: ReadonlySet<string> = new Set()
): Promise<void> {
  const expected = new Map(expectedEntries.map((entry) => [entry.path, entry]))
  const seen = new Set<string>()
  const zipfile = await openZip64(archivePath)
  try {
    for await (const entry of zipfile.eachEntry()) {
      if (seen.has(entry.fileName)) throw new Error(`duplicate Kunpack ZIP entry: ${entry.fileName}`)
      seen.add(entry.fileName)
      if (entry.fileName.endsWith('/')) {
        if (!allowedUnlistedPaths.has(entry.fileName)) throw new Error(`undeclared Kunpack directory entry: ${entry.fileName}`)
        continue
      }
      const packagePath = PackageRelativePathSchema.parse(entry.fileName)
      if (entry.isEncrypted()) throw new Error(`nested ZIP encryption is not supported: ${entry.fileName}`)
      const declaration = expected.get(packagePath)
      if (!declaration) {
        if (allowedUnlistedPaths.has(entry.fileName)) continue
        throw new Error(`undeclared Kunpack ZIP entry: ${entry.fileName}`)
      }
      if (entry.uncompressedSize !== declaration.logicalBytes) {
        throw new Error(`Kunpack entry size mismatch: ${entry.fileName}`)
      }
      const stream = await zipfile.openReadStreamPromise(entry)
      const digest = createHash('sha256')
      let bytes = 0
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > declaration.logicalBytes) {
          stream.destroy()
          throw new Error(`Kunpack entry expanded beyond declaration: ${entry.fileName}`)
        }
        digest.update(buffer)
      }
      if (bytes !== declaration.logicalBytes || digest.digest('hex') !== declaration.sha256) {
        throw new Error(`Kunpack entry integrity mismatch: ${entry.fileName}`)
      }
    }
    for (const path of expected.keys()) {
      if (!seen.has(path)) throw new Error(`declared Kunpack entry is missing: ${path}`)
    }
  } finally {
    zipfile.close()
  }
}

export async function extractZip64ArchiveEntries(input: {
  archivePath: string
  destinationRoot: string
  entries: readonly DataMigrationPackageEntry[]
  destinationPath: (entry: DataMigrationPackageEntry) => string | null
  signal?: AbortSignal
  onProgress?: (progress: { path: PackageRelativePath; bytes: number; entries: number }) => void
}): Promise<{ bytes: number; entries: number }> {
  const root = resolve(input.destinationRoot)
  await mkdir(root, { recursive: true, mode: 0o700 })
  await chmod(root, 0o700)
  const declarations = new Map(input.entries.map((entry) => [entry.path, entry]))
  const extracted = new Set<string>()
  let bytes = 0
  let entries = 0
  const zipfile = await openZip64(input.archivePath)
  try {
    for await (const zipEntry of zipfile.eachEntry()) {
      input.signal?.throwIfAborted()
      const declaration = declarations.get(zipEntry.fileName as PackageRelativePath)
      if (!declaration) continue
      const destination = input.destinationPath(declaration)
      if (!destination) continue
      const outputPath = resolve(destination)
      const pathRelativeToRoot = relative(root, outputPath)
      if (!pathRelativeToRoot || pathRelativeToRoot.startsWith('..') || isAbsolute(pathRelativeToRoot)) {
        throw new Error(`Kunpack extraction target escapes staging root: ${declaration.path}`)
      }
      if (declaration.linkTarget) continue
      await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
      const digest = createHash('sha256')
      let entryBytes = 0
      let lastProgressBytes = 0
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          entryBytes += chunk.length
          if (entryBytes > declaration.logicalBytes) {
            callback(new Error(`Kunpack entry expanded beyond declaration: ${declaration.path}`))
            return
          }
          digest.update(chunk)
          if (input.onProgress && entryBytes - lastProgressBytes >= 1024 * 1024) {
            lastProgressBytes = entryBytes
            input.onProgress({ path: declaration.path, bytes: bytes + entryBytes, entries })
          }
          callback(null, chunk)
        }
      })
      const source = await zipfile.openReadStreamPromise(zipEntry)
      try {
        await pipeline(
          source,
          meter,
          createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }),
          ...(input.signal ? [{ signal: input.signal }] : [])
        )
      } catch (error) {
        await rm(outputPath, { force: true }).catch(() => undefined)
        throw error
      }
      if (entryBytes !== declaration.logicalBytes || digest.digest('hex') !== declaration.sha256) {
        await rm(outputPath, { force: true }).catch(() => undefined)
        throw new Error(`Kunpack extracted entry integrity mismatch: ${declaration.path}`)
      }
      await chmod(outputPath, 0o600 | ((declaration.mode ?? 0) & 0o111))
      extracted.add(declaration.path)
      bytes += entryBytes
      entries += 1
      input.onProgress?.({ path: declaration.path, bytes, entries })
    }
    for (const declaration of input.entries) {
      if (!input.destinationPath(declaration) || declaration.linkTarget) continue
      if (!extracted.has(declaration.path)) throw new Error(`declared Kunpack extraction entry is missing: ${declaration.path}`)
    }
    return { bytes, entries }
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
    throw error
  } finally {
    zipfile.close()
  }
}

async function openZip64(archivePath: string): Promise<yauzl.ZipFile> {
  return yauzl.openPromise(archivePath, {
    lazyEntries: true,
    decodeStrings: true,
    validateEntrySizes: true,
    strictFileNames: true,
    autoClose: false
  })
}

export async function sha256File(path: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}
