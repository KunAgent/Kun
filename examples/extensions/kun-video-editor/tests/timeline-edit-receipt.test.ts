import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectService } from '../src/engine/project-service.js'
import {
  commitTimelineEditPlan,
  planRippleInsert
} from '../src/engine/timeline-edit-planners.js'
import { makeItem, makeProject } from './fixtures.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('timeline plan command receipts', () => {
  it('commits a ripple plan through the shared command service and compresses its uniform shift', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-video-timeline-receipt-'))
    roots.push(root)
    const service = new ProjectService(root)
    const created = await service.createProject({ id: 'demo-project', name: 'Demo' })
    const candidate = makeProject()
    candidate.createdAt = created.createdAt
    candidate.updatedAt = created.updatedAt
    candidate.revisions = created.revisions
    candidate.items = Array.from({ length: 5 }, (_, index) =>
      makeItem(`clip-${index}`, index * 30, index * 1_000_000, (index + 1) * 1_000_000, 'video-1')
    )
    candidate.sequences[0]!.items = structuredClone(candidate.items)
    candidate.captions = []
    candidate.sequences[0]!.captions = []
    const populated = await service.saveProject(candidate, 0, {
      author: 'manual',
      sourceOperation: 'test.populate',
      summary: 'Populated timeline'
    })
    const plan = planRippleInsert({
      items: populated.items,
      tracks: populated.tracks.map((track) => ({
        id: track.id,
        locked: track.locked,
        syncLocked: track.id === 'video-1'
      })),
      targetTrackId: 'video-1',
      atFrame: 30,
      durationFrames: 15
    })

    const committed = await commitTimelineEditPlan(service, {
      projectId: populated.id,
      expectedRevision: populated.currentRevision,
      beforeItems: populated.items,
      plan,
      metadata: {
        author: 'manual',
        sourceOperation: 'timeline.ripple-insert',
        summary: 'Ripple inserted 15 frames'
      }
    })

    expect(committed.project.currentRevision).toBe(2)
    expect(committed.project.items.slice(1).map(({ timelineStartFrame }) => timelineStartFrame)).toEqual([45, 75, 105, 135])
    expect(committed.receipt).toMatchObject({
      previousRevision: 1,
      newRevision: 2,
      attribution: { author: 'manual', sourceOperation: 'timeline.ripple-insert' },
      shifts: [{
        trackId: 'video-1',
        fromFrame: 30,
        deltaFrames: 15,
        count: 4
      }]
    })
    expect(committed.receipt.changedIds).not.toEqual(expect.arrayContaining([
      { kind: 'item', id: 'clip-1' },
      { kind: 'item', id: 'clip-2' },
      { kind: 'item', id: 'clip-3' },
      { kind: 'item', id: 'clip-4' }
    ]))
  })
})
