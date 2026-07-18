import { describe, expect, it } from 'vitest'
import { applyTimelineOperations, type VideoProject } from '../src/engine/index.js'
import { planMulticamEditorAction } from '../src/host/multicam-control.js'
import { makeProject } from './fixtures.js'

function projectWithCameras(): VideoProject {
  const project = makeProject()
  project.assets[0] = {
    ...project.assets[0]!,
    id: 'wide-asset',
    name: 'Wide.mp4',
    transcriptIds: [],
    durationUs: 10_000_000,
    video: {
      codec: 'h264', width: 1920, height: 1080,
      frameRate: { numerator: 30, denominator: 1 }
    }
  }
  project.assets.push({
    ...structuredClone(project.assets[0]!),
    id: 'close-asset',
    name: 'Close.mp4',
    mediaHandleId: 'media_close_asset_opaque'
  })
  project.transcripts = []
  project.items = []
  project.captions = []
  project.sequences[0]!.items = []
  project.sequences[0]!.captions = []
  return project
}

describe('multicam Host control planning', () => {
  it('creates unknown non-reference sync, applies explicit manual confirmation, labels, and switching', () => {
    let project = projectWithCameras()
    const created = planMulticamEditorAction(project, 'multicam.create', {
      projectId: project.id,
      expectedRevision: 0,
      groupId: 'interview-cameras',
      name: 'Interview cameras',
      referenceMemberId: 'wide',
      members: [
        { id: 'wide', assetId: 'wide-asset', memberLabel: 'Camera one', angleLabel: 'Wide' },
        { id: 'close', assetId: 'close-asset', memberLabel: 'Camera two', angleLabel: 'Close' }
      ]
    })
    project = applyTimelineOperations(project, created.operations).project
    expect(project.multicamGroups?.[0]).toMatchObject({
      id: 'interview-cameras',
      members: [
        { id: 'wide', sync: { status: 'reference', confidence: 1 } },
        { id: 'close', sync: { status: 'unknown', evidence: [] } }
      ],
      layouts: [{ id: 'layout-interview-cameras-grid', slots: expect.any(Array) }]
    })
    expect(() => applyTimelineOperations(project, [{
      type: 'switch-multicam-angle', groupId: 'interview-cameras', memberId: 'close',
      startFrame: 30, endFrame: 60
    }])).toThrow(/evidence is unavailable/iu)

    const synchronized = planMulticamEditorAction(project, 'multicam.sync-confirm', {
      projectId: project.id,
      expectedRevision: 0,
      groupId: 'interview-cameras',
      memberId: 'close',
      offsetFrames: 0
    })
    project = applyTimelineOperations(project, synchronized.operations).project
    expect(project.multicamGroups?.[0]?.members[1]?.sync).toMatchObject({
      status: 'verified',
      confidence: 1,
      evidence: [{ kind: 'manual-confirmation', algorithmId: 'kun.manual-sync' }]
    })

    const labels = planMulticamEditorAction(project, 'multicam.labels', {
      projectId: project.id,
      expectedRevision: 0,
      groupId: 'interview-cameras',
      name: 'Keynote cameras',
      members: [{ memberId: 'close', angleLabel: 'Speaker close-up' }]
    })
    project = applyTimelineOperations(project, labels.operations).project
    expect(project.multicamGroups?.[0]).toMatchObject({
      name: 'Keynote cameras',
      members: expect.arrayContaining([
        expect.objectContaining({ id: 'close', angleLabel: 'Speaker close-up' })
      ])
    })

    const switched = planMulticamEditorAction(project, 'multicam.switch', {
      projectId: project.id,
      expectedRevision: 0,
      groupId: 'interview-cameras',
      memberId: 'close',
      startFrame: 30,
      endFrame: 60,
      coveragePolicy: 'reject'
    })
    project = applyTimelineOperations(project, switched.operations).project
    expect(project.multicamGroups?.[0]?.programFragments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        startFrame: 30,
        endFrame: 60,
        selection: { kind: 'angle', memberId: 'close' }
      })
    ]))
  })

  it('rejects path-like labels and unknown payload fields before project mutation', () => {
    const project = projectWithCameras()
    expect(() => planMulticamEditorAction(project, 'multicam.create', {
      projectId: project.id,
      expectedRevision: 0,
      groupId: 'interview-cameras',
      name: '/Users/private/interview',
      referenceMemberId: 'wide',
      members: [
        { id: 'wide', assetId: 'wide-asset', memberLabel: 'Wide', angleLabel: 'Wide' },
        { id: 'close', assetId: 'close-asset', memberLabel: 'Close', angleLabel: 'Close' }
      ]
    })).toThrow(/Invalid multicam name/u)
    expect(() => planMulticamEditorAction(project, 'multicam.delete', {
      projectId: project.id,
      expectedRevision: 0,
      groupId: 'interview-cameras',
      rawPath: '/tmp/camera.mov'
    })).toThrow(/Unsupported multicam field/u)
  })

  it('keeps generated layout, program, coverage, and evidence identities inside the public bound', () => {
    let project = projectWithCameras()
    const groupId = `g${'x'.repeat(127)}`
    const wideId = `w${'x'.repeat(127)}`
    const closeId = `c${'x'.repeat(127)}`
    const created = planMulticamEditorAction(project, 'multicam.create', {
      projectId: project.id,
      expectedRevision: 0,
      groupId,
      name: 'Bounded identities',
      referenceMemberId: wideId,
      members: [
        { id: wideId, assetId: 'wide-asset', memberLabel: 'Wide', angleLabel: 'Wide' },
        { id: closeId, assetId: 'close-asset', memberLabel: 'Close', angleLabel: 'Close' }
      ]
    })
    project = applyTimelineOperations(project, created.operations).project
    const group = project.multicamGroups![0]!
    expect([
      group.layouts[0]!.id,
      group.programFragments[0]!.id,
      ...group.members.flatMap(({ coverage }) => coverage.map(({ id }) => id))
    ].every((id) => id.length <= 128)).toBe(true)

    const synchronized = planMulticamEditorAction(project, 'multicam.sync-confirm', {
      projectId: project.id,
      expectedRevision: 0,
      groupId,
      memberId: closeId,
      offsetFrames: 0,
      status: 'verified',
      confidence: 0.95
    })
    const next = applyTimelineOperations(project, synchronized.operations).project.multicamGroups![0]!
    expect(next.members[1]!.sync.evidence.flatMap(({ id, analysisId }) => [id, analysisId])
      .every((id) => id.length <= 128)).toBe(true)
  })
})
