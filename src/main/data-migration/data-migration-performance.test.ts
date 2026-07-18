import { mkdtemp, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { runInNewContext } from 'node:vm'
import { setFlagsFromString } from 'node:v8'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parsePackageRelativePath,
  type DataMigrationPackageEntry
} from '../../shared/data-migration'
import {
  validateKunpackArchiveDirectory
} from './archive-security'
import {
  extractZip64ArchiveEntries,
  prepareZip64ArchiveEntries,
  writeZip64Archive,
  type Zip64DirectoryEntry
} from './kunpack-zip'

const roots: string[] = []

function createGarbageCollector(): () => void {
  setFlagsFromString('--expose_gc')
  try {
    return runInNewContext('gc') as () => void
  } finally {
    setFlagsFromString('--no-expose_gc')
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('data migration streaming performance', () => {
  it('streams a large file with bounded buffer growth and intra-file progress', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kunpack-large-file-'))
    roots.push(root)
    const sourcePath = join(root, 'large.bin')
    const archivePath = join(root, 'large.zip')
    const destinationRoot = join(root, 'extracted')
    const destinationPath = join(destinationRoot, 'large.bin')
    const logicalBytes = 32 * 1024 * 1024
    await writeFile(sourcePath, '')
    await truncate(sourcePath, logicalBytes)
    const prepared = await prepareZip64ArchiveEntries([{
      path: parsePackageRelativePath('payload/large.bin'),
      kind: 'workspace-file',
      source: { kind: 'file', path: sourcePath }
    }])
    await writeZip64Archive({ outputPath: archivePath, entries: prepared })

    // Node 22 may defer collecting already-consumed zlib Buffer wrappers until
    // their cumulative external allocation approaches the input size. Sample
    // after collection so this assertion measures live stream buffers instead
    // of GC scheduling, which differs across supported Node versions.
    const collectGarbage = createGarbageCollector()
    collectGarbage()
    const baseline = process.memoryUsage().arrayBuffers
    let peak = baseline
    const sampleLiveBuffers = () => {
      collectGarbage()
      peak = Math.max(peak, process.memoryUsage().arrayBuffers)
    }
    const progress: Array<{ bytes: number; entries: number }> = []
    const started = performance.now()
    await extractZip64ArchiveEntries({
      archivePath,
      destinationRoot,
      entries: prepared.map((entry) => entry.metadata),
      destinationPath: () => destinationPath,
      onProgress: (value) => {
        progress.push({ bytes: value.bytes, entries: value.entries })
        sampleLiveBuffers()
      }
    })
    sampleLiveBuffers()
    const elapsedMs = performance.now() - started

    expect((await stat(destinationPath)).size).toBe(logicalBytes)
    expect(progress.length).toBeGreaterThan(8)
    expect(progress.at(-1)).toEqual({ bytes: logicalBytes, entries: 1 })
    expect(peak - baseline).toBeLessThan(24 * 1024 * 1024)
    expect(elapsedMs).toBeLessThan(15_000)
  }, 20_000)

  it('validates a high entry count in linear time without materializing payloads', () => {
    const entryCount = 50_000
    const sha256 = 'a'.repeat(64)
    const declarations: DataMigrationPackageEntry[] = []
    const directory: Zip64DirectoryEntry[] = []
    for (let index = 0; index < entryCount; index += 1) {
      const path = parsePackageRelativePath(`payload/files/${String(index).padStart(6, '0')}.txt`)
      declarations.push({ path, kind: 'workspace-file', logicalBytes: 1, sha256 })
      directory.push({
        path,
        compressedBytes: 1,
        logicalBytes: 1,
        compressionMethod: 0,
        encrypted: false,
        directory: false,
        mode: 0o100600,
        modifiedAt: '2026-07-15T00:00:00.000Z'
      })
    }
    const baseline = process.memoryUsage().heapUsed
    const started = performance.now()
    validateKunpackArchiveDirectory(directory, declarations)
    const elapsedMs = performance.now() - started
    const heapGrowth = process.memoryUsage().heapUsed - baseline

    expect(elapsedMs).toBeLessThan(5_000)
    expect(heapGrowth).toBeLessThan(96 * 1024 * 1024)
  }, 10_000)
})
