import { constants as fsConstants, createReadStream, createWriteStream } from 'node:fs'
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import {
  DATA_MIGRATION_FORMAT_VERSION,
  DATA_MIGRATION_MAX_METADATA_BYTES,
  DataMigrationEnvelopeHeaderV1Schema,
  DataMigrationManifestV1Schema,
  DataMigrationPackageEntrySchema,
  PackageRelativePathSchema,
  parsePackageRelativePath,
  type DataMigrationEncryption,
  type DataMigrationEnvelopeHeaderV1,
  type DataMigrationManifestV1,
  type DataMigrationPackageEntry,
  type PackageRelativePath
} from '../../shared/data-migration'
import {
  createKunpackPassphraseEncryption,
  decryptKunpackFramesToFile,
  encryptKunpackFileToHandle,
  type KunpackFramedEncryptionResult
} from './kunpack-crypto'
import {
  prepareZip64ArchiveEntries,
  readZip64EntryBuffer,
  sha256File,
  verifyZip64ArchiveEntries,
  writeZip64Archive,
  type PreparedZip64ArchiveEntry,
  type Zip64ArchiveEntryInput
} from './kunpack-zip'

export const KUNPACK_MAGIC = Buffer.from('KUNPACK\0', 'ascii')
export const KUNPACK_PREFIX_BYTES = KUNPACK_MAGIC.length + 4
export const KUNPACK_MAX_HEADER_BYTES = 64 * 1024
export const KUNPACK_MANIFEST_PATH = parsePackageRelativePath('manifest.json')
export const KUNPACK_CHECKSUMS_PATH = parsePackageRelativePath('checksums.jsonl')

export type KunpackCatalogInput = {
  path: PackageRelativePath
  value: unknown
  ownerId?: string
}

export type CreateKunpackPackageInput = {
  outputPath: string
  manifest: DataMigrationManifestV1
  catalogs: readonly KunpackCatalogInput[]
  entries: readonly Zip64ArchiveEntryInput[]
  passphrase?: string
  encryptionSettings?: Extract<DataMigrationEncryption, { mode: 'passphrase' }>
  createdAt?: string
}

export type CreatedKunpackPackage = {
  path: string
  header: DataMigrationEnvelopeHeaderV1
  manifest: DataMigrationManifestV1
  entries: DataMigrationPackageEntry[]
}

export type ReadKunpackEnvelopeResult = {
  header: DataMigrationEnvelopeHeaderV1
  headerBytes: Buffer
  payloadOffset: number
}

export function canonicalizeKunpackJson(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Kunpack canonical JSON does not support non-finite numbers')
    return value
  }
  if (Array.isArray(value)) return value.map((item) => item === undefined ? null : canonicalizeKunpackJson(item))
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue
      sorted[key] = canonicalizeKunpackJson(record[key])
    }
    return sorted
  }
  throw new Error(`Kunpack canonical JSON does not support ${typeof value}`)
}

export function serializeKunpackJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonicalizeKunpackJson(value))}\n`, 'utf8')
}

export function serializeKunpackChecksums(entries: readonly DataMigrationPackageEntry[]): Buffer {
  const lines = [...entries]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => JSON.stringify(canonicalizeKunpackJson(entry)))
  return Buffer.from(lines.length === 0 ? '' : `${lines.join('\n')}\n`, 'utf8')
}

export function parseKunpackChecksums(contents: Buffer): DataMigrationPackageEntry[] {
  const entries: DataMigrationPackageEntry[] = []
  for (const line of contents.toString('utf8').split('\n')) {
    if (!line.trim()) continue
    entries.push(DataMigrationPackageEntrySchema.parse(JSON.parse(line)))
  }
  const paths = new Set<string>()
  for (const entry of entries) {
    if (paths.has(entry.path)) throw new Error(`duplicate Kunpack checksum declaration: ${entry.path}`)
    paths.add(entry.path)
  }
  return entries
}

export async function createKunpackPackage(input: CreateKunpackPackageInput): Promise<CreatedKunpackPackage> {
  const outputDirectory = dirname(input.outputPath)
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 })
  if (await lstat(input.outputPath).then(() => true).catch(() => false)) {
    throw new Error(`Kunpack destination already exists: ${input.outputPath}`)
  }

  const encryption: DataMigrationEncryption = input.passphrase
    ? input.encryptionSettings ?? createKunpackPassphraseEncryption()
    : { mode: 'none' }
  if (!input.passphrase && input.encryptionSettings) {
    throw new Error('Kunpack encryption settings require a passphrase')
  }

  const packageToken = `${process.pid}.${randomUUID()}`
  const zipPath = join(outputDirectory, `.kunpack-${packageToken}.zip.tmp`)
  const packagePath = join(outputDirectory, `.kunpack-${packageToken}.tmp`)
  const verificationZipPath = join(outputDirectory, `.kunpack-${packageToken}.verify.zip.tmp`)
  try {
    const catalogInputs: Zip64ArchiveEntryInput[] = input.catalogs.map((catalog) => {
      PackageRelativePathSchema.parse(catalog.path)
      if (!catalog.path.startsWith('catalog/')) throw new Error(`Kunpack catalog path must be under catalog/: ${catalog.path}`)
      return {
        path: catalog.path,
        kind: 'catalog',
        ...(catalog.ownerId ? { ownerId: catalog.ownerId } : {}),
        source: { kind: 'buffer', data: serializeKunpackJson(catalog.value) }
      }
    })
    const payloadEntries = await prepareZip64ArchiveEntries([...catalogInputs, ...input.entries])
    const checksumContents = serializeKunpackChecksums(payloadEntries.map((entry) => entry.metadata))
    const catalogDigest = digestKunpackCatalogs(payloadEntries)
    const manifest = DataMigrationManifestV1Schema.parse({
      ...input.manifest,
      formatVersion: DATA_MIGRATION_FORMAT_VERSION,
      encryption,
      counts: {
        ...input.manifest.counts,
        entries: payloadEntries.length
      },
      expandedBytes: payloadEntries.reduce((total, entry) => total + entry.metadata.logicalBytes, 0),
      catalogsSha256: catalogDigest,
      checksumsSha256: sha256Buffer(checksumContents)
    })

    const structuralEntries = await prepareZip64ArchiveEntries([
      {
        path: KUNPACK_MANIFEST_PATH,
        kind: 'catalog',
        source: { kind: 'buffer', data: serializeKunpackJson(manifest) }
      },
      {
        path: KUNPACK_CHECKSUMS_PATH,
        kind: 'catalog',
        source: { kind: 'buffer', data: checksumContents }
      }
    ])
    await writeZip64Archive({ outputPath: zipPath, entries: [...structuralEntries, ...payloadEntries] })
    const header = await writeKunpackEnvelope({
      zipPath,
      outputPath: packagePath,
      encryption,
      ...(input.passphrase ? { passphrase: input.passphrase } : {}),
      createdAt: input.createdAt ?? new Date().toISOString()
    })
    await verifyKunpackPackage({
      packagePath,
      materializedZipPath: verificationZipPath,
      ...(input.passphrase ? { passphrase: input.passphrase } : {})
    })
    await publishWithoutOverwrite(packagePath, input.outputPath)
    return {
      path: input.outputPath,
      header,
      manifest,
      entries: payloadEntries.map((entry) => entry.metadata)
    }
  } finally {
    await Promise.all([
      rm(zipPath, { force: true }),
      rm(packagePath, { force: true }),
      rm(verificationZipPath, { force: true })
    ]).catch(() => undefined)
  }
}

export async function writeKunpackEnvelope(input: {
  zipPath: string
  outputPath: string
  encryption: DataMigrationEncryption
  passphrase?: string
  createdAt: string
}): Promise<DataMigrationEnvelopeHeaderV1> {
  const zipStats = await stat(input.zipPath)
  if (!zipStats.isFile()) throw new Error('Kunpack payload must be a regular file')
  const header = DataMigrationEnvelopeHeaderV1Schema.parse({
    envelopeVersion: 1,
    payloadFormat: 'zip64',
    formatVersion: DATA_MIGRATION_FORMAT_VERSION,
    createdAt: input.createdAt,
    plainPayloadBytes: zipStats.size,
    plainPayloadSha256: await sha256File(input.zipPath),
    encryption: input.encryption
  })
  const headerBytes = serializeKunpackJson(header)
  if (headerBytes.length > KUNPACK_MAX_HEADER_BYTES) throw new Error('Kunpack envelope header is too large')
  const prefix = Buffer.allocUnsafe(KUNPACK_PREFIX_BYTES)
  KUNPACK_MAGIC.copy(prefix, 0)
  prefix.writeUInt32BE(headerBytes.length, KUNPACK_MAGIC.length)
  const output = await open(input.outputPath, 'wx', 0o600)
  try {
    await output.write(prefix, 0, prefix.length, 0)
    await output.write(headerBytes, 0, headerBytes.length, prefix.length)
    const payloadPosition = prefix.length + headerBytes.length
    if (header.encryption.mode === 'passphrase') {
      if (!input.passphrase) throw new Error('Kunpack passphrase is required')
      await encryptKunpackFileToHandle({
        inputPath: input.zipPath,
        output,
        outputPosition: payloadPosition,
        passphrase: input.passphrase,
        settings: header.encryption,
        authenticatedHeader: headerBytes
      })
      await output.sync()
      return header
    }
  } catch (error) {
    await output.close().catch(() => undefined)
    await rm(input.outputPath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    await output.close().catch(() => undefined)
  }

  try {
    await pipeline(
      createReadStream(input.zipPath),
      createWriteStream(input.outputPath, { flags: 'a', mode: 0o600 })
    )
    return header
  } catch (error) {
    await rm(input.outputPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function readKunpackEnvelopeHeader(packagePath: string): Promise<ReadKunpackEnvelopeResult> {
  const handle = await open(packagePath, 'r')
  try {
    const prefix = Buffer.allocUnsafe(KUNPACK_PREFIX_BYTES)
    const prefixRead = await handle.read(prefix, 0, prefix.length, 0)
    if (prefixRead.bytesRead !== prefix.length || !prefix.subarray(0, KUNPACK_MAGIC.length).equals(KUNPACK_MAGIC)) {
      throw new Error('file is not a Kunpack package')
    }
    const headerLength = prefix.readUInt32BE(KUNPACK_MAGIC.length)
    if (headerLength < 2 || headerLength > KUNPACK_MAX_HEADER_BYTES) {
      throw new Error('Kunpack envelope header length is invalid')
    }
    const headerBytes = Buffer.allocUnsafe(headerLength)
    const headerRead = await handle.read(headerBytes, 0, headerLength, prefix.length)
    if (headerRead.bytesRead !== headerLength) throw new Error('Kunpack envelope header is truncated')
    const header = DataMigrationEnvelopeHeaderV1Schema.parse(JSON.parse(headerBytes.toString('utf8')))
    return { header, headerBytes, payloadOffset: prefix.length + headerLength }
  } finally {
    await handle.close()
  }
}

export async function materializeKunpackZip(input: {
  packagePath: string
  outputZipPath: string
  passphrase?: string
}): Promise<{ header: DataMigrationEnvelopeHeaderV1; framing?: KunpackFramedEncryptionResult }> {
  const envelope = await readKunpackEnvelopeHeader(input.packagePath)
  await mkdir(dirname(input.outputZipPath), { recursive: true, mode: 0o700 })
  let framing: KunpackFramedEncryptionResult | undefined
  if (envelope.header.encryption.mode === 'passphrase') {
    if (!input.passphrase) throw new Error('Kunpack passphrase is required')
    framing = await decryptKunpackFramesToFile({
      packagePath: input.packagePath,
      payloadOffset: envelope.payloadOffset,
      outputPath: input.outputZipPath,
      passphrase: input.passphrase,
      settings: envelope.header.encryption,
      authenticatedHeader: envelope.headerBytes
    })
  } else {
    try {
      await pipeline(
        createReadStream(input.packagePath, { start: envelope.payloadOffset }),
        createWriteStream(input.outputZipPath, { flags: 'wx', mode: 0o600 })
      )
    } catch (error) {
      await rm(input.outputZipPath, { force: true }).catch(() => undefined)
      throw error
    }
  }
  const details = await stat(input.outputZipPath)
  const digest = await sha256File(input.outputZipPath)
  if (details.size !== envelope.header.plainPayloadBytes || digest !== envelope.header.plainPayloadSha256) {
    await rm(input.outputZipPath, { force: true }).catch(() => undefined)
    throw new Error('Kunpack payload integrity check failed')
  }
  return { header: envelope.header, ...(framing ? { framing } : {}) }
}

export async function verifyKunpackPackage(input: {
  packagePath: string
  materializedZipPath: string
  passphrase?: string
  cleanupMaterialized?: boolean
}): Promise<{ header: DataMigrationEnvelopeHeaderV1; manifest: DataMigrationManifestV1; entries: DataMigrationPackageEntry[] }> {
  const { header } = await materializeKunpackZip({
    packagePath: input.packagePath,
    outputZipPath: input.materializedZipPath,
    ...(input.passphrase ? { passphrase: input.passphrase } : {})
  })
  try {
    const manifestBytes = await readZip64EntryBuffer(
      input.materializedZipPath,
      KUNPACK_MANIFEST_PATH,
      DATA_MIGRATION_MAX_METADATA_BYTES
    )
    const checksumsBytes = await readZip64EntryBuffer(
      input.materializedZipPath,
      KUNPACK_CHECKSUMS_PATH,
      DATA_MIGRATION_MAX_METADATA_BYTES
    )
    const manifest = DataMigrationManifestV1Schema.parse(JSON.parse(manifestBytes.toString('utf8')))
    if (manifest.formatVersion !== header.formatVersion) throw new Error('Kunpack envelope and manifest versions differ')
    if (canonicalEncryption(manifest.encryption) !== canonicalEncryption(header.encryption)) {
      throw new Error('Kunpack envelope and manifest encryption settings differ')
    }
    if (sha256Buffer(checksumsBytes) !== manifest.checksumsSha256) {
      throw new Error('Kunpack checksum catalog digest mismatch')
    }
    const entries = parseKunpackChecksums(checksumsBytes)
    if (entries.length !== manifest.counts.entries) throw new Error('Kunpack entry count differs from manifest')
    const expandedBytes = entries.reduce((total, entry) => total + entry.logicalBytes, 0)
    if (expandedBytes !== manifest.expandedBytes) throw new Error('Kunpack expanded bytes differ from manifest')
    const catalogs = entries.filter((entry) => entry.kind === 'catalog')
    const catalogPrepared: PreparedZip64ArchiveEntry[] = []
    for (const catalog of catalogs) {
      const contents = await readZip64EntryBuffer(
        input.materializedZipPath,
        catalog.path,
        DATA_MIGRATION_MAX_METADATA_BYTES
      )
      catalogPrepared.push({
        path: catalog.path,
        kind: catalog.kind,
        ...(catalog.ownerId ? { ownerId: catalog.ownerId } : {}),
        source: { kind: 'buffer', data: contents },
        metadata: catalog
      })
    }
    if (digestKunpackCatalogs(catalogPrepared) !== manifest.catalogsSha256) {
      throw new Error('Kunpack catalog digest mismatch')
    }
    await verifyZip64ArchiveEntries(
      input.materializedZipPath,
      entries,
      new Set([KUNPACK_MANIFEST_PATH, KUNPACK_CHECKSUMS_PATH])
    )
    return { header, manifest, entries }
  } finally {
    if (input.cleanupMaterialized !== false) {
      await rm(input.materializedZipPath, { force: true }).catch(() => undefined)
    }
  }
}

function digestKunpackCatalogs(entries: readonly PreparedZip64ArchiveEntry[]): string {
  const digest = createHash('sha256')
  for (const entry of entries
    .filter((candidate) => candidate.metadata.kind === 'catalog')
    .sort((left, right) => left.path.localeCompare(right.path))) {
    digest.update(entry.path)
    digest.update('\0')
    digest.update(entry.metadata.sha256)
    digest.update('\0')
    digest.update(String(entry.metadata.logicalBytes))
    digest.update('\n')
  }
  return digest.digest('hex')
}

function canonicalEncryption(encryption: DataMigrationEncryption): string {
  return serializeKunpackJson(encryption).toString('utf8')
}

function sha256Buffer(contents: Buffer): string {
  return createHash('sha256').update(contents).digest('hex')
}

async function publishWithoutOverwrite(temporaryPath: string, outputPath: string): Promise<void> {
  try {
    await link(temporaryPath, outputPath)
    await rm(temporaryPath, { force: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM' && (error as NodeJS.ErrnoException).code !== 'ENOTSUP') {
      throw error
    }
    const reservation = await open(outputPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600)
    await reservation.close()
    try {
      await rename(temporaryPath, outputPath)
    } catch (renameError) {
      await rm(outputPath, { force: true }).catch(() => undefined)
      throw renameError
    }
  }
}

export async function writeCanonicalKunpackJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, serializeKunpackJson(value), { mode: 0o600, flag: 'wx' })
}

export async function readCanonicalKunpackJson(path: string): Promise<unknown> {
  const details = await stat(path)
  if (!details.isFile() || details.size > DATA_MIGRATION_MAX_METADATA_BYTES) {
    throw new Error('Kunpack JSON metadata exceeds allowed size')
  }
  return JSON.parse(await readFile(path, 'utf8'))
}
