import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PROJECT_LIMITS,
  ProjectService,
  type TimelineItem,
  type VideoProject
} from '../src/engine/index.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('schema-v2 project command service', () => {
  it('serializes manual and Agent writers and rejects the stale transaction atomically', async () => {
    const service = await projectService()
    const initial = await service.createProject({ id: 'race-project', name: 'Initial' })
    const manual = { ...structuredClone(initial), name: 'Manual won' }
    const agent = { ...structuredClone(initial), name: 'Agent won' }

    const settled = await Promise.allSettled([
      service.executeCommand({
        projectId: initial.id,
        expectedRevision: 0,
        attribution: { author: 'manual', sourceOperation: 'ui.rename', summary: 'Manual rename' },
        command: { kind: 'replace-project', project: manual }
      }),
      service.executeCommand({
        projectId: initial.id,
        expectedRevision: 0,
        attribution: {
          author: 'agent',
          actorId: 'main-agent',
          sourceOperation: 'agent.rename',
          summary: 'Agent rename'
        },
        command: { kind: 'replace-project', project: agent }
      })
    ])

    expect(settled.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    const rejected = settled.find(({ status }) => status === 'rejected')
    expect(rejected).toMatchObject({ reason: { code: 'revision_conflict' } })
    const loaded = await service.loadProject(initial.id)
    expect(loaded.currentRevision).toBe(1)
    expect(['Manual won', 'Agent won']).toContain(loaded.name)
  })

  it('rolls back a batch when one operation is invalid', async () => {
    const service = await projectService()
    const project = await withMedia(service, 'atomic-project')

    await expect(service.executeCommand({
      projectId: project.id,
      expectedRevision: project.currentRevision,
      attribution: { author: 'manual', sourceOperation: 'ui.batch', summary: 'Invalid batch' },
      command: {
        kind: 'timeline',
        operations: [
          { type: 'set-canvas', preset: '9:16', fit: 'crop' },
          { type: 'delete-item', itemId: 'missing-item' }
        ]
      }
    })).rejects.toMatchObject({ code: 'invalid_operation' })

    const loaded = await service.loadProject(project.id)
    expect(loaded.currentRevision).toBe(project.currentRevision)
    expect(loaded.canvas.preset).toBe('16:9')
  })

  it('returns bounded attributable receipts and compresses uniform shifts', async () => {
    const service = await projectService()
    let project = await withMedia(service, 'receipt-project', 4)
    const shifted = structuredClone(project)
    shifted.items.forEach((item) => { item.timelineStartFrame += 10 })

    const result = await service.saveProjectWithReceipt(shifted, project.currentRevision, {
      author: 'agent',
      actorId: 'main-agent',
      sourceOperation: 'agent.ripple-shift',
      summary: 'Shifted the interview cut'
    })

    expect(result.receipt).toMatchObject({
      previousRevision: project.currentRevision,
      newRevision: project.currentRevision + 1,
      generation: project.eventGeneration + 1,
      attribution: { author: 'agent', actorId: 'main-agent' },
      shifts: [{
        sequenceId: 'sequence-main',
        trackId: 'video-1',
        fromFrame: 0,
        deltaFrames: 10,
        count: 4
      }],
      proofInvalidated: true,
      notes: [{ messageKey: 'video.receipt.commandCommitted' }]
    })
    expect(result.receipt.changedIds.filter(({ kind }) => kind === 'item')).toEqual([])

    project = result.project
    const many = structuredClone(project)
    many.assets.push(...Array.from({ length: 300 }, (_, index) => ({
      id: `extra-asset-${index}`,
      name: `extra-${index}.mp4`,
      kind: 'video' as const,
      mediaHandleId: `media_extra_${index}`,
      durationUs: 1_000_000,
      container: 'mp4',
      video: { codec: 'h264', width: 640, height: 360, frameRate: { numerator: 30, denominator: 1 } },
      transcriptIds: []
    })))
    const bounded = await service.saveProjectWithReceipt(many, project.currentRevision, {
      author: 'manual',
      sourceOperation: 'ui.batch-import',
      summary: 'Imported many assets'
    })
    expect(bounded.receipt.createdIds).toHaveLength(PROJECT_LIMITS.receiptIds)
    expect(bounded.receipt.truncated.created).toBe(44)
  })

  it('fences Agent-owned undo after manual work while ordinary undo remains available', async () => {
    const service = await projectService()
    let project = await service.createProject({ id: 'undo-project', name: 'Initial' })
    let candidate = { ...structuredClone(project), name: 'Agent edit' }
    let committed = await service.saveProjectWithReceipt(candidate, 0, {
      author: 'agent',
      actorId: 'main-agent',
      sourceOperation: 'agent.rename',
      summary: 'Agent renamed project'
    })
    expect(committed.project.agentUndoStack.at(-1)).toMatchObject({
      revision: 1,
      actorId: 'main-agent',
      transactionId: committed.receipt.transactionId
    })

    const undone = await service.undoAgent(project.id, 1, 'main-agent')
    expect(undone.project.name).toBe('Initial')

    project = undone.project
    candidate = { ...structuredClone(project), name: 'Agent second edit' }
    committed = await service.saveProjectWithReceipt(candidate, project.currentRevision, {
      author: 'agent',
      actorId: 'main-agent',
      sourceOperation: 'agent.rename',
      summary: 'Agent renamed project again'
    })
    const manual = { ...structuredClone(committed.project), name: 'Manual edit' }
    const manualCommit = await service.saveProjectWithReceipt(manual, committed.project.currentRevision, {
      author: 'manual',
      sourceOperation: 'ui.rename',
      summary: 'User renamed project'
    })

    await expect(service.undoAgent(project.id, manualCommit.project.currentRevision, 'main-agent'))
      .rejects.toMatchObject({ code: 'agent_undo_fenced' })
    const ordinaryUndo = await service.undo(project.id, manualCommit.project.currentRevision, 'manual')
    expect(ordinaryUndo.name).toBe('Agent second edit')
  })

  it('updates selection generations without churning render revisions', async () => {
    const service = await projectService()
    const project = await withMedia(service, 'selection-project')

    const updated = await service.updateSelection(
      project.id,
      project.currentRevision,
      project.selection.generation,
      { playheadFrame: 12, selectedItemIds: ['item-1'], range: { startFrame: 5, endFrame: 20 } }
    )

    expect(updated).toMatchObject({
      revision: project.currentRevision,
      generation: project.selection.generation + 1,
      eventGeneration: project.eventGeneration + 1,
      selection: { playheadFrame: 12, selectedItemIds: ['item-1'] }
    })
    await expect(service.updateSelection(
      project.id,
      project.currentRevision,
      project.selection.generation,
      { playheadFrame: 13 }
    )).rejects.toMatchObject({ code: 'revision_conflict' })
    expect((await service.loadProject(project.id)).currentRevision).toBe(project.currentRevision)
  })
})

async function projectService(): Promise<ProjectService> {
  const root = await mkdtemp(join(tmpdir(), 'kun-video-command-v2-'))
  roots.push(root)
  return new ProjectService(root, { now: () => new Date('2026-02-01T00:00:00.000Z') })
}

async function withMedia(
  service: ProjectService,
  projectId: string,
  itemCount = 1
): Promise<VideoProject> {
  const project = await service.createProject({ id: projectId, name: 'Editing project' })
  const candidate = structuredClone(project)
  candidate.assets.push({
    id: 'asset-1',
    name: 'interview.mp4',
    kind: 'video',
    mediaHandleId: 'media_asset_1',
    durationUs: 20_000_000,
    container: 'mp4',
    video: { codec: 'h264', width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 } },
    transcriptIds: []
  })
  candidate.items.push(...Array.from({ length: itemCount }, (_, index): TimelineItem => ({
    id: `item-${index + 1}`,
    assetId: 'asset-1',
    trackId: 'video-1',
    timelineStartFrame: index * 30,
    durationFrames: 30,
    sourceStartUs: index * 1_000_000,
    sourceEndUs: (index + 1) * 1_000_000,
    speed: { numerator: 1, denominator: 1 },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    opacity: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0
  })))
  return await service.saveProject(candidate, 0, {
    author: 'manual',
    sourceOperation: 'fixture.media',
    summary: 'Added media fixture'
  })
}
