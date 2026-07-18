import { mkdtemp, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { ProjectService, VideoEngineError } from '../src/engine/index.js'
import { makeProject } from './fixtures.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-video-project-'))
  roots.push(root)
  return root
}

describe('ProjectService', () => {
  it('creates, lists, atomically saves, and loads immutable revisions', async () => {
    const root = await workspace()
    const service = new ProjectService(root, { now: tickingClock() })
    const created = await service.createProject({ id: 'demo-project', name: 'Demo' })
    const candidate = makeProject()
    candidate.createdAt = created.createdAt
    candidate.updatedAt = created.updatedAt
    candidate.revisions = created.revisions
    const saved = await service.saveProject(candidate, 0, {
      author: 'manual',
      sourceOperation: 'test.populate',
      summary: 'Added media'
    })
    expect(saved.currentRevision).toBe(1)
    expect((await service.listProjects())[0]).toMatchObject({
      id: 'demo-project',
      currentRevision: 1,
      durationFrames: 180
    })
    expect((await service.loadRevision('demo-project', 0)).items).toEqual([])
    expect((await service.loadRevision('demo-project', 1)).items).toHaveLength(2)
    const timeline = await readFile(join(root, '.kun-video/projects/demo-project/timeline.md'), 'utf8')
    expect(timeline).toContain('Revision: `1`')
  })

  it('isolates a damaged project while listing the remaining valid projects', async () => {
    const root = await workspace()
    const service = new ProjectService(root)
    await service.createProject({ id: 'healthy', name: 'Healthy' })
    await mkdir(join(root, '.kun-video/projects/damaged'), { recursive: true })
    await writeFile(join(root, '.kun-video/projects/damaged/project.json'), '{broken json', 'utf8')

    const listed = await service.listProjectsWithDiagnostics()
    expect(listed.projects).toEqual([expect.objectContaining({ id: 'healthy' })])
    expect(listed.diagnostics).toEqual([{ id: 'damaged', code: 'invalid_project' }])
    await expect(service.loadProject('damaged')).rejects.toMatchObject({ code: 'invalid_project' })
  })

  it('enforces optimistic revision checks without partial writes', async () => {
    const root = await workspace()
    const service = new ProjectService(root)
    const created = await service.createProject({ id: 'conflict', name: 'Conflict' })
    const candidate = structuredClone(created)
    candidate.name = 'Changed'
    await service.saveProject(candidate, 0, {
      author: 'agent',
      sourceOperation: 'agent.rename',
      summary: 'Renamed project'
    })
    await expect(service.saveProject(candidate, 0, {
      author: 'manual',
      sourceOperation: 'manual.rename',
      summary: 'Stale rename'
    })).rejects.toMatchObject({ code: 'revision_conflict' })
    expect((await service.loadProject('conflict')).name).toBe('Changed')
  })

  it('rolls back a pre-commit snapshot and permits the same revision to retry', async () => {
    const root = await workspace()
    let failSnapshot = true
    const service = new ProjectService(root, {
      commitPhaseHook: (phase) => {
        if (phase === 'snapshot' && failSnapshot) {
          failSnapshot = false
          throw new Error('injected pre-commit failure')
        }
      }
    })
    const created = await service.createProject({ id: 'retryable', name: 'Before' })
    const candidate = structuredClone(created)
    candidate.name = 'After'
    await expect(service.saveProject(candidate, 0, {
      author: 'manual',
      sourceOperation: 'test.rename',
      summary: 'Rename once'
    })).rejects.toThrow('injected pre-commit failure')
    expect(await service.loadProject('retryable')).toMatchObject({
      name: 'Before',
      currentRevision: 0
    })
    await expect(service.loadRevision('retryable', 1)).rejects.toMatchObject({
      code: 'history_unavailable'
    })

    const saved = await service.saveProject(candidate, 0, {
      author: 'manual',
      sourceOperation: 'test.rename',
      summary: 'Retry rename'
    })
    expect(saved).toMatchObject({ name: 'After', currentRevision: 1 })
  })

  it('recovers timeline and snapshot when failure follows the project commit point', async () => {
    const root = await workspace()
    let failProject = true
    const service = new ProjectService(root, {
      commitPhaseHook: (phase) => {
        if (phase === 'project' && failProject) {
          failProject = false
          throw new Error('injected post-commit failure')
        }
      }
    })
    const created = await service.createProject({ id: 'recoverable', name: 'Before' })
    const candidate = structuredClone(created)
    candidate.name = 'After'
    const saved = await service.saveProject(candidate, 0, {
      author: 'agent',
      sourceOperation: 'test.rename',
      summary: 'Committed rename'
    })
    expect(saved).toMatchObject({ name: 'After', currentRevision: 1 })
    expect(await service.loadRevision('recoverable', 1)).toMatchObject({
      name: 'After',
      currentRevision: 1
    })
    const timeline = await readFile(
      join(root, '.kun-video/projects/recoverable/timeline.md'),
      'utf8'
    )
    expect(timeline).toContain('Revision: `1`')
    await expect(readFile(
      join(root, '.kun-video/projects/recoverable/.pending-commit.json'),
      'utf8'
    )).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('commits undo and redo as new revisions while retaining snapshots', async () => {
    const root = await workspace()
    const service = new ProjectService(root, { now: tickingClock() })
    const created = await service.createProject({ id: 'history', name: 'Before' })
    const changed = structuredClone(created)
    changed.name = 'After'
    const revision1 = await service.saveProject(changed, 0, {
      author: 'agent',
      sourceOperation: 'agent.rename',
      summary: 'Changed title'
    })
    const undone = await service.undo('history', revision1.currentRevision)
    expect(undone).toMatchObject({ name: 'Before', currentRevision: 2, redoStack: [1] })
    const redone = await service.redo('history', undone.currentRevision)
    expect(redone).toMatchObject({ name: 'After', currentRevision: 3, redoStack: [] })
    expect(redone.revisions.at(-1)).toMatchObject({
      sourceOperation: 'history.redo',
      restoredFromRevision: 1
    })
  })

  it('atomically imports a revision-fenced interchange snapshot without overwriting', async () => {
    const root = await workspace()
    const service = new ProjectService(root, { now: tickingClock() })
    const source = makeProject()
    source.assets[0] = {
      ...source.assets[0]!,
      mediaHandleId: 'otio_offline_asset-1',
      availability: 'offline',
      recovery: { reason: 'missing' }
    }
    const imported = await service.importProject({
      project: source,
      targetProjectId: 'imported-cut',
      expectedSourceProjectId: source.id,
      expectedSourceRevision: source.currentRevision,
      sourceDocumentDigest: 'a'.repeat(64)
    })

    expect(imported).toMatchObject({
      id: 'imported-cut',
      currentRevision: source.currentRevision + 1,
      activeSequenceId: 'sequence-main',
      undoStack: [],
      redoStack: [],
      agentUndoStack: []
    })
    expect(imported.items.map(({ id }) => id)).toEqual(source.items.map(({ id }) => id))
    expect(imported.sequences.map(({ id }) => id)).toEqual(source.sequences.map(({ id }) => id))
    expect(imported.revisions.at(-1)).toMatchObject({
      parentRevision: source.currentRevision,
      sourceOperation: 'interchange.otio.import'
    })

    await expect(service.importProject({
      project: source,
      targetProjectId: 'imported-cut',
      expectedSourceProjectId: source.id,
      expectedSourceRevision: source.currentRevision,
      sourceDocumentDigest: 'a'.repeat(64)
    })).rejects.toMatchObject({ code: 'project_exists' })
    expect((await service.loadProject('imported-cut')).items.map(({ id }) => id))
      .toEqual(source.items.map(({ id }) => id))
    await expect(service.importProject({
      project: source,
      targetProjectId: 'stale-import',
      expectedSourceProjectId: source.id,
      expectedSourceRevision: source.currentRevision + 1,
      sourceDocumentDigest: 'a'.repeat(64)
    })).rejects.toMatchObject({ code: 'revision_conflict' })
  })

  it('rejects traversal and symbolic-link project roots', async () => {
    const root = await workspace()
    const service = new ProjectService(root)
    await expect(service.createProject({ id: '../escape', name: 'Escape' }))
      .rejects.toBeInstanceOf(VideoEngineError)

    const linkedRoot = await workspace()
    const outside = await workspace()
    await mkdir(join(linkedRoot, '.placeholder'))
    await symlink(outside, join(linkedRoot, '.kun-video'))
    const linked = new ProjectService(linkedRoot)
    await expect(linked.createProject({ id: 'safe-id', name: 'Unsafe storage' }))
      .rejects.toMatchObject({ code: 'path_escape' })
  })

  it('refuses a project state file replaced by a symbolic link', async () => {
    const root = await workspace()
    const outside = await workspace()
    const service = new ProjectService(root)
    await service.createProject({ id: 'linked-state', name: 'Linked state' })
    const projectPath = join(root, '.kun-video/projects/linked-state/project.json')
    await rename(projectPath, `${projectPath}.original`)
    const external = join(outside, 'project.json')
    await writeFile(external, '{}')
    await symlink(external, projectPath)
    await expect(service.loadProject('linked-state')).rejects.toMatchObject({ code: 'path_escape' })
  })
})

function tickingClock(): () => Date {
  let tick = 0
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++))
}
