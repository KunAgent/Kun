import { mkdtemp, mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parsePackageRelativePath } from '../../shared/data-migration'
import { prepareZip64ArchiveEntries, writeZip64Archive } from './kunpack-zip'
import {
  commitStagedWorkspace,
  restoreWorkspaceCommit,
  stageWorkspaceImport
} from './workspace-staging'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function archive(root: string, files: Array<{ path: string; contents: string; linkTarget?: string }>) {
  const archivePath = join(root, `archive-${Math.random().toString(36).slice(2)}.zip`)
  const prepared = await prepareZip64ArchiveEntries(files.map((file) => ({
    path: parsePackageRelativePath(`payload/workspaces/ws_test/files/${file.path}`),
    kind: 'workspace-file' as const,
    ownerId: 'ws_test',
    source: { kind: 'buffer' as const, data: Buffer.from(file.contents) },
    ...(file.linkTarget
      ? { linkTarget: parsePackageRelativePath(`payload/workspaces/ws_test/files/${file.linkTarget}`) }
      : {})
  })))
  await writeZip64Archive({ outputPath: archivePath, entries: prepared })
  return { archivePath, entries: prepared.map((entry) => entry.metadata) }
}

describe('workspace staging and conflict commits', () => {
  it('extracts into a same-parent hidden root, verifies hashes, and atomically commits Keep both', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-workspace-stage-'))
    roots.push(root)
    const source = await archive(root, [
      { path: 'README.md', contents: 'hello' },
      { path: 'src/index.ts', contents: 'export {}' }
    ])
    const destination = join(root, 'Project (Imported)')
    const staged = await stageWorkspaceImport({
      operationId: 'import_keep_both', workspaceId: 'ws_test',
      archivePath: source.archivePath, entries: source.entries,
      destinationRoot: destination,
      destinationPlatform: process.platform === 'win32' ? 'windows' : 'macos',
      supportsSymbolicLinks: false
    })
    expect(staged.stagingRoot).toContain('.kun-migration-staging-')
    const committed = await commitStagedWorkspace({ staged, strategy: 'keep-both' })
    expect(await readFile(join(destination, 'README.md'), 'utf8')).toBe('hello')
    expect(committed.mutations[0]?.kind).toBe('create')
    expect(await restoreWorkspaceCommit(committed.mutations)).toEqual([])
    await expect(readFile(join(destination, 'README.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('supports Merge imported-sibling and replace-with-backup decisions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-workspace-merge-'))
    roots.push(root)
    const destination = join(root, 'Project')
    await mkdir(destination)
    await writeFile(join(destination, 'config.json'), 'target')
    const source = await archive(root, [{ path: 'config.json', contents: 'source' }])

    const siblingStage = await stageWorkspaceImport({
      operationId: 'import_sibling', workspaceId: 'ws_test', archivePath: source.archivePath,
      entries: source.entries, destinationRoot: destination, destinationPlatform: 'macos', supportsSymbolicLinks: false
    })
    const sibling = await commitStagedWorkspace({
      staged: siblingStage,
      strategy: 'merge',
      resolutions: { 'config.json': 'import-sibling' }
    })
    expect(await readFile(join(destination, 'config.json'), 'utf8')).toBe('target')
    expect(await readFile(join(destination, 'config.imported-41cf6794.json'), 'utf8')).toBe('source')
    expect(sibling.mutations.some((mutation) => mutation.kind === 'sibling')).toBe(true)

    const replaceStage = await stageWorkspaceImport({
      operationId: 'import_replace', workspaceId: 'ws_test', archivePath: source.archivePath,
      entries: source.entries, destinationRoot: destination, destinationPlatform: 'macos', supportsSymbolicLinks: false
    })
    const replaced = await commitStagedWorkspace({ staged: replaceStage, strategy: 'replace' })
    expect(await readFile(join(destination, 'config.json'), 'utf8')).toBe('source')
    expect(replaced.backupRoot).toContain('.kun-migration-backup')
    expect(await restoreWorkspaceCommit(replaced.mutations)).toEqual([])
    expect(await readFile(join(destination, 'config.json'), 'utf8')).toBe('target')
  })

  it('materializes only internal relative links when the destination supports them', async () => {
    if (process.platform === 'win32') return
    const root = await mkdtemp(join(tmpdir(), 'kun-workspace-links-'))
    roots.push(root)
    const source = await archive(root, [
      { path: 'target.txt', contents: 'target' },
      { path: 'nested/link.txt', contents: 'target.txt', linkTarget: 'target.txt' }
    ])
    const destination = join(root, 'Project')
    const staged = await stageWorkspaceImport({
      operationId: 'import_links', workspaceId: 'ws_test', archivePath: source.archivePath,
      entries: source.entries, destinationRoot: destination, destinationPlatform: 'macos', supportsSymbolicLinks: true
    })
    expect(await readlink(join(staged.stagingRoot, 'nested', 'link.txt'))).toBe('../target.txt')
    await commitStagedWorkspace({ staged, strategy: 'keep-both' })
    expect(await readFile(join(destination, 'nested', 'link.txt'), 'utf8')).toBe('target')
  })

  it('preserves independently modified imported paths during rollback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-workspace-rollback-'))
    roots.push(root)
    const source = await archive(root, [{ path: 'README.md', contents: 'imported' }])
    const destination = join(root, 'Project')
    const staged = await stageWorkspaceImport({
      operationId: 'import_rollback', workspaceId: 'ws_test', archivePath: source.archivePath,
      entries: source.entries, destinationRoot: destination, destinationPlatform: 'macos', supportsSymbolicLinks: false
    })
    const committed = await commitStagedWorkspace({ staged, strategy: 'keep-both' })
    await writeFile(join(destination, 'README.md'), 'user changed after import')
    const warnings = await restoreWorkspaceCommit(committed.mutations)
    expect(warnings[0]).toContain('Preserved independently modified path')
    expect(await readFile(join(destination, 'README.md'), 'utf8')).toBe('user changed after import')
  })

  it('fails closed when a removable destination volume disappears after staging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-workspace-removable-'))
    const source = await archive(root, [{ path: 'README.md', contents: 'portable' }])
    const destination = join(root, 'Project')
    const staged = await stageWorkspaceImport({
      operationId: 'import_removed_volume', workspaceId: 'ws_test', archivePath: source.archivePath,
      entries: source.entries, destinationRoot: destination,
      destinationPlatform: process.platform === 'win32' ? 'windows' : 'macos', supportsSymbolicLinks: false
    })
    await rm(root, { recursive: true, force: true })
    await expect(commitStagedWorkspace({ staged, strategy: 'keep-both' })).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
