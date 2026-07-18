import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ProjectService,
  TimelineOperationSchema,
  VideoProjectSchema,
  applyTimelineOperations,
  compileMulticamProgramIr,
  generateMulticamRenderPlan,
  multicamProgramDigest,
  type MediaAsset,
  type MulticamGroup,
  type VideoProject
} from '../src/engine/index.js'
import { makeProject } from './fixtures.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function cameraAsset(id: string, name: string): MediaAsset {
  return {
    id,
    name,
    kind: 'video',
    mediaHandleId: `media_${id.replaceAll('-', '_')}_opaque`,
    durationUs: 10_000_000,
    container: 'mp4',
    video: {
      codec: 'h264',
      width: 1920,
      height: 1080,
      frameRate: { numerator: 30, denominator: 1 }
    },
    audio: { codec: 'aac', sampleRate: 48_000, channels: 2 },
    transcriptIds: []
  }
}

function durableGroup(): MulticamGroup {
  return {
    schemaVersion: 1,
    id: 'multicam-main',
    sequenceId: 'sequence-main',
    name: 'Interview cameras',
    fps: { numerator: 30, denominator: 1 },
    durationFrames: 300,
    referenceMemberId: 'camera-wide',
    members: [
      {
        id: 'camera-wide',
        assetId: 'camera-wide-asset',
        memberLabel: 'Reference camera',
        angleLabel: 'Wide',
        sourceFps: { numerator: 30, denominator: 1 },
        sync: { status: 'reference', offsetFrames: 0, confidence: 1, evidence: [] },
        coverage: [{
          id: 'coverage-wide',
          startFrame: 0,
          endFrame: 300,
          sourceStartFrame: 0,
          sourceEndFrame: 300
        }]
      },
      {
        id: 'camera-close',
        assetId: 'camera-close-asset',
        memberLabel: 'Close camera',
        angleLabel: 'Close',
        sourceFps: { numerator: 30, denominator: 1 },
        sync: {
          status: 'verified',
          offsetFrames: 0,
          confidence: 1,
          evidence: [{
            id: 'manual-sync-close',
            analysisId: 'manual-confirmation-close',
            kind: 'manual-confirmation',
            referenceMemberId: 'camera-wide',
            targetMemberId: 'camera-close',
            confidence: 1,
            algorithmId: 'kun.manual-sync',
            algorithmVersion: '1.0.0'
          }]
        },
        coverage: [{
          id: 'coverage-close',
          startFrame: 0,
          endFrame: 300,
          sourceStartFrame: 0,
          sourceEndFrame: 300
        }]
      }
    ],
    layouts: [{
      id: 'layout-split',
      label: 'Split screen',
      slots: [
        {
          memberId: 'camera-wide', x: 0, y: 0, width: 0.5, height: 1,
          zIndex: 0, opacity: 1, audioEnabled: true
        },
        {
          memberId: 'camera-close', x: 0.5, y: 0, width: 0.5, height: 1,
          zIndex: 1, opacity: 1, audioEnabled: false
        }
      ]
    }],
    programFragments: [{
      id: 'program-wide',
      startFrame: 0,
      endFrame: 300,
      selection: { kind: 'angle', memberId: 'camera-wide' }
    }]
  }
}

describe('multicam project integration', () => {
  it('keeps pre-multicam schema-v2 projects compatible and rejects path-bearing group fields', () => {
    const legacyV2 = makeProject() as VideoProject & { multicamGroups?: MulticamGroup[] }
    delete legacyV2.multicamGroups
    expect(VideoProjectSchema.parse(legacyV2).multicamGroups).toBeUndefined()

    const injected = { ...durableGroup(), rawPath: '/Users/private/camera.mov' }
    expect(TimelineOperationSchema.safeParse({
      type: 'set-multicam-group',
      group: injected
    })).toMatchObject({ success: false })
  })

  it('atomically persists, fences, reloads, receipts, and undoes a multicam program switch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-video-multicam-'))
    roots.push(root)
    const firstService = new ProjectService(root, { now: () => new Date('2026-07-14T01:00:00.000Z') })
    const created = await firstService.createProject({ id: 'multicam-project', name: 'Multicam' })
    const withAssets = structuredClone(created)
    withAssets.assets.push(
      cameraAsset('camera-wide-asset', 'Wide.mp4'),
      cameraAsset('camera-close-asset', 'Close.mp4')
    )
    const assetsSaved = await firstService.saveProjectWithReceipt(withAssets, 0, {
      author: 'manual',
      sourceOperation: 'test.add-cameras',
      summary: 'Added camera grants'
    })
    const groupSaved = await firstService.applyOperationsWithReceipt(
      'multicam-project',
      assetsSaved.project.currentRevision,
      [{ type: 'set-multicam-group', group: durableGroup() }],
      {
        author: 'manual',
        sourceOperation: 'multicam.create',
        summary: 'Created multicam group'
      }
    )
    expect(groupSaved.receipt).toMatchObject({
      previousRevision: 1,
      newRevision: 2,
      createdIds: expect.arrayContaining([
        { kind: 'multicam-group', id: 'multicam-main' },
        { kind: 'multicam-fragment', id: 'program-wide' }
      ])
    })

    const switched = await firstService.applyOperationsWithReceipt(
      'multicam-project',
      2,
      [{
        type: 'switch-multicam-angle',
        groupId: 'multicam-main',
        memberId: 'camera-close',
        startFrame: 90,
        endFrame: 180,
        coveragePolicy: 'reject'
      }],
      {
        author: 'agent',
        actorId: 'kun-agent',
        sourceOperation: 'multicam.switch-angle',
        summary: 'Switched to close angle'
      }
    )
    const switchedGroup = switched.project.multicamGroups?.[0]
    expect(switchedGroup?.programFragments.map(({ startFrame, endFrame, selection }) => ({
      startFrame,
      endFrame,
      selection
    }))).toEqual([
      { startFrame: 0, endFrame: 90, selection: { kind: 'angle', memberId: 'camera-wide' } },
      { startFrame: 90, endFrame: 180, selection: { kind: 'angle', memberId: 'camera-close' } },
      { startFrame: 180, endFrame: 300, selection: { kind: 'angle', memberId: 'camera-wide' } }
    ])
    expect(switched.receipt).toMatchObject({
      previousRevision: 2,
      newRevision: 3,
      proofInvalidated: true,
      notes: expect.arrayContaining([expect.objectContaining({
        code: 'multicam_switch_angle',
        values: expect.objectContaining({ uncoveredRangeCount: 0 })
      })])
    })
    expect(JSON.stringify(switched)).not.toMatch(/(?:\/Users\/|file:\/\/|https?:\/\/)/u)

    const restarted = new ProjectService(root)
    const reloaded = await restarted.loadProject('multicam-project')
    expect(multicamProgramDigest(reloaded.multicamGroups?.[0]?.programFragments ?? []))
      .toBe(multicamProgramDigest(switchedGroup?.programFragments ?? []))
    await expect(restarted.applyOperationsWithReceipt(
      'multicam-project',
      2,
      [{ type: 'merge-multicam-program', groupId: 'multicam-main' }],
      {
        author: 'agent', actorId: 'kun-agent', sourceOperation: 'multicam.merge', summary: 'Stale merge'
      }
    )).rejects.toMatchObject({ code: 'revision_conflict' })

    const undone = await restarted.undoWithReceipt('multicam-project', 3)
    expect(undone.project.multicamGroups?.[0]?.programFragments).toEqual(durableGroup().programFragments)
    expect(undone.project.currentRevision).toBe(4)
  })

  it('compiles angle and layout fragments through canonical Render IR and the standard FFmpeg planner', () => {
    const project = makeProject()
    project.assets = [
      cameraAsset('camera-wide-asset', 'Wide.mp4'),
      cameraAsset('camera-close-asset', 'Close.mp4')
    ]
    project.transcripts = []
    project.items = []
    project.captions = []
    project.sequences[0]!.items = []
    project.sequences[0]!.captions = []
    project.multicamGroups = [durableGroup()]

    const switched = applyTimelineOperations(project, [{
      type: 'switch-multicam-angle',
      groupId: 'multicam-main',
      memberId: 'camera-close',
      startFrame: 60,
      endFrame: 120
    }]).project
    const angleIr = compileMulticamProgramIr(switched, 'multicam-main')
    expect(angleIr).toMatchObject({
      projectId: project.id,
      sequenceId: 'sequence-main',
      revision: 0,
      range: { startFrame: 0, endFrame: 300 }
    })
    expect(angleIr.layers).toHaveLength(3)
    expect(angleIr.layers[1]).toMatchObject({
      source: { kind: 'asset', sourceId: 'camera-close-asset' },
      timeline: { startFrame: 60, endFrame: 120 },
      sourceMap: { startUs: 2_000_000, endUs: 4_000_000 }
    })

    const laidOut = applyTimelineOperations(switched, [{
      type: 'apply-multicam-layout',
      groupId: 'multicam-main',
      layoutId: 'layout-split',
      startFrame: 120,
      endFrame: 180
    }]).project
    const layoutIr = compileMulticamProgramIr(laidOut, 'multicam-main')
    const layoutLayers = layoutIr.layers.filter(({ timeline }) =>
      timeline.startFrame === 120 && timeline.endFrame === 180
    )
    expect(layoutLayers).toHaveLength(2)
    expect(layoutLayers.map(({ visual, audio }) => ({
      x: visual.transform.x,
      scaleX: visual.transform.scaleX,
      audioEnabled: audio.enabled
    }))).toEqual([
      { x: -480, scaleX: 0.5, audioEnabled: true },
      { x: 480, scaleX: 0.5, audioEnabled: false }
    ])

    const plan = generateMulticamRenderPlan(laidOut, 'multicam-main', {
      kind: 'preview',
      expectedRevision: 0,
      outputHandleId: 'opaque_multicam_preview_output'
    })
    expect(plan.renderIr).toEqual(layoutIr)
    expect(plan.playback.mode).toBe('composed-proof')
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]).toMatchObject({ kind: 'ffmpeg', id: 'preview' })
    expect(JSON.stringify(plan)).toContain('overlay=')
    expect(JSON.stringify(plan)).not.toMatch(/(?:\/Users\/|file:\/\/|https?:\/\/)/u)
  })
})
