import { engineError } from './errors.js'
import type { Rational } from './schema.js'
import { normalizeRational, rescaleFrames } from './time.js'

export const MULTICAM_LIMITS = Object.freeze({
  groupsPerProject: 64,
  membersPerGroup: 32,
  coverageSegmentsPerMember: 256,
  layoutsPerGroup: 32,
  layoutSlots: 16,
  programFragmentsPerGroup: 4_096,
  syncEvidencePerMember: 16,
  operationsPerTransaction: 200,
  receiptRanges: 64,
  receiptSourceSlices: 128,
  idLength: 128,
  labelLength: 96,
  durationFrames: 31_104_000,
  syncOffsetFrames: 31_104_000
} as const)

export const DEFAULT_MULTICAM_SYNC_CONFIDENCE = 0.82

export type MulticamFrameRange = {
  startFrame: number
  endFrame: number
}

export type MulticamSyncEvidence = {
  id: string
  analysisId: string
  kind: 'audio-correlation' | 'timecode' | 'manual-confirmation'
  referenceMemberId: string
  targetMemberId: string
  confidence: number
  algorithmId: string
  algorithmVersion: string
}

export type MulticamMemberSync = {
  status: 'reference' | 'verified' | 'uncertain' | 'unknown'
  /** Offset from the member's source frame zero to the group frame timebase. */
  offsetFrames: number
  confidence?: number
  evidence: MulticamSyncEvidence[]
}

export type MulticamCoverageSegment = {
  id: string
  /** Half-open range on the shared multicam timebase. */
  startFrame: number
  endFrame: number
  /** Half-open source range on sourceFps. */
  sourceStartFrame: number
  sourceEndFrame: number
}

export type MulticamMember = {
  id: string
  assetId: string
  memberLabel: string
  angleLabel: string
  sourceFps: Rational
  sync: MulticamMemberSync
  coverage: MulticamCoverageSegment[]
}

export type MulticamLayoutSlot = {
  memberId: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  opacity: number
  audioEnabled: boolean
}

export type MulticamLayout = {
  id: string
  label: string
  slots: MulticamLayoutSlot[]
}

export type MulticamProgramSelection =
  | { kind: 'angle'; memberId: string }
  | { kind: 'layout'; layoutId: string }

export type MulticamProgramFragment = MulticamFrameRange & {
  id: string
  selection: MulticamProgramSelection
}

export type MulticamGroup = {
  schemaVersion: 1
  id: string
  sequenceId: string
  name: string
  fps: Rational
  durationFrames: number
  referenceMemberId: string
  members: MulticamMember[]
  layouts: MulticamLayout[]
  programFragments: MulticamProgramFragment[]
}

export type MulticamSourceSlice = MulticamFrameRange & {
  id: string
  memberId: string
  assetId: string
  sourceStartFrame: number
  sourceEndFrame: number
  sourceFps: Rational
}

export type MulticamCoverageReport = {
  schemaVersion: 1
  groupId: string
  selection: MulticamProgramSelection
  requestedRange: MulticamFrameRange
  coveredRanges: MulticamFrameRange[]
  uncoveredRanges: MulticamFrameRange[]
  limitingMemberIds: string[]
  sourceSlices: MulticamSourceSlice[]
}

export type MulticamSyncReceiptEvidence = {
  memberId: string
  angleLabel: string
  status: MulticamMemberSync['status']
  offsetFrames: number
  confidence?: number
  evidenceIds: string[]
}

export type MulticamPlanRefusal = {
  code:
    | 'sync-evidence-unavailable'
    | 'sync-evidence-uncertain'
    | 'sync-confidence-below-threshold'
    | 'coverage-incomplete'
    | 'angle-not-recording'
  message: string
  memberIds: string[]
}

export type MulticamPlan = {
  schemaVersion: 1
  id: string
  kind: 'switch-angle' | 'apply-layout' | 'merge-adjacent'
  groupId: string
  sequenceId: string
  fps: Rational
  outcome: 'ready' | 'refused'
  requestedRange: MulticamFrameRange
  selection?: MulticamProgramSelection
  appliedRanges: MulticamFrameRange[]
  uncoveredRanges: MulticamFrameRange[]
  limitingMemberIds: string[]
  syncEvidence: MulticamSyncReceiptEvidence[]
  sourceSlices: MulticamSourceSlice[]
  beforeProgramDigest: string
  afterProgramDigest: string
  beforeProgram: MulticamProgramFragment[]
  afterProgram: MulticamProgramFragment[]
  warnings: Array<{
    code: 'partial-coverage-clamped' | 'adjacent-fragments-merged'
    memberId?: string
    count?: number
  }>
  refusal?: MulticamPlanRefusal
}

export type MulticamTransactionOperation =
  | { type: 'delete-multicam-program-fragment'; groupId: string; fragmentId: string }
  | { type: 'upsert-multicam-program-fragment'; groupId: string; fragment: MulticamProgramFragment }

export type MulticamReceiptEvidence = {
  schemaVersion: 1
  planId: string
  planKind: MulticamPlan['kind']
  groupId: string
  sequenceId: string
  requestedRange: MulticamFrameRange
  appliedRanges: MulticamFrameRange[]
  uncoveredRanges: MulticamFrameRange[]
  limitingAngles: Array<{ memberId: string; angleLabel: string }>
  sync: MulticamSyncReceiptEvidence[]
  sourceSlices: MulticamSourceSlice[]
  createdFragmentIds: string[]
  changedFragmentIds: string[]
  removedFragmentIds: string[]
  previousProgramDigest: string
  nextProgramDigest: string
  truncated: {
    appliedRanges: number
    uncoveredRanges: number
    sourceSlices: number
  }
}

export type MulticamPlanTransaction = {
  schemaVersion: 1
  id: string
  projectId: string
  sequenceId: string
  groupId: string
  expectedRevision: number
  expectedProgramDigest: string
  nextProgramDigest: string
  operations: MulticamTransactionOperation[]
  inverseOperations: MulticamTransactionOperation[]
  receiptEvidence: MulticamReceiptEvidence
}

export function validateMulticamGroup(input: MulticamGroup): Readonly<MulticamGroup> {
  const fps = normalizeRational(input.fps)
  const groupId = identifier(input.id, 'multicam group ID')
  const sequenceId = identifier(input.sequenceId, 'sequence ID')
  const name = label(input.name, 'multicam group name')
  const durationFrames = boundedInteger(
    input.durationFrames,
    1,
    MULTICAM_LIMITS.durationFrames,
    'multicam durationFrames'
  )
  if (input.schemaVersion !== 1) invalid('Unsupported multicam group schema version')
  if (!Array.isArray(input.members) || input.members.length < 2) {
    invalid('A multicam group requires at least two members')
  }
  if (input.members.length > MULTICAM_LIMITS.membersPerGroup) {
    invalid(`A multicam group supports at most ${MULTICAM_LIMITS.membersPerGroup} members`)
  }

  const members = input.members.map((member) => normalizeMember(member, fps, durationFrames))
  unique(members, 'multicam member')
  uniqueCaseInsensitive(members.map(({ angleLabel }) => angleLabel), 'angle label')
  const memberMap = new Map(members.map((member) => [member.id, member]))
  const referenceMemberId = identifier(input.referenceMemberId, 'reference member ID')
  const reference = memberMap.get(referenceMemberId)
  if (!reference) invalid(`Reference multicam member does not exist: ${referenceMemberId}`)
  for (const member of members) validateMemberSync(member, referenceMemberId, memberMap)
  if (reference!.sync.status !== 'reference') {
    invalid('The reference member must use reference synchronization status')
  }
  if (members.filter(({ sync }) => sync.status === 'reference').length !== 1) {
    invalid('A multicam group must contain exactly one reference synchronization member')
  }

  if (!Array.isArray(input.layouts) || input.layouts.length > MULTICAM_LIMITS.layoutsPerGroup) {
    invalid(`A multicam group supports at most ${MULTICAM_LIMITS.layoutsPerGroup} layouts`)
  }
  const layouts = input.layouts.map((layoutValue) => normalizeLayout(layoutValue, memberMap))
  unique(layouts, 'multicam layout')
  const layoutMap = new Map(layouts.map((layoutValue) => [layoutValue.id, layoutValue]))

  if (
    !Array.isArray(input.programFragments) ||
    input.programFragments.length > MULTICAM_LIMITS.programFragmentsPerGroup
  ) {
    invalid(`A multicam program supports at most ${MULTICAM_LIMITS.programFragmentsPerGroup} fragments`)
  }
  const programFragments = input.programFragments
    .map((fragment) => normalizeFragment(fragment, durationFrames, memberMap, layoutMap))
    .sort(compareFragments)
  unique(programFragments, 'multicam program fragment')
  assertNonOverlappingProgram(programFragments)

  const normalized: MulticamGroup = {
    schemaVersion: 1,
    id: groupId,
    sequenceId,
    name,
    fps,
    durationFrames,
    referenceMemberId,
    members,
    layouts,
    programFragments
  }
  for (const fragment of programFragments) {
    const report = evaluateCoverageNormalized(normalized, fragment.selection, fragment)
    if (report.uncoveredRanges.length > 0) {
      invalid(`Multicam program fragment exceeds source coverage: ${fragment.id}`)
    }
    for (const memberId of selectionMemberIds(normalized, fragment.selection)) {
      const status = memberMap.get(memberId)!.sync.status
      if (status === 'unknown' || status === 'uncertain') {
        invalid(`Multicam program fragment uses an unsynchronized member: ${memberId}`)
      }
    }
  }
  return deepFreeze(normalized)
}

export function evaluateMulticamCoverage(
  groupInput: MulticamGroup,
  selectionInput: MulticamProgramSelection,
  requestedRangeInput: MulticamFrameRange
): Readonly<MulticamCoverageReport> {
  const group = validateMulticamGroup(groupInput)
  const selection = normalizeSelection(group, selectionInput)
  const requestedRange = frameRange(requestedRangeInput, group.durationFrames, 'requested range')
  return deepFreeze(evaluateCoverageNormalized(group, selection, requestedRange))
}

export function planMulticamAngleSwitch(input: {
  group: MulticamGroup
  memberId: string
  requestedRange: MulticamFrameRange
  coveragePolicy?: 'reject' | 'clamp'
  minimumSyncConfidence?: number
}): Readonly<MulticamPlan> {
  const group = validateMulticamGroup(input.group)
  const memberId = identifier(input.memberId, 'multicam member ID')
  const member = group.members.find(({ id }) => id === memberId)
  if (!member) invalid(`Multicam member does not exist: ${memberId}`)
  return planSelection({
    group,
    kind: 'switch-angle',
    selection: { kind: 'angle', memberId },
    requestedRange: input.requestedRange,
    coveragePolicy: input.coveragePolicy ?? 'reject',
    minimumSyncConfidence: input.minimumSyncConfidence ?? DEFAULT_MULTICAM_SYNC_CONFIDENCE
  })
}

export function planMulticamLayout(input: {
  group: MulticamGroup
  layoutId: string
  requestedRange: MulticamFrameRange
  coveragePolicy?: 'reject' | 'clamp'
  minimumSyncConfidence?: number
}): Readonly<MulticamPlan> {
  const group = validateMulticamGroup(input.group)
  const layoutId = identifier(input.layoutId, 'multicam layout ID')
  if (!group.layouts.some(({ id }) => id === layoutId)) {
    invalid(`Multicam layout does not exist: ${layoutId}`)
  }
  return planSelection({
    group,
    kind: 'apply-layout',
    selection: { kind: 'layout', layoutId },
    requestedRange: input.requestedRange,
    coveragePolicy: input.coveragePolicy ?? 'reject',
    minimumSyncConfidence: input.minimumSyncConfidence ?? DEFAULT_MULTICAM_SYNC_CONFIDENCE
  })
}

export function planMulticamMerge(groupInput: MulticamGroup): Readonly<MulticamPlan> {
  const group = validateMulticamGroup(groupInput)
  const before = cloneFragments(group.programFragments)
  const after: MulticamProgramFragment[] = []
  let mergedCount = 0
  for (const fragment of before) {
    const previous = after.at(-1)
    if (
      previous &&
      previous.endFrame === fragment.startFrame &&
      selectionEquals(previous.selection, fragment.selection)
    ) {
      after[after.length - 1] = fragmentFor(
        group.id,
        previous.startFrame,
        fragment.endFrame,
        previous.selection
      )
      mergedCount += 1
    } else {
      after.push(fragment)
    }
  }
  const beforeDigest = multicamProgramDigest(before)
  const afterDigest = multicamProgramDigest(after)
  const requestedRange = { startFrame: 0, endFrame: group.durationFrames }
  return deepFreeze({
    schemaVersion: 1,
    id: planId('merge-adjacent', group.id, requestedRange, undefined, beforeDigest, afterDigest),
    kind: 'merge-adjacent',
    groupId: group.id,
    sequenceId: group.sequenceId,
    fps: { ...group.fps },
    outcome: 'ready',
    requestedRange,
    appliedRanges: [],
    uncoveredRanges: [],
    limitingMemberIds: [],
    syncEvidence: [],
    sourceSlices: [],
    beforeProgramDigest: beforeDigest,
    afterProgramDigest: afterDigest,
    beforeProgram: before,
    afterProgram: cloneFragments(after),
    warnings: mergedCount > 0
      ? [{ code: 'adjacent-fragments-merged', count: mergedCount }]
      : []
  })
}

export function compileMulticamPlanTransaction(input: {
  projectId: string
  expectedRevision: number
  group: MulticamGroup
  plan: MulticamPlan
}): Readonly<MulticamPlanTransaction> {
  const projectId = identifier(input.projectId, 'project ID')
  const expectedRevision = boundedInteger(
    input.expectedRevision,
    0,
    Number.MAX_SAFE_INTEGER,
    'expectedRevision'
  )
  const group = validateMulticamGroup(input.group)
  const plan = input.plan
  if (plan.groupId !== group.id || plan.sequenceId !== group.sequenceId) {
    invalid('Multicam plan does not belong to the selected group and sequence')
  }
  if (plan.outcome !== 'ready' || plan.refusal) {
    invalid('A refused multicam plan cannot be compiled into mutation operations')
  }
  const currentDigest = multicamProgramDigest(group.programFragments)
  if (plan.beforeProgramDigest !== currentDigest) {
    throw engineError(
      'revision_conflict',
      'Multicam program changed after planning; refresh before compiling the transaction'
    )
  }

  const beforeById = new Map(plan.beforeProgram.map((fragment) => [fragment.id, fragment]))
  const afterById = new Map(plan.afterProgram.map((fragment) => [fragment.id, fragment]))
  const removedFragmentIds = [...beforeById.keys()]
    .filter((id) => !afterById.has(id))
    .sort()
  const createdFragmentIds = [...afterById.keys()]
    .filter((id) => !beforeById.has(id))
    .sort()
  const changedFragmentIds = [...afterById.keys()]
    .filter((id) => beforeById.has(id) && !fragmentEquals(beforeById.get(id)!, afterById.get(id)!))
    .sort()
  const operations: MulticamTransactionOperation[] = [
    ...removedFragmentIds.map((fragmentId): MulticamTransactionOperation => ({
      type: 'delete-multicam-program-fragment',
      groupId: group.id,
      fragmentId
    })),
    ...[...createdFragmentIds, ...changedFragmentIds].sort().map((fragmentId): MulticamTransactionOperation => ({
      type: 'upsert-multicam-program-fragment',
      groupId: group.id,
      fragment: cloneFragment(afterById.get(fragmentId)!)
    }))
  ]
  const inverseOperations: MulticamTransactionOperation[] = [
    ...createdFragmentIds.map((fragmentId): MulticamTransactionOperation => ({
      type: 'delete-multicam-program-fragment',
      groupId: group.id,
      fragmentId
    })),
    ...[...removedFragmentIds, ...changedFragmentIds].sort().map((fragmentId): MulticamTransactionOperation => ({
      type: 'upsert-multicam-program-fragment',
      groupId: group.id,
      fragment: cloneFragment(beforeById.get(fragmentId)!)
    }))
  ]
  if (operations.length > MULTICAM_LIMITS.operationsPerTransaction) {
    invalid(
      `Multicam plan requires ${operations.length} operations; ` +
      `the bounded transaction limit is ${MULTICAM_LIMITS.operationsPerTransaction}`
    )
  }
  const appliedRanges = boundedCopy(plan.appliedRanges, MULTICAM_LIMITS.receiptRanges)
  const uncoveredRanges = boundedCopy(plan.uncoveredRanges, MULTICAM_LIMITS.receiptRanges)
  const sourceSlices = boundedCopy(plan.sourceSlices, MULTICAM_LIMITS.receiptSourceSlices)
  const receiptEvidence: MulticamReceiptEvidence = {
    schemaVersion: 1,
    planId: plan.id,
    planKind: plan.kind,
    groupId: group.id,
    sequenceId: group.sequenceId,
    requestedRange: { ...plan.requestedRange },
    appliedRanges,
    uncoveredRanges,
    limitingAngles: plan.limitingMemberIds.map((memberId) => ({
      memberId,
      angleLabel: group.members.find(({ id }) => id === memberId)!.angleLabel
    })),
    sync: plan.syncEvidence.map(cloneSyncReceipt),
    sourceSlices,
    createdFragmentIds,
    changedFragmentIds,
    removedFragmentIds,
    previousProgramDigest: currentDigest,
    nextProgramDigest: plan.afterProgramDigest,
    truncated: {
      appliedRanges: Math.max(0, plan.appliedRanges.length - appliedRanges.length),
      uncoveredRanges: Math.max(0, plan.uncoveredRanges.length - uncoveredRanges.length),
      sourceSlices: Math.max(0, plan.sourceSlices.length - sourceSlices.length)
    }
  }
  return deepFreeze({
    schemaVersion: 1,
    id: `multicam-tx:${stableDigest([projectId, expectedRevision, plan.id])}`,
    projectId,
    sequenceId: group.sequenceId,
    groupId: group.id,
    expectedRevision,
    expectedProgramDigest: currentDigest,
    nextProgramDigest: plan.afterProgramDigest,
    operations,
    inverseOperations,
    receiptEvidence
  })
}

export function invertMulticamPlanTransaction(
  transaction: MulticamPlanTransaction,
  expectedRevision: number
): Readonly<MulticamPlanTransaction> {
  const revision = boundedInteger(
    expectedRevision,
    0,
    Number.MAX_SAFE_INTEGER,
    'expectedRevision'
  )
  const receipt = transaction.receiptEvidence
  return deepFreeze({
    schemaVersion: 1,
    id: `multicam-undo-tx:${stableDigest([transaction.id, revision])}`,
    projectId: identifier(transaction.projectId, 'project ID'),
    sequenceId: identifier(transaction.sequenceId, 'sequence ID'),
    groupId: identifier(transaction.groupId, 'multicam group ID'),
    expectedRevision: revision,
    expectedProgramDigest: transaction.nextProgramDigest,
    nextProgramDigest: transaction.expectedProgramDigest,
    operations: transaction.inverseOperations.map(cloneTransactionOperation),
    inverseOperations: transaction.operations.map(cloneTransactionOperation),
    receiptEvidence: {
      ...structuredClone(receipt),
      planId: `undo:${receipt.planId}`,
      createdFragmentIds: [...receipt.removedFragmentIds],
      changedFragmentIds: [...receipt.changedFragmentIds],
      removedFragmentIds: [...receipt.createdFragmentIds],
      previousProgramDigest: receipt.nextProgramDigest,
      nextProgramDigest: receipt.previousProgramDigest
    }
  })
}

/**
 * Applies a compiled transaction to an isolated group snapshot. The project command
 * service remains responsible for the real revision commit and receipt.
 */
export function applyMulticamTransactionPreview(input: {
  projectId: string
  sequenceId: string
  currentRevision: number
  group: MulticamGroup
  transaction: MulticamPlanTransaction
}): Readonly<{ group: Readonly<MulticamGroup>; receiptEvidence: Readonly<MulticamReceiptEvidence> }> {
  const projectId = identifier(input.projectId, 'project ID')
  const sequenceId = identifier(input.sequenceId, 'sequence ID')
  const currentRevision = boundedInteger(
    input.currentRevision,
    0,
    Number.MAX_SAFE_INTEGER,
    'currentRevision'
  )
  const group = validateMulticamGroup(input.group)
  const transaction = input.transaction
  if (
    transaction.projectId !== projectId ||
    transaction.sequenceId !== sequenceId ||
    transaction.groupId !== group.id ||
    group.sequenceId !== sequenceId ||
    transaction.expectedRevision !== currentRevision
  ) {
    throw engineError('revision_conflict', 'Multicam transaction ownership or revision is stale')
  }
  if (transaction.operations.length > MULTICAM_LIMITS.operationsPerTransaction) {
    invalid('Multicam transaction exceeds the bounded operation limit')
  }
  const currentDigest = multicamProgramDigest(group.programFragments)
  if (transaction.expectedProgramDigest !== currentDigest) {
    throw engineError('revision_conflict', 'Multicam program digest is stale')
  }

  const fragments = new Map(group.programFragments.map((fragment) => [fragment.id, cloneFragment(fragment)]))
  for (const operation of transaction.operations) {
    if (operation.groupId !== group.id) invalid('Multicam operation targets another group')
    if (operation.type === 'delete-multicam-program-fragment') {
      if (!fragments.delete(operation.fragmentId)) {
        throw engineError('revision_conflict', `Multicam fragment is no longer available: ${operation.fragmentId}`)
      }
    } else {
      fragments.set(operation.fragment.id, cloneFragment(operation.fragment))
    }
  }
  const next = validateMulticamGroup({
    schemaVersion: 1,
    id: group.id,
    sequenceId: group.sequenceId,
    name: group.name,
    fps: group.fps,
    durationFrames: group.durationFrames,
    referenceMemberId: group.referenceMemberId,
    members: group.members.map(cloneMember),
    layouts: group.layouts.map(cloneLayout),
    programFragments: [...fragments.values()]
  })
  if (multicamProgramDigest(next.programFragments) !== transaction.nextProgramDigest) {
    invalid('Multicam transaction did not produce its declared program digest')
  }
  return deepFreeze({
    group: next,
    receiptEvidence: transaction.receiptEvidence
  })
}

export function multicamProgramDigest(fragments: readonly MulticamProgramFragment[]): string {
  return stableDigest([...fragments]
    .sort(compareFragments)
    .map((fragment) => [
      fragment.id,
      fragment.startFrame,
      fragment.endFrame,
      selectionKey(fragment.selection)
    ]))
}

function planSelection(input: {
  group: Readonly<MulticamGroup>
  kind: 'switch-angle' | 'apply-layout'
  selection: MulticamProgramSelection
  requestedRange: MulticamFrameRange
  coveragePolicy: 'reject' | 'clamp'
  minimumSyncConfidence: number
}): Readonly<MulticamPlan> {
  const { group, kind } = input
  const selection = normalizeSelection(group, input.selection)
  const requestedRange = frameRange(input.requestedRange, group.durationFrames, 'requested range')
  const minimumSyncConfidence = confidence(input.minimumSyncConfidence, 'minimum sync confidence')
  const selectedMembers = selectionMemberIds(group, selection)
    .map((memberId) => group.members.find(({ id }) => id === memberId)!)
  const syncEvidence = selectedMembers.map(syncReceipt)
  const unswitchable = selectedMembers
    .map((member) => ({ member, refusal: syncRefusal(member, minimumSyncConfidence) }))
    .filter((entry): entry is { member: MulticamMember; refusal: MulticamPlanRefusal['code'] } =>
      entry.refusal !== undefined
    )
  const coverage = evaluateCoverageNormalized(group, selection, requestedRange)
  const before = cloneFragments(group.programFragments)
  const beforeDigest = multicamProgramDigest(before)
  if (unswitchable.length > 0) {
    const code = unswitchable[0]!.refusal
    const memberIds = unswitchable.map(({ member }) => member.id).sort()
    return refusedPlan({
      group,
      kind,
      selection,
      requestedRange,
      before,
      beforeDigest,
      coverage,
      syncEvidence,
      refusal: {
        code,
        message: syncRefusalMessage(code, memberIds),
        memberIds
      }
    })
  }
  if (coverage.uncoveredRanges.length > 0 && input.coveragePolicy === 'reject') {
    const code = coverage.coveredRanges.length === 0 ? 'angle-not-recording' : 'coverage-incomplete'
    return refusedPlan({
      group,
      kind,
      selection,
      requestedRange,
      before,
      beforeDigest,
      coverage,
      syncEvidence,
      refusal: {
        code,
        message: 'The selected multicam source does not cover the complete requested range',
        memberIds: coverage.limitingMemberIds
      }
    })
  }
  if (coverage.coveredRanges.length === 0) {
    return refusedPlan({
      group,
      kind,
      selection,
      requestedRange,
      before,
      beforeDigest,
      coverage,
      syncEvidence,
      refusal: {
        code: 'angle-not-recording',
        message: 'The selected multicam source was not recording in the requested range',
        memberIds: coverage.limitingMemberIds
      }
    })
  }

  const after = replaceProgramRanges(group.id, before, coverage.coveredRanges, selection)
  const afterDigest = multicamProgramDigest(after)
  const plan: MulticamPlan = {
    schemaVersion: 1,
    id: planId(kind, group.id, requestedRange, selection, beforeDigest, afterDigest),
    kind,
    groupId: group.id,
    sequenceId: group.sequenceId,
    fps: { ...group.fps },
    outcome: 'ready',
    requestedRange,
    selection,
    appliedRanges: coverage.coveredRanges.map(cloneRange),
    uncoveredRanges: coverage.uncoveredRanges.map(cloneRange),
    limitingMemberIds: [...coverage.limitingMemberIds],
    syncEvidence,
    sourceSlices: coverage.sourceSlices.map(cloneSourceSlice),
    beforeProgramDigest: beforeDigest,
    afterProgramDigest: afterDigest,
    beforeProgram: before,
    afterProgram: after,
    warnings: coverage.uncoveredRanges.length > 0
      ? [{ code: 'partial-coverage-clamped', memberId: coverage.limitingMemberIds[0] }]
      : []
  }
  // Re-validate the complete program before exposing a commit candidate.
  validateMulticamGroup({ ...group, programFragments: cloneFragments(after) })
  return deepFreeze(plan)
}

function refusedPlan(input: {
  group: Readonly<MulticamGroup>
  kind: 'switch-angle' | 'apply-layout'
  selection: MulticamProgramSelection
  requestedRange: MulticamFrameRange
  before: MulticamProgramFragment[]
  beforeDigest: string
  coverage: MulticamCoverageReport
  syncEvidence: MulticamSyncReceiptEvidence[]
  refusal: MulticamPlanRefusal
}): Readonly<MulticamPlan> {
  const plan: MulticamPlan = {
    schemaVersion: 1,
    id: planId(
      input.kind,
      input.group.id,
      input.requestedRange,
      input.selection,
      input.beforeDigest,
      `refused:${input.refusal.code}`
    ),
    kind: input.kind,
    groupId: input.group.id,
    sequenceId: input.group.sequenceId,
    fps: { ...input.group.fps },
    outcome: 'refused',
    requestedRange: cloneRange(input.requestedRange),
    selection: { ...input.selection },
    appliedRanges: [],
    uncoveredRanges: [cloneRange(input.requestedRange)],
    limitingMemberIds: [...new Set(input.refusal.memberIds)].sort(),
    syncEvidence: input.syncEvidence.map(cloneSyncReceipt),
    sourceSlices: [],
    beforeProgramDigest: input.beforeDigest,
    afterProgramDigest: input.beforeDigest,
    beforeProgram: cloneFragments(input.before),
    afterProgram: cloneFragments(input.before),
    warnings: [],
    refusal: {
      ...input.refusal,
      memberIds: [...new Set(input.refusal.memberIds)].sort()
    }
  }
  return deepFreeze(plan)
}

function evaluateCoverageNormalized(
  group: Readonly<MulticamGroup>,
  selection: MulticamProgramSelection,
  requestedRange: MulticamFrameRange
): MulticamCoverageReport {
  const memberIds = selectionMemberIds(group, selection)
  const memberRanges = memberIds.map((memberId) => {
    const member = group.members.find(({ id }) => id === memberId)!
    return normalizeRanges(member.coverage.map(({ startFrame, endFrame }) => ({ startFrame, endFrame })))
  })
  const common = memberRanges.slice(1).reduce(
    (current, ranges) => intersectRangeSets(current, ranges),
    memberRanges[0] ?? []
  )
  const coveredRanges = intersectRangeSets([requestedRange], common)
  const uncoveredRanges = subtractRanges(requestedRange, coveredRanges)
  const limitingMemberIds = memberIds.filter((memberId, index) =>
    subtractRanges(requestedRange, intersectRangeSets([requestedRange], memberRanges[index]!)).length > 0
  ).sort()
  const sourceSlices = resolveSourceSlices(group, memberIds, coveredRanges)
  return {
    schemaVersion: 1,
    groupId: group.id,
    selection: { ...selection },
    requestedRange: cloneRange(requestedRange),
    coveredRanges,
    uncoveredRanges,
    limitingMemberIds,
    sourceSlices
  }
}

function resolveSourceSlices(
  group: Readonly<MulticamGroup>,
  memberIds: readonly string[],
  coveredRanges: readonly MulticamFrameRange[]
): MulticamSourceSlice[] {
  const slices: MulticamSourceSlice[] = []
  for (const memberId of memberIds) {
    const member = group.members.find(({ id }) => id === memberId)!
    for (const range of coveredRanges) {
      for (const segment of member.coverage) {
        const overlap = intersection(range, segment)
        if (!overlap) continue
        const relativeStart = overlap.startFrame - segment.startFrame
        const relativeEnd = overlap.endFrame - segment.startFrame
        const sourceStartFrame = segment.sourceStartFrame + rescaleFrames(
          relativeStart,
          group.fps,
          member.sourceFps
        )
        const sourceEndFrame = segment.sourceStartFrame + rescaleFrames(
          relativeEnd,
          group.fps,
          member.sourceFps
        )
        if (
          sourceStartFrame < segment.sourceStartFrame ||
          sourceEndFrame > segment.sourceEndFrame ||
          sourceEndFrame <= sourceStartFrame
        ) {
          invalid(`Multicam source mapping exceeds coverage for member ${member.id}`)
        }
        slices.push({
          id: `multicam-slice:${stableDigest([
            group.id,
            member.id,
            overlap.startFrame,
            overlap.endFrame,
            sourceStartFrame,
            sourceEndFrame
          ])}`,
          memberId: member.id,
          assetId: member.assetId,
          startFrame: overlap.startFrame,
          endFrame: overlap.endFrame,
          sourceStartFrame,
          sourceEndFrame,
          sourceFps: { ...member.sourceFps }
        })
      }
    }
  }
  return slices.sort((left, right) =>
    left.startFrame - right.startFrame || left.memberId.localeCompare(right.memberId)
  )
}

function normalizeMember(
  input: MulticamMember,
  groupFps: Rational,
  durationFrames: number
): MulticamMember {
  const id = identifier(input.id, 'multicam member ID')
  const sourceFps = normalizeRational(input.sourceFps)
  const sync: MulticamMemberSync = {
    status: syncStatus(input.sync?.status),
    offsetFrames: signedInteger(
      input.sync?.offsetFrames,
      MULTICAM_LIMITS.syncOffsetFrames,
      `sync offset for ${id}`
    ),
    ...(input.sync?.confidence === undefined
      ? {}
      : { confidence: confidence(input.sync.confidence, `sync confidence for ${id}`) }),
    evidence: normalizeSyncEvidence(input.sync?.evidence, id)
  }
  if (
    !Array.isArray(input.coverage) ||
    input.coverage.length === 0 ||
    input.coverage.length > MULTICAM_LIMITS.coverageSegmentsPerMember
  ) {
    invalid(
      `Multicam member ${id} requires 1-${MULTICAM_LIMITS.coverageSegmentsPerMember} coverage segments`
    )
  }
  const coverage = input.coverage.map((segment): MulticamCoverageSegment => {
    const range = frameRange(segment, durationFrames, `coverage for ${id}`)
    const sourceStartFrame = boundedInteger(
      segment.sourceStartFrame,
      0,
      Number.MAX_SAFE_INTEGER,
      `sourceStartFrame for ${id}`
    )
    const sourceEndFrame = boundedInteger(
      segment.sourceEndFrame,
      1,
      Number.MAX_SAFE_INTEGER,
      `sourceEndFrame for ${id}`
    )
    if (sourceEndFrame <= sourceStartFrame) invalid(`Source coverage is empty for member ${id}`)
    const mappedStart = rescaleFrames(sourceStartFrame, sourceFps, groupFps) + sync.offsetFrames
    const mappedEnd = rescaleFrames(sourceEndFrame, sourceFps, groupFps) + sync.offsetFrames
    if (mappedStart !== range.startFrame || mappedEnd !== range.endFrame) {
      invalid(`Coverage and sync offset disagree for multicam member ${id}`)
    }
    return {
      id: identifier(segment.id, `coverage ID for ${id}`),
      ...range,
      sourceStartFrame,
      sourceEndFrame
    }
  }).sort((left, right) => left.startFrame - right.startFrame || left.id.localeCompare(right.id))
  unique(coverage, `coverage segment for ${id}`)
  for (let index = 1; index < coverage.length; index += 1) {
    if (coverage[index]!.startFrame < coverage[index - 1]!.endFrame) {
      invalid(`Coverage segments overlap for multicam member ${id}`)
    }
  }
  return {
    id,
    assetId: identifier(input.assetId, `asset ID for ${id}`),
    memberLabel: label(input.memberLabel, `member label for ${id}`),
    angleLabel: label(input.angleLabel, `angle label for ${id}`),
    sourceFps,
    sync,
    coverage
  }
}

function validateMemberSync(
  member: MulticamMember,
  referenceMemberId: string,
  members: ReadonlyMap<string, MulticamMember>
): void {
  const { sync } = member
  if (member.id === referenceMemberId) {
    if (sync.status !== 'reference' || sync.offsetFrames !== 0 || sync.confidence !== 1) {
      invalid('Reference multicam member requires status reference, zero offset, and confidence 1')
    }
  } else if (sync.status === 'reference') {
    invalid(`Only ${referenceMemberId} may use reference synchronization status`)
  }
  if (sync.status === 'verified' || sync.status === 'uncertain') {
    if (sync.confidence === undefined || sync.evidence.length === 0) {
      invalid(`${sync.status} multicam synchronization requires confidence and evidence`)
    }
    if (!sync.evidence.some(({ confidence: evidenceConfidence }) => evidenceConfidence >= sync.confidence!)) {
      invalid(`Multicam synchronization confidence exceeds all evidence for ${member.id}`)
    }
  }
  if (sync.status === 'unknown' && (sync.confidence !== undefined || sync.evidence.length > 0)) {
    invalid('Unknown multicam synchronization cannot claim confidence or evidence')
  }
  for (const evidence of sync.evidence) {
    if (evidence.referenceMemberId !== referenceMemberId || evidence.targetMemberId !== member.id) {
      invalid(`Synchronization evidence does not identify the member pair for ${member.id}`)
    }
    if (!members.has(evidence.referenceMemberId) || !members.has(evidence.targetMemberId)) {
      invalid(`Synchronization evidence references a missing member for ${member.id}`)
    }
  }
}

function normalizeSyncEvidence(
  input: readonly MulticamSyncEvidence[] | undefined,
  memberId: string
): MulticamSyncEvidence[] {
  if (!Array.isArray(input) || input.length > MULTICAM_LIMITS.syncEvidencePerMember) {
    invalid(
      `Multicam member ${memberId} supports at most ` +
      `${MULTICAM_LIMITS.syncEvidencePerMember} synchronization evidence records`
    )
  }
  const result = input.map((evidence): MulticamSyncEvidence => {
    if (!['audio-correlation', 'timecode', 'manual-confirmation'].includes(evidence.kind)) {
      invalid(`Unknown multicam synchronization evidence kind for ${memberId}`)
    }
    return {
      id: identifier(evidence.id, `sync evidence ID for ${memberId}`),
      analysisId: identifier(evidence.analysisId, `analysis ID for ${memberId}`),
      kind: evidence.kind,
      referenceMemberId: identifier(evidence.referenceMemberId, 'reference member ID'),
      targetMemberId: identifier(evidence.targetMemberId, 'target member ID'),
      confidence: confidence(evidence.confidence, `evidence confidence for ${memberId}`),
      algorithmId: identifier(evidence.algorithmId, `algorithm ID for ${memberId}`),
      algorithmVersion: label(evidence.algorithmVersion, `algorithm version for ${memberId}`)
    }
  })
  unique(result, `sync evidence for ${memberId}`)
  return result
}

function normalizeLayout(
  input: MulticamLayout,
  members: ReadonlyMap<string, MulticamMember>
): MulticamLayout {
  const id = identifier(input.id, 'multicam layout ID')
  if (!Array.isArray(input.slots) || input.slots.length < 2 || input.slots.length > MULTICAM_LIMITS.layoutSlots) {
    invalid(`Multicam layout ${id} requires 2-${MULTICAM_LIMITS.layoutSlots} slots`)
  }
  const slots = input.slots.map((slot): MulticamLayoutSlot => {
    const memberId = identifier(slot.memberId, `layout member ID for ${id}`)
    if (!members.has(memberId)) invalid(`Multicam layout ${id} references missing member ${memberId}`)
    const x = unitInterval(slot.x, `layout x for ${memberId}`)
    const y = unitInterval(slot.y, `layout y for ${memberId}`)
    const width = positiveUnit(slot.width, `layout width for ${memberId}`)
    const height = positiveUnit(slot.height, `layout height for ${memberId}`)
    if (x + width > 1 || y + height > 1) {
      invalid(`Multicam layout slot exceeds the normalized canvas for ${memberId}`)
    }
    return {
      memberId,
      x,
      y,
      width,
      height,
      zIndex: boundedInteger(slot.zIndex, 0, MULTICAM_LIMITS.layoutSlots - 1, 'layout zIndex'),
      opacity: unitInterval(slot.opacity, `layout opacity for ${memberId}`),
      audioEnabled: Boolean(slot.audioEnabled)
    }
  }).sort((left, right) => left.zIndex - right.zIndex || left.memberId.localeCompare(right.memberId))
  if (new Set(slots.map(({ memberId }) => memberId)).size !== slots.length) {
    invalid(`Multicam layout ${id} contains a duplicate member`)
  }
  if (new Set(slots.map(({ zIndex }) => zIndex)).size !== slots.length) {
    invalid(`Multicam layout ${id} contains a duplicate zIndex`)
  }
  return { id, label: label(input.label, `layout label for ${id}`), slots }
}

function normalizeFragment(
  input: MulticamProgramFragment,
  durationFrames: number,
  members: ReadonlyMap<string, MulticamMember>,
  layouts: ReadonlyMap<string, MulticamLayout>
): MulticamProgramFragment {
  const selection = input.selection
  if (selection?.kind === 'angle') {
    const memberId = identifier(selection.memberId, 'program member ID')
    if (!members.has(memberId)) invalid(`Multicam program references missing member ${memberId}`)
    return {
      id: identifier(input.id, 'multicam fragment ID'),
      ...frameRange(input, durationFrames, 'multicam program fragment'),
      selection: { kind: 'angle', memberId }
    }
  }
  if (selection?.kind === 'layout') {
    const layoutId = identifier(selection.layoutId, 'program layout ID')
    if (!layouts.has(layoutId)) invalid(`Multicam program references missing layout ${layoutId}`)
    return {
      id: identifier(input.id, 'multicam fragment ID'),
      ...frameRange(input, durationFrames, 'multicam program fragment'),
      selection: { kind: 'layout', layoutId }
    }
  }
  invalid('Multicam program fragment has an invalid selection')
}

function normalizeSelection(
  group: Readonly<MulticamGroup>,
  selection: MulticamProgramSelection
): MulticamProgramSelection {
  if (selection?.kind === 'angle') {
    const memberId = identifier(selection.memberId, 'multicam member ID')
    if (!group.members.some(({ id }) => id === memberId)) invalid(`Multicam member does not exist: ${memberId}`)
    return { kind: 'angle', memberId }
  }
  if (selection?.kind === 'layout') {
    const layoutId = identifier(selection.layoutId, 'multicam layout ID')
    if (!group.layouts.some(({ id }) => id === layoutId)) invalid(`Multicam layout does not exist: ${layoutId}`)
    return { kind: 'layout', layoutId }
  }
  invalid('Unknown multicam program selection')
}

function selectionMemberIds(
  group: Readonly<MulticamGroup>,
  selection: MulticamProgramSelection
): string[] {
  if (selection.kind === 'angle') return [selection.memberId]
  const layout = group.layouts.find(({ id }) => id === selection.layoutId)
  if (!layout) invalid(`Multicam layout does not exist: ${selection.layoutId}`)
  return layout!.slots.map(({ memberId }) => memberId).sort()
}

function replaceProgramRanges(
  groupId: string,
  program: readonly MulticamProgramFragment[],
  replacementRanges: readonly MulticamFrameRange[],
  selection: MulticamProgramSelection
): MulticamProgramFragment[] {
  const ranges = normalizeRanges(replacementRanges)
  const result: MulticamProgramFragment[] = []
  for (const fragment of program) {
    if (!ranges.some((range) => overlaps(fragment, range))) {
      result.push(cloneFragment(fragment))
      continue
    }
    for (const remainder of subtractRanges(fragment, ranges)) {
      result.push(fragmentFor(groupId, remainder.startFrame, remainder.endFrame, fragment.selection))
    }
  }
  for (const range of ranges) {
    result.push(fragmentFor(groupId, range.startFrame, range.endFrame, selection))
  }
  const sorted = result.sort(compareFragments)
  assertNonOverlappingProgram(sorted)
  if (sorted.length > MULTICAM_LIMITS.programFragmentsPerGroup) {
    invalid('Multicam plan exceeds the bounded program fragment limit')
  }
  return sorted
}

function fragmentFor(
  groupId: string,
  startFrame: number,
  endFrame: number,
  selection: MulticamProgramSelection
): MulticamProgramFragment {
  return {
    // Program fragments are persisted as project entities and therefore use
    // the same colon-free stable-ID alphabet as other project records.
    id: `multicam-fragment-${stableDigest([groupId, startFrame, endFrame, selectionKey(selection)])}`,
    startFrame,
    endFrame,
    selection: { ...selection }
  }
}

function syncRefusal(
  member: Readonly<MulticamMember>,
  minimumConfidence: number
): MulticamPlanRefusal['code'] | undefined {
  if (member.sync.status === 'reference') return undefined
  if (member.sync.status === 'unknown') return 'sync-evidence-unavailable'
  if (member.sync.status === 'uncertain') return 'sync-evidence-uncertain'
  if ((member.sync.confidence ?? 0) < minimumConfidence) return 'sync-confidence-below-threshold'
  return undefined
}

function syncRefusalMessage(code: MulticamPlanRefusal['code'], memberIds: readonly string[]): string {
  const suffix = memberIds.join(', ')
  if (code === 'sync-evidence-unavailable') return `Synchronization evidence is unavailable for: ${suffix}`
  if (code === 'sync-evidence-uncertain') return `Synchronization evidence is uncertain for: ${suffix}`
  return `Synchronization confidence is below the requested threshold for: ${suffix}`
}

function syncReceipt(member: Readonly<MulticamMember>): MulticamSyncReceiptEvidence {
  return {
    memberId: member.id,
    angleLabel: member.angleLabel,
    status: member.sync.status,
    offsetFrames: member.sync.offsetFrames,
    ...(member.sync.confidence === undefined ? {} : { confidence: member.sync.confidence }),
    evidenceIds: member.sync.evidence.map(({ id }) => id).sort()
  }
}

function cloneSyncReceipt(value: MulticamSyncReceiptEvidence): MulticamSyncReceiptEvidence {
  return { ...value, evidenceIds: [...value.evidenceIds] }
}

function normalizeRanges(input: readonly MulticamFrameRange[]): MulticamFrameRange[] {
  const sorted = input.map(cloneRange).sort((left, right) => left.startFrame - right.startFrame)
  const result: MulticamFrameRange[] = []
  for (const range of sorted) {
    const previous = result.at(-1)
    if (previous && range.startFrame <= previous.endFrame) {
      previous.endFrame = Math.max(previous.endFrame, range.endFrame)
    } else {
      result.push(range)
    }
  }
  return result
}

function intersectRangeSets(
  leftInput: readonly MulticamFrameRange[],
  rightInput: readonly MulticamFrameRange[]
): MulticamFrameRange[] {
  const left = normalizeRanges(leftInput)
  const right = normalizeRanges(rightInput)
  const result: MulticamFrameRange[] = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    const overlap = intersection(left[leftIndex]!, right[rightIndex]!)
    if (overlap) result.push(overlap)
    if (left[leftIndex]!.endFrame <= right[rightIndex]!.endFrame) leftIndex += 1
    else rightIndex += 1
  }
  return normalizeRanges(result)
}

function subtractRanges(
  range: MulticamFrameRange,
  removalsInput: readonly MulticamFrameRange[]
): MulticamFrameRange[] {
  const removals = normalizeRanges(removalsInput).filter((candidate) => overlaps(range, candidate))
  const result: MulticamFrameRange[] = []
  let cursor = range.startFrame
  for (const removal of removals) {
    const start = Math.max(range.startFrame, removal.startFrame)
    const end = Math.min(range.endFrame, removal.endFrame)
    if (start > cursor) result.push({ startFrame: cursor, endFrame: start })
    cursor = Math.max(cursor, end)
  }
  if (cursor < range.endFrame) result.push({ startFrame: cursor, endFrame: range.endFrame })
  return result
}

function intersection(
  left: MulticamFrameRange,
  right: MulticamFrameRange
): MulticamFrameRange | undefined {
  const startFrame = Math.max(left.startFrame, right.startFrame)
  const endFrame = Math.min(left.endFrame, right.endFrame)
  return endFrame > startFrame ? { startFrame, endFrame } : undefined
}

function overlaps(left: MulticamFrameRange, right: MulticamFrameRange): boolean {
  return left.startFrame < right.endFrame && right.startFrame < left.endFrame
}

function assertNonOverlappingProgram(program: readonly MulticamProgramFragment[]): void {
  for (let index = 1; index < program.length; index += 1) {
    if (program[index]!.startFrame < program[index - 1]!.endFrame) {
      invalid('Multicam program fragments must be non-overlapping')
    }
  }
}

function frameRange(
  value: MulticamFrameRange,
  maximum: number,
  name: string
): MulticamFrameRange {
  const startFrame = boundedInteger(value?.startFrame, 0, maximum, `${name}.startFrame`)
  const endFrame = boundedInteger(value?.endFrame, 1, maximum, `${name}.endFrame`)
  if (endFrame <= startFrame) invalid(`${name} must be a non-empty half-open frame range`)
  return { startFrame, endFrame }
}

function planId(
  kind: MulticamPlan['kind'],
  groupId: string,
  requestedRange: MulticamFrameRange,
  selection: MulticamProgramSelection | undefined,
  beforeDigest: string,
  afterDigest: string
): string {
  return `multicam-plan:${stableDigest([
    kind,
    groupId,
    requestedRange.startFrame,
    requestedRange.endFrame,
    selection ? selectionKey(selection) : 'none',
    beforeDigest,
    afterDigest
  ])}`
}

function selectionEquals(left: MulticamProgramSelection, right: MulticamProgramSelection): boolean {
  return selectionKey(left) === selectionKey(right)
}

function selectionKey(selection: MulticamProgramSelection): string {
  return selection.kind === 'angle' ? `angle:${selection.memberId}` : `layout:${selection.layoutId}`
}

function fragmentEquals(left: MulticamProgramFragment, right: MulticamProgramFragment): boolean {
  return left.id === right.id &&
    left.startFrame === right.startFrame &&
    left.endFrame === right.endFrame &&
    selectionEquals(left.selection, right.selection)
}

function compareFragments(left: MulticamProgramFragment, right: MulticamProgramFragment): number {
  return left.startFrame - right.startFrame ||
    left.endFrame - right.endFrame ||
    left.id.localeCompare(right.id)
}

function cloneFragment(fragment: MulticamProgramFragment): MulticamProgramFragment {
  return { ...fragment, selection: { ...fragment.selection } }
}

function cloneTransactionOperation(
  operation: MulticamTransactionOperation
): MulticamTransactionOperation {
  return operation.type === 'delete-multicam-program-fragment'
    ? { ...operation }
    : { ...operation, fragment: cloneFragment(operation.fragment) }
}

function cloneFragments(fragments: readonly MulticamProgramFragment[]): MulticamProgramFragment[] {
  return fragments.map(cloneFragment)
}

function cloneRange(range: MulticamFrameRange): MulticamFrameRange {
  return { startFrame: range.startFrame, endFrame: range.endFrame }
}

function cloneSourceSlice(slice: MulticamSourceSlice): MulticamSourceSlice {
  return { ...slice, sourceFps: { ...slice.sourceFps } }
}

function cloneMember(member: Readonly<MulticamMember>): MulticamMember {
  return {
    id: member.id,
    assetId: member.assetId,
    memberLabel: member.memberLabel,
    angleLabel: member.angleLabel,
    sourceFps: { ...member.sourceFps },
    sync: {
      ...member.sync,
      evidence: member.sync.evidence.map((evidence) => ({ ...evidence }))
    },
    coverage: member.coverage.map((segment) => ({ ...segment }))
  }
}

function cloneLayout(layout: Readonly<MulticamLayout>): MulticamLayout {
  return { id: layout.id, label: layout.label, slots: layout.slots.map((slot) => ({ ...slot })) }
}

function boundedCopy<T>(values: readonly T[], maximum: number): T[] {
  return values.slice(0, maximum).map((value) => structuredClone(value))
}

function syncStatus(value: unknown): MulticamMemberSync['status'] {
  if (value === 'reference' || value === 'verified' || value === 'uncertain' || value === 'unknown') {
    return value
  }
  invalid('Unknown multicam synchronization status')
}

function identifier(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MULTICAM_LIMITS.idLength ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
  ) {
    invalid(`${name} is invalid or path-like`)
  }
  return value
}

function label(value: unknown, name: string): string {
  if (typeof value !== 'string') invalid(`${name} must be a string`)
  const result = value.trim()
  if (
    result.length === 0 ||
    result.length > MULTICAM_LIMITS.labelLength ||
    looksLikeExternalLocator(result)
  ) {
    invalid(`${name} is invalid or exposes an external locator`)
  }
  return result
}

function looksLikeExternalLocator(value: string): boolean {
  return /^(?:\/|~[/\\]|[A-Za-z]:[/\\]|\\\\|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/u.test(value)
}

function unique(values: readonly { id: string }[], name: string): void {
  if (new Set(values.map(({ id }) => id)).size !== values.length) invalid(`Duplicate ${name} ID`)
}

function uniqueCaseInsensitive(values: readonly string[], name: string): void {
  const normalized = values.map((value) => value.toLocaleLowerCase('en-US'))
  if (new Set(normalized).size !== values.length) invalid(`Duplicate ${name}`)
}

function confidence(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    invalid(`${name} must be between 0 and 1`)
  }
  return Number(value.toFixed(8))
}

function unitInterval(value: unknown, name: string): number {
  return confidence(value, name)
}

function positiveUnit(value: unknown, name: string): number {
  const result = confidence(value, name)
  if (result <= 0) invalid(`${name} must be greater than zero`)
  return result
}

function signedInteger(value: unknown, maximumAbsolute: number, name: string): number {
  if (!Number.isSafeInteger(value) || Math.abs(value as number) > maximumAbsolute) {
    invalid(`${name} must be a bounded safe integer`)
  }
  return value as number
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value as number
}

function stableDigest(value: unknown): string {
  const input = JSON.stringify(value)
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  }
  return value
}

function invalid(message: string): never {
  throw engineError('invalid_operation', message)
}
