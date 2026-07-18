import { describe, expect, it } from 'vitest'
import {
  MULTICAM_LIMITS,
  applyMulticamTransactionPreview,
  compileMulticamPlanTransaction,
  evaluateMulticamCoverage,
  invertMulticamPlanTransaction,
  multicamProgramDigest,
  planMulticamAngleSwitch,
  planMulticamLayout,
  planMulticamMerge,
  validateMulticamGroup,
  type MulticamGroup,
  type MulticamMember,
  type MulticamProgramFragment
} from '../src/engine/multicam.js'

const fps = { numerator: 60_000, denominator: 2_002 }

function referenceMember(): MulticamMember {
  return {
    id: 'member-reference',
    assetId: 'asset-reference',
    memberLabel: 'Reference camera',
    angleLabel: 'Wide',
    sourceFps: fps,
    sync: {
      status: 'reference',
      offsetFrames: 0,
      confidence: 1,
      evidence: []
    },
    coverage: [{
      id: 'coverage-reference',
      startFrame: 0,
      endFrame: 300,
      sourceStartFrame: 0,
      sourceEndFrame: 300
    }]
  }
}

function verifiedMember(input: {
  id: string
  assetId: string
  angleLabel: string
  offsetFrames: number
  endFrame: number
  confidence?: number
}): MulticamMember {
  const confidence = input.confidence ?? 0.94
  return {
    id: input.id,
    assetId: input.assetId,
    memberLabel: `${input.angleLabel} camera`,
    angleLabel: input.angleLabel,
    sourceFps: fps,
    sync: {
      status: 'verified',
      offsetFrames: input.offsetFrames,
      confidence,
      evidence: [{
        id: `evidence-${input.id}`,
        analysisId: `analysis-${input.id}`,
        kind: 'audio-correlation',
        referenceMemberId: 'member-reference',
        targetMemberId: input.id,
        confidence: Math.min(1, confidence + 0.02),
        algorithmId: 'kun.audio-correlation',
        algorithmVersion: '1.0.0'
      }]
    },
    coverage: [{
      id: `coverage-${input.id}`,
      startFrame: input.offsetFrames,
      endFrame: input.endFrame,
      sourceStartFrame: 0,
      sourceEndFrame: input.endFrame - input.offsetFrames
    }]
  }
}

function makeGroup(): MulticamGroup {
  return {
    schemaVersion: 1,
    id: 'multicam-interview',
    sequenceId: 'sequence-main',
    name: 'Interview multicam',
    fps,
    durationFrames: 300,
    referenceMemberId: 'member-reference',
    members: [
      referenceMember(),
      verifiedMember({
        id: 'member-close',
        assetId: 'asset-close',
        angleLabel: 'Close',
        offsetFrames: 30,
        endFrame: 240
      }),
      verifiedMember({
        id: 'member-side',
        assetId: 'asset-side',
        angleLabel: 'Side',
        offsetFrames: 60,
        endFrame: 260,
        confidence: 0.91
      })
    ],
    layouts: [{
      id: 'layout-split',
      label: 'Split screen',
      slots: [
        {
          memberId: 'member-close',
          x: 0,
          y: 0,
          width: 0.5,
          height: 1,
          zIndex: 0,
          opacity: 1,
          audioEnabled: true
        },
        {
          memberId: 'member-side',
          x: 0.5,
          y: 0,
          width: 0.5,
          height: 1,
          zIndex: 1,
          opacity: 1,
          audioEnabled: false
        }
      ]
    }],
    programFragments: [{
      id: 'program-reference',
      startFrame: 0,
      endFrame: 300,
      selection: { kind: 'angle', memberId: 'member-reference' }
    }]
  }
}

function fragment(
  id: string,
  startFrame: number,
  endFrame: number,
  memberId: string
): MulticamProgramFragment {
  return {
    id,
    startFrame,
    endFrame,
    selection: { kind: 'angle', memberId }
  }
}

describe('bounded source-preserving multicam domain', () => {
  it('normalizes rational frame rates, stable identities, labels, and exact source coverage', () => {
    const input = makeGroup() as MulticamGroup & { rawPath?: string }
    input.rawPath = '/Users/private/interview.mov'
    const group = validateMulticamGroup(input)

    expect(group.fps).toEqual({ numerator: 30_000, denominator: 1_001 })
    expect(group.members.every(({ sourceFps }) =>
      sourceFps.numerator === 30_000 && sourceFps.denominator === 1_001
    )).toBe(true)
    expect(group).not.toHaveProperty('rawPath')
    expect(Object.isFrozen(group)).toBe(true)
    expect(Object.isFrozen(group.members[0]!.coverage)).toBe(true)

    const duplicateAngle = makeGroup()
    duplicateAngle.members[2]!.angleLabel = 'close'
    expect(() => validateMulticamGroup(duplicateAngle)).toThrow(/Duplicate angle label/u)

    const mismatchedCoverage = makeGroup()
    mismatchedCoverage.members[1]!.coverage[0]!.sourceEndFrame += 1
    expect(() => validateMulticamGroup(mismatchedCoverage)).toThrow(/coverage and sync offset disagree/iu)

    const pathLike = makeGroup()
    pathLike.members[1]!.angleLabel = '/Users/private/Camera B.mov'
    expect(() => validateMulticamGroup(pathLike)).toThrow(/external locator/u)
    pathLike.members[1]!.angleLabel = 'Close'
    pathLike.members[1]!.assetId = 'file:///Users/private/Camera-B.mov'
    expect(() => validateMulticamGroup(pathLike)).toThrow(/path-like/u)
  })

  it('plans a deterministic full-coverage angle switch and resolves bounded source frames', () => {
    const group = makeGroup()
    const input = {
      group,
      memberId: 'member-close',
      requestedRange: { startFrame: 60, endFrame: 180 },
      coveragePolicy: 'reject' as const
    }
    const plan = planMulticamAngleSwitch(input)
    const repeated = planMulticamAngleSwitch(input)

    expect(repeated).toEqual(plan)
    expect(plan).toMatchObject({
      kind: 'switch-angle',
      outcome: 'ready',
      appliedRanges: [{ startFrame: 60, endFrame: 180 }],
      uncoveredRanges: [],
      syncEvidence: [{
        memberId: 'member-close',
        angleLabel: 'Close',
        status: 'verified',
        offsetFrames: 30,
        confidence: 0.94,
        evidenceIds: ['evidence-member-close']
      }],
      sourceSlices: [{
        memberId: 'member-close',
        assetId: 'asset-close',
        startFrame: 60,
        endFrame: 180,
        sourceStartFrame: 30,
        sourceEndFrame: 150,
        sourceFps: { numerator: 30_000, denominator: 1_001 }
      }]
    })
    expect(plan.afterProgram.map(({ startFrame, endFrame, selection }) => ({
      startFrame,
      endFrame,
      selection
    }))).toEqual([
      { startFrame: 0, endFrame: 60, selection: { kind: 'angle', memberId: 'member-reference' } },
      { startFrame: 60, endFrame: 180, selection: { kind: 'angle', memberId: 'member-close' } },
      { startFrame: 180, endFrame: 300, selection: { kind: 'angle', memberId: 'member-reference' } }
    ])
    expect(group.programFragments).toEqual([expect.objectContaining({ id: 'program-reference' })])
  })

  it('compiles one revision-bound atomic transaction with compact receipt evidence', () => {
    const group = makeGroup()
    const plan = planMulticamAngleSwitch({
      group,
      memberId: 'member-close',
      requestedRange: { startFrame: 60, endFrame: 180 }
    })
    const transaction = compileMulticamPlanTransaction({
      projectId: 'project-interview',
      expectedRevision: 7,
      group,
      plan
    })

    expect(transaction).toMatchObject({
      projectId: 'project-interview',
      sequenceId: 'sequence-main',
      groupId: 'multicam-interview',
      expectedRevision: 7,
      expectedProgramDigest: multicamProgramDigest(group.programFragments),
      nextProgramDigest: plan.afterProgramDigest,
      receiptEvidence: {
        planId: plan.id,
        createdFragmentIds: expect.any(Array),
        removedFragmentIds: ['program-reference'],
        sync: [{ evidenceIds: ['evidence-member-close'] }],
        sourceSlices: [expect.objectContaining({
          memberId: 'member-close',
          sourceStartFrame: 30,
          sourceEndFrame: 150
        })],
        truncated: { appliedRanges: 0, uncoveredRanges: 0, sourceSlices: 0 }
      }
    })
    expect(transaction.operations).toHaveLength(4)
    expect(transaction.inverseOperations).toHaveLength(4)
    expect(JSON.stringify(transaction)).not.toMatch(/(?:\/Users\/|file:\/\/|https?:\/\/)/u)

    const applied = applyMulticamTransactionPreview({
      projectId: 'project-interview',
      sequenceId: 'sequence-main',
      currentRevision: 7,
      group,
      transaction
    })
    expect(applied.group.programFragments).toEqual(plan.afterProgram)
    expect(multicamProgramDigest(applied.group.programFragments)).toBe(transaction.nextProgramDigest)
    const undone = applyMulticamTransactionPreview({
      projectId: 'project-interview',
      sequenceId: 'sequence-main',
      currentRevision: 8,
      group: applied.group as MulticamGroup,
      transaction: invertMulticamPlanTransaction(transaction, 8)
    })
    expect(undone.group.programFragments).toEqual(validateMulticamGroup(group).programFragments)
    expect(group.programFragments).toEqual([expect.objectContaining({ id: 'program-reference' })])
    expect(() => applyMulticamTransactionPreview({
      projectId: 'project-interview',
      sequenceId: 'sequence-main',
      currentRevision: 8,
      group,
      transaction
    })).toThrow(/revision is stale/u)
  })

  it('reports partial source coverage and supports explicit clamp or safe refusal', () => {
    const group = makeGroup()
    const report = evaluateMulticamCoverage(
      group,
      { kind: 'angle', memberId: 'member-close' },
      { startFrame: 0, endFrame: 300 }
    )
    expect(report).toMatchObject({
      coveredRanges: [{ startFrame: 30, endFrame: 240 }],
      uncoveredRanges: [
        { startFrame: 0, endFrame: 30 },
        { startFrame: 240, endFrame: 300 }
      ],
      limitingMemberIds: ['member-close'],
      sourceSlices: [{
        memberId: 'member-close',
        startFrame: 30,
        endFrame: 240,
        sourceStartFrame: 0,
        sourceEndFrame: 210
      }]
    })

    const refused = planMulticamAngleSwitch({
      group,
      memberId: 'member-close',
      requestedRange: { startFrame: 0, endFrame: 300 },
      coveragePolicy: 'reject'
    })
    expect(refused).toMatchObject({
      outcome: 'refused',
      appliedRanges: [],
      afterProgramDigest: refused.beforeProgramDigest,
      refusal: { code: 'coverage-incomplete', memberIds: ['member-close'] }
    })
    expect(() => compileMulticamPlanTransaction({
      projectId: 'project-interview', expectedRevision: 0, group, plan: refused
    })).toThrow(/refused multicam plan/u)

    const clamped = planMulticamAngleSwitch({
      group,
      memberId: 'member-close',
      requestedRange: { startFrame: 0, endFrame: 300 },
      coveragePolicy: 'clamp'
    })
    expect(clamped).toMatchObject({
      outcome: 'ready',
      appliedRanges: [{ startFrame: 30, endFrame: 240 }],
      uncoveredRanges: [
        { startFrame: 0, endFrame: 30 },
        { startFrame: 240, endFrame: 300 }
      ],
      warnings: [{ code: 'partial-coverage-clamped', memberId: 'member-close' }]
    })

    const absent = planMulticamAngleSwitch({
      group,
      memberId: 'member-close',
      requestedRange: { startFrame: 250, endFrame: 280 },
      coveragePolicy: 'clamp'
    })
    expect(absent).toMatchObject({ outcome: 'refused', refusal: { code: 'angle-not-recording' } })
  })

  it('never creates operations for unknown, uncertain, or low-confidence synchronization', () => {
    const unknown = makeGroup()
    unknown.members[1]!.sync = { status: 'unknown', offsetFrames: 30, evidence: [] }
    expect(planMulticamAngleSwitch({
      group: unknown,
      memberId: 'member-close',
      requestedRange: { startFrame: 60, endFrame: 120 }
    })).toMatchObject({
      outcome: 'refused',
      refusal: { code: 'sync-evidence-unavailable', memberIds: ['member-close'] }
    })

    const uncertain = makeGroup()
    uncertain.members[1]!.sync.status = 'uncertain'
    expect(planMulticamAngleSwitch({
      group: uncertain,
      memberId: 'member-close',
      requestedRange: { startFrame: 60, endFrame: 120 }
    })).toMatchObject({ outcome: 'refused', refusal: { code: 'sync-evidence-uncertain' } })

    const lowConfidence = makeGroup()
    lowConfidence.members[1]!.sync.confidence = 0.7
    expect(planMulticamAngleSwitch({
      group: lowConfidence,
      memberId: 'member-close',
      requestedRange: { startFrame: 60, endFrame: 120 },
      minimumSyncConfidence: 0.82
    })).toMatchObject({
      outcome: 'refused',
      refusal: { code: 'sync-confidence-below-threshold' },
      syncEvidence: [{ confidence: 0.7 }]
    })
  })

  it('intersects every angle for a layout and exposes exact source slices per member', () => {
    const group = makeGroup()
    const refused = planMulticamLayout({
      group,
      layoutId: 'layout-split',
      requestedRange: { startFrame: 40, endFrame: 260 },
      coveragePolicy: 'reject'
    })
    expect(refused).toMatchObject({
      outcome: 'refused',
      refusal: { code: 'coverage-incomplete', memberIds: ['member-close', 'member-side'] }
    })

    const plan = planMulticamLayout({
      group,
      layoutId: 'layout-split',
      requestedRange: { startFrame: 40, endFrame: 260 },
      coveragePolicy: 'clamp'
    })
    expect(plan).toMatchObject({
      outcome: 'ready',
      selection: { kind: 'layout', layoutId: 'layout-split' },
      appliedRanges: [{ startFrame: 60, endFrame: 240 }],
      uncoveredRanges: [
        { startFrame: 40, endFrame: 60 },
        { startFrame: 240, endFrame: 260 }
      ],
      sourceSlices: [
        expect.objectContaining({
          memberId: 'member-close',
          startFrame: 60,
          endFrame: 240,
          sourceStartFrame: 30,
          sourceEndFrame: 210
        }),
        expect.objectContaining({
          memberId: 'member-side',
          startFrame: 60,
          endFrame: 240,
          sourceStartFrame: 0,
          sourceEndFrame: 180
        })
      ]
    })
    expect(plan.sourceSlices.every(({ sourceStartFrame, sourceEndFrame }) =>
      sourceStartFrame >= 0 && sourceEndFrame > sourceStartFrame
    )).toBe(true)
  })

  it('merges only adjacent identical selections and compiles the resulting program diff', () => {
    const group = makeGroup()
    group.programFragments = [
      fragment('ref-1', 0, 30, 'member-reference'),
      fragment('ref-2', 30, 60, 'member-reference'),
      fragment('close-1', 60, 90, 'member-close'),
      fragment('close-2', 90, 120, 'member-close')
    ]
    const plan = planMulticamMerge(group)
    const repeated = planMulticamMerge(group)

    expect(repeated).toEqual(plan)
    expect(plan).toMatchObject({
      outcome: 'ready',
      warnings: [{ code: 'adjacent-fragments-merged', count: 2 }]
    })
    expect(plan.afterProgram).toHaveLength(2)
    expect(plan.afterProgram.map(({ startFrame, endFrame, selection }) => ({
      startFrame, endFrame, selection
    }))).toEqual([
      { startFrame: 0, endFrame: 60, selection: { kind: 'angle', memberId: 'member-reference' } },
      { startFrame: 60, endFrame: 120, selection: { kind: 'angle', memberId: 'member-close' } }
    ])
    const transaction = compileMulticamPlanTransaction({
      projectId: 'project-interview', expectedRevision: 3, group, plan
    })
    expect(transaction.operations).toHaveLength(6)
    expect(applyMulticamTransactionPreview({
      projectId: 'project-interview',
      sequenceId: 'sequence-main',
      currentRevision: 3,
      group,
      transaction
    }).group.programFragments).toEqual(plan.afterProgram)
  })

  it('refuses unsafe frame inputs and plans that exceed one bounded command transaction', () => {
    expect(() => planMulticamAngleSwitch({
      group: makeGroup(),
      memberId: 'member-close',
      requestedRange: { startFrame: 10.5, endFrame: 30 }
    })).toThrow(/safe integer|must be an integer/u)

    const group = makeGroup()
    group.programFragments = [
      fragment('prefix', 0, 30, 'member-reference'),
      ...Array.from({ length: 201 }, (_, index) => fragment(
        `fragment-${index}`,
        30 + index,
        31 + index,
        index % 2 === 0 ? 'member-reference' : 'member-close'
      ))
    ]
    const plan = planMulticamAngleSwitch({
      group,
      memberId: 'member-close',
      requestedRange: { startFrame: 30, endFrame: 231 }
    })
    expect(plan.outcome).toBe('ready')
    expect(() => compileMulticamPlanTransaction({
      projectId: 'project-interview', expectedRevision: 4, group, plan
    })).toThrow(new RegExp(`bounded transaction limit is ${MULTICAM_LIMITS.operationsPerTransaction}`))
  })

  it('fences stale program digests without mutating either source snapshot', () => {
    const group = makeGroup()
    const plan = planMulticamAngleSwitch({
      group,
      memberId: 'member-close',
      requestedRange: { startFrame: 60, endFrame: 120 }
    })
    const transaction = compileMulticamPlanTransaction({
      projectId: 'project-interview', expectedRevision: 2, group, plan
    })
    const changed = makeGroup()
    changed.programFragments = [
      fragment('manual-ref', 0, 120, 'member-reference'),
      fragment('manual-close', 120, 180, 'member-close'),
      fragment('manual-ref-tail', 180, 300, 'member-reference')
    ]
    const before = structuredClone(changed)

    expect(() => applyMulticamTransactionPreview({
      projectId: 'project-interview',
      sequenceId: 'sequence-main',
      currentRevision: 2,
      group: changed,
      transaction
    })).toThrow(/program digest is stale/u)
    expect(changed).toEqual(before)
    expect(group.programFragments).toEqual([expect.objectContaining({ id: 'program-reference' })])
  })
})
