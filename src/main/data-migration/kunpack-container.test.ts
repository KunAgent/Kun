import { mkdtemp, open, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DataMigrationManifestV1Schema,
  parsePackageRelativePath,
  type DataMigrationManifestV1
} from '../../shared/data-migration'
import {
  canonicalizeKunpackJson,
  createKunpackPackage,
  readKunpackEnvelopeHeader,
  serializeKunpackChecksums,
  serializeKunpackJson,
  verifyKunpackPackage,
  writeKunpackEnvelope
} from './kunpack-container'
import { createKunpackPassphraseEncryption } from './kunpack-crypto'
import { prepareZip64ArchiveEntries, writeZip64Archive } from './kunpack-zip'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'kunpack-test-'))
  temporaryDirectories.push(path)
  return path
}

function manifest(): DataMigrationManifestV1 {
  return DataMigrationManifestV1Schema.parse({
    formatVersion: 1,
    minimumReaderVersion: 1,
    packageId: 'package_test',
    sourceInstallationId: 'installation_test',
    sourceAppVersion: '0.1.0-test',
    sourceRuntimeVersion: '0.1.0-test',
    sourcePlatform: 'linux',
    sourceArch: 'x64',
    createdAt: '2026-07-15T00:00:00.000Z',
    encryption: { mode: 'none' },
    componentVersions: {
      manifest: 1,
      workspace: 1,
      thread: 1,
      session: 1,
      event: 1,
      attachment: 1,
      artifact: 1,
      memory: 1,
      'portable-settings': 1,
      'renderer-state': 1,
      workflow: 1,
      schedule: 1
    },
    selection: {
      preset: 'complete',
      workspaceIds: ['workspace_test'],
      threadIds: [],
      categories: ['workspace-files'],
      sensitiveContentAcknowledged: false,
      unencryptedPackageAcknowledged: true
    },
    counts: {
      workspaces: 1,
      threads: 0,
      entries: 0,
      attachments: 0,
      artifacts: 0,
      memories: 0
    },
    expandedBytes: 0,
    catalogsSha256: '0'.repeat(64),
    checksumsSha256: '0'.repeat(64)
  })
}

function sampleInputs() {
  return {
    catalogs: [{
      path: parsePackageRelativePath('catalog/workspaces.json'),
      value: [{ workspaceId: 'workspace_test', displayName: 'Demo' }]
    }],
    entries: [{
      path: parsePackageRelativePath('payload/workspaces/workspace_test/files/README.md'),
      kind: 'workspace-file' as const,
      ownerId: 'workspace_test',
      source: { kind: 'buffer' as const, data: Buffer.from('# Portable workspace\n', 'utf8') }
    }]
  }
}

describe('Kunpack canonical metadata', () => {
  it('sorts object keys recursively without changing array order', () => {
    expect(canonicalizeKunpackJson({ z: 1, a: { y: 2, x: 3 }, list: [{ b: 1, a: 2 }] })).toEqual({
      a: { x: 3, y: 2 },
      list: [{ a: 2, b: 1 }],
      z: 1
    })
    expect(serializeKunpackJson({ z: 1, a: 2 }).toString('utf8')).toBe('{"a":2,"z":1}\n')
  })

  it('makes checksum catalogs deterministic', () => {
    const left = {
      path: parsePackageRelativePath('payload/z'), kind: 'runtime-record' as const,
      logicalBytes: 1, sha256: 'a'.repeat(64)
    }
    const right = {
      path: parsePackageRelativePath('payload/a'), kind: 'runtime-record' as const,
      logicalBytes: 2, sha256: 'b'.repeat(64)
    }
    expect(serializeKunpackChecksums([left, right])).toEqual(serializeKunpackChecksums([right, left]))
  })
})

describe('Kunpack container', () => {
  it('creates and verifies an unencrypted ZIP64 package without overwriting an existing destination', async () => {
    const root = await temporaryDirectory()
    const packagePath = join(root, 'portable.kunpack')
    const created = await createKunpackPackage({
      outputPath: packagePath,
      manifest: manifest(),
      ...sampleInputs(),
      createdAt: '2026-07-15T00:00:00.000Z'
    })
    expect(created.header.encryption).toEqual({ mode: 'none' })
    expect(created.entries).toHaveLength(2)
    expect((await stat(packagePath)).size).toBeGreaterThan(0)

    const verified = await verifyKunpackPackage({
      packagePath,
      materializedZipPath: join(root, 'verify.zip')
    })
    expect(verified.manifest.counts.entries).toBe(2)
    expect(verified.entries.map((entry) => entry.path)).toEqual([
      'catalog/workspaces.json',
      'payload/workspaces/workspace_test/files/README.md'
    ])

    await expect(createKunpackPackage({
      outputPath: packagePath,
      manifest: manifest(),
      ...sampleInputs()
    })).rejects.toThrow('destination already exists')
  })

  it('creates and verifies a passphrase-encrypted framed package', async () => {
    const root = await temporaryDirectory()
    const packagePath = join(root, 'encrypted.kunpack')
    const settings = createKunpackPassphraseEncryption((size) => Buffer.alloc(size, size))
    const created = await createKunpackPackage({
      outputPath: packagePath,
      manifest: manifest(),
      ...sampleInputs(),
      passphrase: 'portable-test-password',
      encryptionSettings: settings,
      createdAt: '2026-07-15T00:00:00.000Z'
    })
    expect(created.header.encryption).toEqual(settings)

    const verified = await verifyKunpackPackage({
      packagePath,
      materializedZipPath: join(root, 'verify.zip'),
      passphrase: 'portable-test-password'
    })
    expect(verified.manifest.encryption).toEqual(settings)
  })

  it('rejects a wrong passphrase, ciphertext tampering, and a truncated frame', async () => {
    const root = await temporaryDirectory()
    const packagePath = join(root, 'encrypted.kunpack')
    await createKunpackPackage({
      outputPath: packagePath,
      manifest: manifest(),
      ...sampleInputs(),
      passphrase: 'correct-password',
      encryptionSettings: createKunpackPassphraseEncryption((size) => Buffer.alloc(size, 7))
    })

    await expect(verifyKunpackPackage({
      packagePath,
      materializedZipPath: join(root, 'wrong-password.zip'),
      passphrase: 'wrong-password'
    })).rejects.toThrow('passphrase or authenticated payload is invalid')

    const envelope = await readKunpackEnvelopeHeader(packagePath)
    const tamperedPath = join(root, 'tampered.kunpack')
    await writeFile(tamperedPath, await readFile(packagePath), { flag: 'wx' })
    const handle = await open(tamperedPath, 'r+')
    try {
      const byte = Buffer.alloc(1)
      const offset = envelope.payloadOffset + 8
      await handle.read(byte, 0, 1, offset)
      byte[0] ^= 0xff
      await handle.write(byte, 0, 1, offset)
    } finally {
      await handle.close()
    }
    await expect(verifyKunpackPackage({
      packagePath: tamperedPath,
      materializedZipPath: join(root, 'tampered.zip'),
      passphrase: 'correct-password'
    })).rejects.toThrow('passphrase or authenticated payload is invalid')

    const truncatedPath = join(root, 'truncated.kunpack')
    await writeFile(truncatedPath, await readFile(packagePath), { flag: 'wx' })
    const truncatedStats = await stat(truncatedPath)
    await truncate(truncatedPath, truncatedStats.size - 1)
    await expect(verifyKunpackPackage({
      packagePath: truncatedPath,
      materializedZipPath: join(root, 'truncated.zip'),
      passphrase: 'correct-password'
    })).rejects.toThrow('truncated')
  })

  it('detects corruption in an unencrypted package before ZIP parsing', async () => {
    const root = await temporaryDirectory()
    const packagePath = join(root, 'plain.kunpack')
    await createKunpackPackage({ outputPath: packagePath, manifest: manifest(), ...sampleInputs() })
    const details = await stat(packagePath)
    const handle = await open(packagePath, 'r+')
    try {
      const byte = Buffer.alloc(1)
      await handle.read(byte, 0, 1, details.size - 1)
      byte[0] ^= 0xff
      await handle.write(byte, 0, 1, details.size - 1)
    } finally {
      await handle.close()
    }
    await expect(verifyKunpackPackage({
      packagePath,
      materializedZipPath: join(root, 'corrupt.zip')
    })).rejects.toThrow('payload integrity check failed')
  })

  it('rejects a modified manifest even when the outer payload hash is recomputed', async () => {
    const root = await temporaryDirectory()
    const zipPath = join(root, 'modified-manifest.zip')
    const packagePath = join(root, 'modified-manifest.kunpack')
    const modifiedManifest = {
      ...manifest(),
      catalogsSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      checksumsSha256: '0'.repeat(64)
    }
    const structuralEntries = await prepareZip64ArchiveEntries([
      {
        path: parsePackageRelativePath('manifest.json'),
        kind: 'catalog',
        source: { kind: 'buffer', data: serializeKunpackJson(modifiedManifest) }
      },
      {
        path: parsePackageRelativePath('checksums.jsonl'),
        kind: 'catalog',
        source: { kind: 'buffer', data: Buffer.alloc(0) }
      }
    ])
    await writeZip64Archive({ outputPath: zipPath, entries: structuralEntries })
    await writeKunpackEnvelope({
      zipPath,
      outputPath: packagePath,
      encryption: { mode: 'none' },
      createdAt: '2026-07-15T00:00:00.000Z'
    })
    await expect(verifyKunpackPackage({
      packagePath,
      materializedZipPath: join(root, 'verify.zip')
    })).rejects.toThrow('checksum catalog digest mismatch')
  })
})
