import { createHash } from 'node:crypto'
import {
  confirmMulticamMemberSync,
  createMulticamGroup,
  engineError,
  updateMulticamLabels,
  upsertMulticamLayout,
  type MulticamLayout,
  type TimelineOperation,
  type VideoProject
} from '../engine/index.js'

export type MulticamEditorAction =
  | 'multicam.create'
  | 'multicam.labels'
  | 'multicam.sync-confirm'
  | 'multicam.layout-upsert'
  | 'multicam.delete'
  | 'multicam.switch'
  | 'multicam.layout'
  | 'multicam.merge'

export type MulticamEditorPlan = {
  action: MulticamEditorAction
  operations: TimelineOperation[]
  summary: string
  reason: string
}

export function planMulticamEditorAction(
  project: VideoProject,
  action: MulticamEditorAction,
  payload: Readonly<Record<string, unknown>>
): MulticamEditorPlan {
  if (action === 'multicam.create') {
    exactKeys(payload, [
      'projectId', 'expectedRevision', 'groupId', 'sequenceId', 'name',
      'referenceMemberId', 'members', 'createDefaultLayout'
    ])
    const members = boundedArray(payload.members, 'members', 2, 8).map((entry, index) => {
      const member = record(entry, `members[${index}]`)
      exactKeys(member, ['id', 'assetId', 'memberLabel', 'angleLabel', 'offsetFrames'])
      return {
        id: stableId(member.id, `members[${index}].id`),
        assetId: stableId(member.assetId, `members[${index}].assetId`),
        memberLabel: label(member.memberLabel, `members[${index}].memberLabel`),
        angleLabel: label(member.angleLabel, `members[${index}].angleLabel`),
        ...(member.offsetFrames === undefined
          ? {}
          : { offsetFrames: signedInteger(member.offsetFrames, `members[${index}].offsetFrames`) })
      }
    })
    const groupId = stableId(payload.groupId, 'groupId')
    const group = createMulticamGroup(project, {
      id: groupId,
      ...(payload.sequenceId === undefined ? {} : { sequenceId: stableId(payload.sequenceId, 'sequenceId') }),
      name: label(payload.name, 'name'),
      referenceMemberId: stableId(payload.referenceMemberId, 'referenceMemberId'),
      members,
      layouts: payload.createDefaultLayout === false ? [] : [defaultLayout(groupId, members)]
    })
    return {
      action,
      operations: [{ type: 'set-multicam-group', group }],
      summary: `Created multicam group ${group.id}`,
      reason: 'multicam-created'
    }
  }
  if (action === 'multicam.labels') {
    exactKeys(payload, ['projectId', 'expectedRevision', 'groupId', 'name', 'members'])
    const groupId = stableId(payload.groupId, 'groupId')
    const members = payload.members === undefined
      ? undefined
      : boundedArray(payload.members, 'members', 1, 32).map((entry, index) => {
          const patch = record(entry, `members[${index}]`)
          exactKeys(patch, ['memberId', 'memberLabel', 'angleLabel'])
          return {
            memberId: stableId(patch.memberId, `members[${index}].memberId`),
            ...(patch.memberLabel === undefined
              ? {}
              : { memberLabel: label(patch.memberLabel, `members[${index}].memberLabel`) }),
            ...(patch.angleLabel === undefined
              ? {}
              : { angleLabel: label(patch.angleLabel, `members[${index}].angleLabel`) })
          }
        })
    if (payload.name === undefined && members === undefined) {
      throw engineError('invalid_operation', 'Multicam label update requires a group or member label')
    }
    const group = updateMulticamLabels(project, {
      groupId,
      ...(payload.name === undefined ? {} : { name: label(payload.name, 'name') }),
      ...(members === undefined ? {} : { members })
    })
    return {
      action,
      operations: [{ type: 'set-multicam-group', group }],
      summary: `Updated multicam labels for ${group.id}`,
      reason: 'multicam-labels-updated'
    }
  }
  if (action === 'multicam.sync-confirm') {
    exactKeys(payload, [
      'projectId', 'expectedRevision', 'groupId', 'memberId', 'offsetFrames', 'status', 'confidence'
    ])
    const groupId = stableId(payload.groupId, 'groupId')
    const memberId = stableId(payload.memberId, 'memberId')
    const status = payload.status === undefined
      ? 'verified'
      : choice(payload.status, ['verified', 'uncertain'] as const, 'status')
    const confidence = payload.confidence === undefined ? 1 : unit(payload.confidence, 'confidence')
    const group = (project.multicamGroups ?? []).find(({ id }) => id === groupId)
    if (!group) throw engineError('invalid_operation', `Multicam group does not exist: ${groupId}`)
    const synchronized = confirmMulticamMemberSync(project, {
      groupId,
      memberId,
      offsetFrames: signedInteger(payload.offsetFrames, 'offsetFrames'),
      status,
      confidence,
      evidence: [{
        id: boundedDerivedId(`manual-sync-${memberId}-${project.currentRevision}`),
        analysisId: boundedDerivedId(`manual-sync-${groupId}-${project.currentRevision}`),
        kind: 'manual-confirmation',
        referenceMemberId: group.referenceMemberId,
        targetMemberId: memberId,
        confidence,
        algorithmId: 'kun.manual-sync',
        algorithmVersion: '1.0.0'
      }]
    })
    return {
      action,
      operations: [{ type: 'set-multicam-group', group: synchronized }],
      summary: `Manually confirmed synchronization for ${memberId}`,
      reason: 'multicam-sync-confirmed'
    }
  }
  if (action === 'multicam.layout-upsert') {
    exactKeys(payload, ['projectId', 'expectedRevision', 'groupId', 'layout'])
    const groupId = stableId(payload.groupId, 'groupId')
    const layout = layoutValue(payload.layout)
    const group = upsertMulticamLayout(project, groupId, layout)
    return {
      action,
      operations: [{ type: 'set-multicam-group', group }],
      summary: `Updated multicam layout ${layout.id}`,
      reason: 'multicam-layout-updated'
    }
  }
  if (action === 'multicam.delete') {
    exactKeys(payload, ['projectId', 'expectedRevision', 'groupId'])
    const groupId = stableId(payload.groupId, 'groupId')
    return {
      action,
      operations: [{ type: 'delete-multicam-group', groupId }],
      summary: `Deleted multicam group ${groupId}`,
      reason: 'multicam-deleted'
    }
  }
  if (action === 'multicam.merge') {
    exactKeys(payload, ['projectId', 'expectedRevision', 'groupId'])
    const groupId = stableId(payload.groupId, 'groupId')
    return {
      action,
      operations: [{ type: 'merge-multicam-program', groupId }],
      summary: `Merged adjacent multicam program fragments for ${groupId}`,
      reason: 'multicam-program-merged'
    }
  }
  exactKeys(payload, [
    'projectId', 'expectedRevision', 'groupId',
    action === 'multicam.switch' ? 'memberId' : 'layoutId',
    'startFrame', 'endFrame', 'coveragePolicy', 'minimumSyncConfidence'
  ])
  const groupId = stableId(payload.groupId, 'groupId')
  const common = {
    groupId,
    startFrame: nonNegativeInteger(payload.startFrame, 'startFrame'),
    endFrame: positiveInteger(payload.endFrame, 'endFrame'),
    ...(payload.coveragePolicy === undefined
      ? {}
      : { coveragePolicy: choice(payload.coveragePolicy, ['reject', 'clamp'] as const, 'coveragePolicy') }),
    ...(payload.minimumSyncConfidence === undefined
      ? {}
      : { minimumSyncConfidence: unit(payload.minimumSyncConfidence, 'minimumSyncConfidence') })
  }
  if (action === 'multicam.switch') {
    const memberId = stableId(payload.memberId, 'memberId')
    return {
      action,
      operations: [{ type: 'switch-multicam-angle', memberId, ...common }],
      summary: `Switched multicam program ${groupId} to ${memberId}`,
      reason: 'multicam-angle-switched'
    }
  }
  const layoutId = stableId(payload.layoutId, 'layoutId')
  return {
    action,
    operations: [{ type: 'apply-multicam-layout', layoutId, ...common }],
    summary: `Applied multicam layout ${layoutId}`,
    reason: 'multicam-layout-applied'
  }
}

function defaultLayout(
  groupId: string,
  members: Array<{ id: string }>
): MulticamLayout {
  const columns = Math.min(2, members.length)
  const rows = Math.ceil(members.length / columns)
  return {
    id: boundedDerivedId(`layout-${groupId}-grid`),
    label: 'Grid',
    slots: members.map((member, index) => ({
      memberId: member.id,
      x: (index % columns) / columns,
      y: Math.floor(index / columns) / rows,
      width: 1 / columns,
      height: 1 / rows,
      zIndex: index,
      opacity: 1,
      audioEnabled: index === 0
    }))
  }
}

function boundedDerivedId(candidate: string): string {
  if (candidate.length <= 128) return candidate
  const digest = createHash('sha256').update(candidate).digest('hex').slice(0, 24)
  return `${candidate.slice(0, 103)}-${digest}`
}

function layoutValue(value: unknown): MulticamLayout {
  const layout = record(value, 'layout')
  exactKeys(layout, ['id', 'label', 'slots'])
  return {
    id: stableId(layout.id, 'layout.id'),
    label: label(layout.label, 'layout.label'),
    slots: boundedArray(layout.slots, 'layout.slots', 2, 16).map((entry, index) => {
      const slot = record(entry, `layout.slots[${index}]`)
      exactKeys(slot, ['memberId', 'x', 'y', 'width', 'height', 'zIndex', 'opacity', 'audioEnabled'])
      if (typeof slot.audioEnabled !== 'boolean') invalid(`layout.slots[${index}].audioEnabled`)
      return {
        memberId: stableId(slot.memberId, `layout.slots[${index}].memberId`),
        x: unit(slot.x, `layout.slots[${index}].x`),
        y: unit(slot.y, `layout.slots[${index}].y`),
        width: positiveUnit(slot.width, `layout.slots[${index}].width`),
        height: positiveUnit(slot.height, `layout.slots[${index}].height`),
        zIndex: nonNegativeInteger(slot.zIndex, `layout.slots[${index}].zIndex`),
        opacity: unit(slot.opacity, `layout.slots[${index}].opacity`),
        audioEnabled: slot.audioEnabled
      }
    })
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(name)
  return value as Record<string, unknown>
}

function exactKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): void {
  const set = new Set(allowed)
  const unknown = Object.keys(value).find((key) => !set.has(key))
  if (unknown) throw engineError('invalid_operation', `Unsupported multicam field: ${unknown}`)
}

function boundedArray(value: unknown, name: string, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) invalid(name)
  return value
}

function stableId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(value)) invalid(name)
  return value
}

function label(value: unknown, name: string): string {
  if (typeof value !== 'string') invalid(name)
  const normalized = value.trim()
  if (
    normalized.length < 1 || normalized.length > 96 ||
    /^(?:\/|~[/\\]|[A-Za-z]:[/\\]|\\\\|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/u.test(normalized)
  ) invalid(name)
  return normalized
}

function signedInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Math.abs(Number(value)) > 31_104_000) invalid(name)
  return Number(value)
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(name)
  return Number(value)
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid(name)
  return Number(value)
}

function unit(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) invalid(name)
  return value
}

function positiveUnit(value: unknown, name: string): number {
  const parsed = unit(value, name)
  if (parsed <= 0) invalid(name)
  return parsed
}

function choice<const T extends readonly string[]>(value: unknown, options: T, name: string): T[number] {
  if (typeof value !== 'string' || !options.includes(value)) invalid(name)
  return value as T[number]
}

function invalid(name: string): never {
  throw engineError('invalid_operation', `Invalid multicam ${name}`)
}
