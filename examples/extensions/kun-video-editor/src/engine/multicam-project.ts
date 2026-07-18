import { createHash } from 'node:crypto'
import { engineError } from './errors.js'
import {
  validateMulticamGroup,
  type MulticamGroup,
  type MulticamLayout,
  type MulticamMember,
  type MulticamMemberSync,
  type MulticamSyncEvidence
} from './multicam.js'
import type { VideoProject } from './schema.js'
import { microsecondsToFrames, rescaleFrames } from './time.js'

export type CreateMulticamMemberInput = {
  id: string
  assetId: string
  memberLabel: string
  angleLabel: string
  offsetFrames?: number
  sync?: Omit<MulticamMemberSync, 'offsetFrames'>
}

export type CreateMulticamGroupInput = {
  id: string
  sequenceId?: string
  name: string
  referenceMemberId: string
  members: CreateMulticamMemberInput[]
  layouts?: MulticamLayout[]
}

export type ConfirmMulticamSyncInput = {
  groupId: string
  memberId: string
  offsetFrames: number
  status: 'verified' | 'uncertain'
  confidence: number
  evidence: MulticamSyncEvidence[]
}

/**
 * Creates a source-preserving group from project media metadata. Non-reference
 * members stay explicitly unknown unless bounded evidence is supplied; zero
 * offset is never treated as proof of synchronization.
 */
export function createMulticamGroup(
  project: VideoProject,
  input: CreateMulticamGroupInput
): MulticamGroup {
  if ((project.multicamGroups ?? []).some(({ id }) => id === input.id)) {
    throw engineError('invalid_operation', `Multicam group already exists: ${input.id}`)
  }
  const sequenceId = input.sequenceId ?? project.activeSequenceId
  if (!project.sequences.some(({ id }) => id === sequenceId)) {
    throw engineError('invalid_operation', `Multicam sequence does not exist: ${sequenceId}`)
  }
  const referenceInput = input.members.find(({ id }) => id === input.referenceMemberId)
  if (!referenceInput) {
    throw engineError('invalid_operation', 'Multicam reference member must be included')
  }
  const referenceAsset = videoAsset(project, referenceInput.assetId)
  const referenceSourceFrames = microsecondsToFrames(
    referenceAsset.durationUs,
    referenceAsset.video!.frameRate,
    'floor'
  )
  const durationFrames = rescaleFrames(
    referenceSourceFrames,
    referenceAsset.video!.frameRate,
    project.fps,
    'floor'
  )
  if (durationFrames <= 0) {
    throw engineError('invalid_operation', 'The multicam reference source has no usable frames')
  }
  const members = input.members.map((memberInput): MulticamMember => {
    const asset = videoAsset(project, memberInput.assetId)
    const offsetFrames = memberInput.id === input.referenceMemberId
      ? 0
      : memberInput.offsetFrames ?? 0
    const sync: MulticamMemberSync = memberInput.id === input.referenceMemberId
      ? { status: 'reference', offsetFrames: 0, confidence: 1, evidence: [] }
      : memberInput.sync
        ? { ...structuredClone(memberInput.sync), offsetFrames }
        : { status: 'unknown', offsetFrames, evidence: [] }
    return {
      id: memberInput.id,
      assetId: memberInput.assetId,
      memberLabel: memberInput.memberLabel,
      angleLabel: memberInput.angleLabel,
      sourceFps: structuredClone(asset.video!.frameRate),
      sync,
      coverage: [coverageForAsset(project, asset, memberInput.id, offsetFrames, durationFrames)]
    }
  })
  return structuredClone(validateMulticamGroup({
    schemaVersion: 1,
    id: input.id,
    sequenceId,
    name: input.name,
    fps: structuredClone(project.fps),
    durationFrames,
    referenceMemberId: input.referenceMemberId,
    members,
    layouts: structuredClone(input.layouts ?? []),
    programFragments: [{
      id: boundedDerivedId(`program-${input.id}-reference`),
      startFrame: 0,
      endFrame: durationFrames,
      selection: { kind: 'angle', memberId: input.referenceMemberId }
    }]
  })) as MulticamGroup
}

export function confirmMulticamMemberSync(
  project: VideoProject,
  input: ConfirmMulticamSyncInput
): MulticamGroup {
  const group = (project.multicamGroups ?? []).find(({ id }) => id === input.groupId)
  if (!group) throw engineError('invalid_operation', `Multicam group does not exist: ${input.groupId}`)
  if (input.memberId === group.referenceMemberId) {
    throw engineError('invalid_operation', 'The reference multicam member cannot be resynchronized')
  }
  const member = group.members.find(({ id }) => id === input.memberId)
  if (!member) throw engineError('invalid_operation', `Multicam member does not exist: ${input.memberId}`)
  const asset = videoAsset(project, member.assetId)
  const next = structuredClone(group)
  const target = next.members.find(({ id }) => id === input.memberId)!
  target.sync = {
    status: input.status,
    offsetFrames: input.offsetFrames,
    confidence: input.confidence,
    evidence: structuredClone(input.evidence)
  }
  target.coverage = [coverageForAsset(
    project,
    asset,
    target.id,
    input.offsetFrames,
    next.durationFrames
  )]
  return structuredClone(validateMulticamGroup(next)) as MulticamGroup
}

export function updateMulticamLabels(
  project: VideoProject,
  input: {
    groupId: string
    name?: string
    members?: Array<{ memberId: string; memberLabel?: string; angleLabel?: string }>
  }
): MulticamGroup {
  const group = (project.multicamGroups ?? []).find(({ id }) => id === input.groupId)
  if (!group) throw engineError('invalid_operation', `Multicam group does not exist: ${input.groupId}`)
  const next = structuredClone(group)
  if (input.name !== undefined) next.name = input.name
  for (const patch of input.members ?? []) {
    const member = next.members.find(({ id }) => id === patch.memberId)
    if (!member) throw engineError('invalid_operation', `Multicam member does not exist: ${patch.memberId}`)
    if (patch.memberLabel !== undefined) member.memberLabel = patch.memberLabel
    if (patch.angleLabel !== undefined) member.angleLabel = patch.angleLabel
  }
  return structuredClone(validateMulticamGroup(next)) as MulticamGroup
}

export function upsertMulticamLayout(
  project: VideoProject,
  groupId: string,
  layout: MulticamLayout
): MulticamGroup {
  const group = (project.multicamGroups ?? []).find(({ id }) => id === groupId)
  if (!group) throw engineError('invalid_operation', `Multicam group does not exist: ${groupId}`)
  const next = structuredClone(group)
  const index = next.layouts.findIndex(({ id }) => id === layout.id)
  if (index < 0) next.layouts.push(structuredClone(layout))
  else next.layouts[index] = structuredClone(layout)
  return structuredClone(validateMulticamGroup(next)) as MulticamGroup
}

function videoAsset(project: VideoProject, assetId: string): VideoProject['assets'][number] {
  const asset = project.assets.find(({ id }) => id === assetId)
  if (!asset?.video || asset.kind !== 'video') {
    throw engineError('invalid_operation', `Multicam member requires a probed video asset: ${assetId}`)
  }
  if ((asset.availability ?? 'online') !== 'online') {
    throw engineError('media_relink_required', `Multicam member is not online: ${assetId}`)
  }
  return asset
}

function coverageForAsset(
  project: VideoProject,
  asset: VideoProject['assets'][number],
  memberId: string,
  offsetFrames: number,
  groupDurationFrames: number
): MulticamMember['coverage'][number] {
  const sourceFps = asset.video!.frameRate
  const sourceFrameCount = microsecondsToFrames(asset.durationUs, sourceFps, 'floor')
  let sourceStartFrame = 0
  let startFrame = offsetFrames
  if (startFrame < 0) {
    sourceStartFrame = rescaleFrames(-startFrame, project.fps, sourceFps, 'ceil')
    startFrame = rescaleFrames(sourceStartFrame, sourceFps, project.fps) + offsetFrames
  }
  startFrame = Math.max(0, startFrame)
  let sourceEndFrame = sourceFrameCount
  let endFrame = rescaleFrames(sourceEndFrame, sourceFps, project.fps) + offsetFrames
  if (endFrame > groupDurationFrames) {
    sourceEndFrame = rescaleFrames(
      groupDurationFrames - offsetFrames,
      project.fps,
      sourceFps,
      'floor'
    )
    endFrame = rescaleFrames(sourceEndFrame, sourceFps, project.fps) + offsetFrames
  }
  sourceStartFrame = Math.max(0, Math.min(sourceStartFrame, sourceFrameCount))
  sourceEndFrame = Math.max(sourceStartFrame + 1, Math.min(sourceEndFrame, sourceFrameCount))
  endFrame = Math.min(groupDurationFrames, endFrame)
  if (endFrame <= startFrame) {
    throw engineError('invalid_operation', `Multicam member has no source coverage: ${memberId}`)
  }
  return {
    id: boundedDerivedId(`coverage-${memberId}`),
    startFrame,
    endFrame,
    sourceStartFrame,
    sourceEndFrame
  }
}

function boundedDerivedId(candidate: string): string {
  if (candidate.length <= 128) return candidate
  const digest = createHash('sha256').update(candidate).digest('hex').slice(0, 24)
  return `${candidate.slice(0, 103)}-${digest}`
}
