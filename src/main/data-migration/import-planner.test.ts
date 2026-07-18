import { createHash } from 'node:crypto'
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parsePackageRelativePath, type DataMigrationPackageEntry, type DataMigrationWorkspaceCatalogEntry } from '../../shared/data-migration'
import {
  buildDataMigrationImportPlan,
  detectWorkspaceConflicts,
  probeDestinationFileSystem,
  rebindDataMigrationReferences,
  recommendCollisionFreeDestination,
  stableImportedSiblingPath,
  type DestinationFileSystemProbe
} from './import-planner'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const workspace: DataMigrationWorkspaceCatalogEntry = {
  workspaceId: 'ws_source',
  displayName: 'Project',
  sourcePathDisplay: 'C:\\Users\\Alice\\Project',
  sourcePlatform: 'windows',
  fileCount: 1,
  logicalBytes: 5,
  relatedThreadIds: ['thread_old'],
  capabilities: ['code', 'design']
}

function packageEntry(relativePath: string, contents = 'hello'): DataMigrationPackageEntry {
  return {
    path: parsePackageRelativePath(`payload/workspaces/ws_source/files/${relativePath}`),
    kind: 'workspace-file',
    ownerId: 'ws_source',
    logicalBytes: Buffer.byteLength(contents),
    sha256: createHash('sha256').update(contents).digest('hex')
  }
}

describe('cross-platform migration import planning', () => {
  it('probes destination semantics without leaving probe files behind', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-import-probe-'))
    roots.push(root)
    const probe = await probeDestinationFileSystem(root)
    expect(probe.writable).toBe(true)
    expect(probe.freeBytes).toBeGreaterThan(0)
    expect(probe.maximumComponentBytes).toBe(255)
  })

  it('recommends stable collision-free Keep both destinations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-import-destination-'))
    roots.push(root)
    await mkdir(join(root, 'Project (Imported)'))
    expect(await recommendCollisionFreeDestination(root, 'Project')).toBe(join(root, 'Project (Imported 2)'))
  })

  it('builds a repeatable plan with disk estimates and default Keep both policy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-import-plan-'))
    roots.push(root)
    const input = {
      operationId: 'import_plan',
      packageId: 'package_plan',
      inspectedAt: '2026-07-15T00:00:00.000Z',
      sourcePlatform: 'windows' as const,
      encrypted: true,
      workspaces: [workspace],
      entries: [packageEntry('README.md')],
      destinationBaseRoot: root,
      destinationPlatform: process.platform === 'win32' ? 'windows' as const : 'macos' as const
    }
    const first = await buildDataMigrationImportPlan(input)
    const second = await buildDataMigrationImportPlan(input)
    // Free space is live filesystem telemetry and can legitimately change between
    // otherwise identical inspections. The logical plan must remain repeatable.
    expect({ ...first, mappings: first.mappings.map(({ freeBytes: _freeBytes, ...mapping }) => mapping) }).toEqual({
      ...second,
      mappings: second.mappings.map(({ freeBytes: _freeBytes, ...mapping }) => mapping)
    })
    expect(first.mappings[0]).toMatchObject({ strategy: 'keep-both', requiredBytes: 5, compatible: true })
    expect(first.estimatedPeakBytes).toBeGreaterThan(5)
  })

  it('detects case aliases and differing-content merge conflicts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-import-conflicts-'))
    roots.push(root)
    await writeFile(join(root, 'README.md'), 'target')
    const baseProbe: DestinationFileSystemProbe = {
      root,
      canonicalRoot: root,
      writable: true,
      caseSensitive: false,
      unicodeNormalizationSensitive: false,
      supportsSymbolicLinks: false,
      maximumComponentBytes: 255,
      maximumPathBytes: 4096,
      freeBytes: 10_000_000_000,
      platform: 'macos'
    }
    const conflicts = await detectWorkspaceConflicts({
      workspace,
      destinationRoot: root,
      entries: [packageEntry('README.md'), packageEntry('readme.md', 'other')],
      probe: baseProbe,
      strategy: 'merge'
    })
    expect(conflicts.map((conflict) => conflict.kind)).toEqual(['different-content', 'case-collision'])
  })

  it('rewrites only typed path and thread references while preserving prose', () => {
    const rebound = rebindDataMigrationReferences({
      component: 'thread',
      schemaVersion: 1,
      value: {
        id: 'thread_old',
        parentThreadId: 'parent_old',
        workspace: 'C:\\Users\\Alice\\Project',
        summary: 'See C:\\Users\\Alice\\Project and thread_old in this prose.'
      },
      workspacePathMap: { 'C:\\Users\\Alice\\Project': '/Users/bob/Project' },
      threadIdMap: { thread_old: 'thread_new', parent_old: 'parent_new' },
      sourcePlatform: 'windows'
    })
    expect(rebound.value).toEqual({
      id: 'thread_new',
      parentThreadId: 'parent_new',
      workspace: '/Users/bob/Project',
      summary: 'See C:\\Users\\Alice\\Project and thread_old in this prose.'
    })
    expect(rebound.unresolved).toEqual([])
  })

  it('creates deterministic imported-sibling names', () => {
    expect(stableImportedSiblingPath(parsePackageRelativePath('src/config.json'), 'abcdef012345')).toBe(
      'src/config.imported-abcdef01.json'
    )
  })

  it('blocks planning before staging when logical bytes exceed target free space', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-import-disk-full-'))
    roots.push(root)
    const oversized = packageEntry('huge.bin')
    oversized.logicalBytes = 1_000_000_000_000_000
    const result = await buildDataMigrationImportPlan({
      operationId: 'import_disk_full', packageId: 'package_disk_full', inspectedAt: 'now',
      sourcePlatform: 'windows', encrypted: true, workspaces: [workspace], entries: [oversized],
      destinationBaseRoot: root
    })
    expect(result.mappings[0]?.compatible).toBe(false)
    expect(result.mappings[0]!.requiredBytes).toBe(1_000_000_000_000_000)
  })

  it('reports a read-only destination as not writable without leaving a probe directory', async () => {
    if (process.platform === 'win32') return
    const root = await mkdtemp(join(tmpdir(), 'kun-import-read-only-'))
    roots.push(root)
    await chmod(root, 0o500)
    try {
      const probe = await probeDestinationFileSystem(root)
      expect(probe.writable).toBe(false)
    } finally {
      await chmod(root, 0o700)
    }
  })

  it('fails closed when a network destination disappears before its filesystem probe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-import-network-disconnect-'))
    await rm(root, { recursive: true, force: true })
    await expect(probeDestinationFileSystem(root)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
