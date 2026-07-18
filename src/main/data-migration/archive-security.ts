import { randomUUID } from 'node:crypto'
import { mkdir, rm, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DATA_MIGRATION_FORMAT_VERSION,
  DATA_MIGRATION_MAX_ENTRY_COUNT,
  DATA_MIGRATION_MAX_METADATA_BYTES,
  DATA_MIGRATION_MINIMUM_FREE_SPACE_RATIO,
  DataMigrationPackageEntrySchema,
  PackageRelativePathSchema,
  type DataMigrationManifestV1,
  type DataMigrationPackageEntry,
  type PackageRelativePath
} from '../../shared/data-migration'
import {
  readKunpackEnvelopeHeader,
  verifyKunpackPackage
} from './kunpack-container'
import { validateKunpackPassphraseEncryption } from './kunpack-crypto'
import { readZip64Directory, type Zip64DirectoryEntry } from './kunpack-zip'

export type KunpackInspectionBudget = {
  maximumEntries: number
  maximumExpandedBytes: number
  maximumEntryBytes: number
  maximumCompressionRatio: number
  maximumMetadataBytes: number
  minimumFreeSpaceRatio: number
}

export const DEFAULT_KUNPACK_INSPECTION_BUDGET: KunpackInspectionBudget = Object.freeze({
  maximumEntries: DATA_MIGRATION_MAX_ENTRY_COUNT,
  maximumExpandedBytes: 2 * 1024 * 1024 * 1024 * 1024,
  maximumEntryBytes: 512 * 1024 * 1024 * 1024,
  maximumCompressionRatio: 10_000,
  maximumMetadataBytes: DATA_MIGRATION_MAX_METADATA_BYTES,
  minimumFreeSpaceRatio: DATA_MIGRATION_MINIMUM_FREE_SPACE_RATIO
})

export type KunpackHeaderInspection =
  | { kind: 'kunpack'; encrypted: boolean; formatVersion: number; passwordRequired: boolean }
  | { kind: 'not-kunpack'; message: string }

export type KunpackInspectionResult = {
  manifest: DataMigrationManifestV1
  entries: DataMigrationPackageEntry[]
  expandedBytes: number
  compressedBytes: number
  warnings: string[]
}

export async function inspectKunpackHeader(packagePath: string): Promise<KunpackHeaderInspection> {
  try {
    const { header } = await readKunpackEnvelopeHeader(packagePath)
    if (header.encryption.mode === 'passphrase') validateKunpackPassphraseEncryption(header.encryption)
    return {
      kind: 'kunpack',
      encrypted: header.encryption.mode === 'passphrase',
      formatVersion: header.formatVersion,
      passwordRequired: header.encryption.mode === 'passphrase'
    }
  } catch (error) {
    return { kind: 'not-kunpack', message: error instanceof Error ? error.message : 'invalid Kunpack package' }
  }
}

export async function inspectKunpackPackage(input: {
  packagePath: string
  temporaryDirectory: string
  passphrase?: string
  budget?: Partial<KunpackInspectionBudget>
  availableSpacePath?: string
  destinationSupportsLinks?: boolean
}): Promise<KunpackInspectionResult> {
  const budget = { ...DEFAULT_KUNPACK_INSPECTION_BUDGET, ...input.budget }
  const { header } = await readKunpackEnvelopeHeader(input.packagePath)
  if (header.formatVersion > DATA_MIGRATION_FORMAT_VERSION) {
    throw new Error(`Kunpack format version ${header.formatVersion} is newer than reader ${DATA_MIGRATION_FORMAT_VERSION}`)
  }
  if (header.encryption.mode === 'passphrase' && !input.passphrase) {
    throw new Error('Kunpack passphrase is required')
  }
  await mkdir(input.temporaryDirectory, { recursive: true, mode: 0o700 })
  const zipPath = join(input.temporaryDirectory, `.inspect-${randomUUID()}.zip`)
  try {
    const verified = await verifyKunpackPackage({
      packagePath: input.packagePath,
      materializedZipPath: zipPath,
      cleanupMaterialized: false,
      ...(input.passphrase ? { passphrase: input.passphrase } : {})
    })
    const directory = await readZip64Directory(zipPath)
    validateKunpackArchiveDirectory(directory, verified.entries, budget)
    validateKunpackLinkMetadata(verified.entries, { allowLinks: input.destinationSupportsLinks !== false })
    if (input.availableSpacePath) {
      await assertKunpackInspectionDiskBudget({
        path: input.availableSpacePath,
        expandedBytes: verified.manifest.expandedBytes,
        budget
      })
    }
    const compressedBytes = directory.reduce((total, entry) => total + entry.compressedBytes, 0)
    return {
      manifest: verified.manifest,
      entries: verified.entries,
      expandedBytes: verified.manifest.expandedBytes,
      compressedBytes,
      warnings: header.encryption.mode === 'none'
        ? ['This unencrypted package has corruption detection but no sender authenticity.']
        : []
    }
  } finally {
    await rm(zipPath, { force: true }).catch(() => undefined)
  }
}

export function validateKunpackArchiveDirectory(
  directory: readonly Zip64DirectoryEntry[],
  declarations: readonly DataMigrationPackageEntry[],
  budget: KunpackInspectionBudget = DEFAULT_KUNPACK_INSPECTION_BUDGET
): void {
  if (directory.length > budget.maximumEntries || declarations.length > budget.maximumEntries) {
    throw new Error(`Kunpack entry count exceeds ${budget.maximumEntries}`)
  }
  const identityKeys = new Map<string, string>()
  let expandedBytes = 0
  for (const entry of directory) {
    if (entry.directory) throw new Error(`Kunpack directory entries are not allowed: ${entry.path}`)
    const path = validateKunpackEntryPath(entry.path)
    const identity = destinationIdentityKey(path)
    const collision = identityKeys.get(identity)
    if (collision) throw new Error(`Kunpack contains an ambiguous path collision: ${collision} / ${path}`)
    identityKeys.set(identity, path)
    if (entry.encrypted) throw new Error(`nested ZIP encryption is not allowed: ${path}`)
    if (entry.logicalBytes > budget.maximumEntryBytes) throw new Error(`Kunpack entry exceeds expanded byte limit: ${path}`)
    if ((path === 'manifest.json' || path === 'checksums.jsonl' || path.startsWith('catalog/')) && entry.logicalBytes > budget.maximumMetadataBytes) {
      throw new Error(`Kunpack metadata entry exceeds read limit: ${path}`)
    }
    expandedBytes += entry.logicalBytes
    if (expandedBytes > budget.maximumExpandedBytes) throw new Error('Kunpack expanded bytes exceed inspection budget')
    const ratio = entry.compressedBytes === 0
      ? (entry.logicalBytes === 0 ? 1 : Number.POSITIVE_INFINITY)
      : entry.logicalBytes / entry.compressedBytes
    if (ratio > budget.maximumCompressionRatio) throw new Error(`Kunpack compression ratio exceeds limit: ${path}`)
  }
  for (const declaration of declarations) DataMigrationPackageEntrySchema.parse(declaration)
}

export function validateKunpackEntryPath(value: string): PackageRelativePath {
  const path = PackageRelativePathSchema.parse(value)
  for (const segment of path.split('/')) {
    if (segment.includes(':') || [...segment].some((character) => character.charCodeAt(0) <= 0x1f)) {
      throw new Error(`Kunpack entry contains an illegal or ADS path segment: ${value}`)
    }
    if (/[. ]$/.test(segment)) throw new Error(`Kunpack entry contains a trailing dot or space: ${value}`)
    const stem = segment.split('.')[0]!.toLocaleLowerCase('en-US')
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(stem)) {
      throw new Error(`Kunpack entry contains a reserved device name: ${value}`)
    }
    if (Buffer.byteLength(segment, 'utf8') > 255) throw new Error(`Kunpack path component is too long: ${value}`)
  }
  if (Buffer.byteLength(path, 'utf8') > 32_767) throw new Error(`Kunpack path is too long: ${value}`)
  return path
}

export function validateKunpackLinkMetadata(
  entries: readonly DataMigrationPackageEntry[],
  options: { allowLinks?: boolean } = {}
): void {
  const links = new Map<string, string>()
  const paths = new Set(entries.map((entry) => entry.path))
  for (const entry of entries) {
    if (!entry.linkTarget) continue
    if (options.allowLinks === false) throw new Error(`destination does not support Kunpack link metadata: ${entry.path}`)
    const target = PackageRelativePathSchema.parse(entry.linkTarget)
    if (!paths.has(target)) throw new Error(`Kunpack link target is not a declared internal entry: ${entry.path}`)
    links.set(entry.path, target)
  }
  for (const start of links.keys()) {
    const seen = new Set<string>()
    let cursor: string | undefined = start
    while (cursor && links.has(cursor)) {
      if (seen.has(cursor)) throw new Error(`Kunpack link metadata contains a loop: ${start}`)
      seen.add(cursor)
      cursor = links.get(cursor)
    }
  }
}

export async function assertKunpackInspectionDiskBudget(input: {
  path: string
  expandedBytes: number
  budget?: KunpackInspectionBudget
}): Promise<void> {
  const budget = input.budget ?? DEFAULT_KUNPACK_INSPECTION_BUDGET
  const filesystem = await statfs(input.path)
  const freeBytes = Number(filesystem.bavail) * Number(filesystem.bsize)
  const safetyMargin = Math.max(
    Math.ceil(input.expandedBytes * budget.minimumFreeSpaceRatio),
    256 * 1024 * 1024
  )
  if (input.expandedBytes + safetyMargin > freeBytes) {
    throw new Error(`Kunpack import requires ${input.expandedBytes + safetyMargin} free bytes but only ${freeBytes} are available`)
  }
}

function destinationIdentityKey(path: string): string {
  return path.normalize('NFC').toLocaleLowerCase('en-US')
}
