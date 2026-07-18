import { engineError } from './errors.js'
import type { ProjectService, CommitMetadata } from './project-service.js'
import type {
  LinkGroup,
  TimelineItem,
  TimelineOperation,
  Track,
  UpdateItemPropertiesOperation
} from './schema.js'

export const TIMELINE_EDIT_LIMITS = Object.freeze({
  maxOperationsPerCommit: 200
})

export type TimelineEditFragment = TimelineItem & {
  originItemId: string
  fragment: 'original' | 'left' | 'right'
}

export type TimelineEditPlan = {
  kind:
    | 'ripple-delete'
    | 'ripple-insert'
    | 'ripple-trim'
    | 'ripple-gap-delete'
    | 'overwrite'
    | 'linked-move'
    | 'linked-trim'
    | 'clip-properties'
  range: { startFrame: number; endFrame: number }
  items: TimelineItem[]
  removedIds: string[]
  createdIds: string[]
  changedIds: string[]
  shifts: Array<{ trackId: string; fromFrame: number; deltaFrames: number; count: number }>
  warnings: Array<{ code: string; itemId?: string; trackId?: string }>
}

export type RippleTrack = Pick<Track, 'id' | 'locked'> & { syncLocked: boolean }

export function planRippleDelete(input: {
  items: readonly TimelineItem[]
  tracks: readonly RippleTrack[]
  targetTrackId: string
  startFrame: number
  endFrame: number
  idFactory?: (originId: string, fragment: 'left' | 'right') => string
}): TimelineEditPlan {
  const range = editRange(input.startFrame, input.endFrame)
  const duration = range.endFrame - range.startFrame
  const targetTrack = input.tracks.find(({ id }) => id === input.targetTrackId)
  if (!targetTrack) invalid(`Ripple target track does not exist: ${input.targetTrackId}`)
  if (targetTrack.locked) invalid(`Ripple target track is locked: ${input.targetTrackId}`)
  const affectedTrackIds = new Set(input.tracks
    .filter((track) => track.id === input.targetTrackId || track.syncLocked)
    .filter((track) => !track.locked)
    .map(({ id }) => id))
  const idFactory = input.idFactory ?? fragmentId
  const result: TimelineItem[] = []
  const removedIds: string[] = []
  const createdIds: string[] = []
  const changedIds: string[] = []
  const shiftedByTrack = new Map<string, number>()
  const warnings = input.tracks
    .filter((track) => track.syncLocked && track.locked)
    .map((track) => ({ code: 'sync-track-locked', trackId: track.id }))

  for (const original of input.items) {
    const item = structuredClone(original)
    if (!affectedTrackIds.has(item.trackId)) {
      result.push(item)
      continue
    }
    const itemStart = item.timelineStartFrame
    const itemEnd = itemStart + item.durationFrames
    if (itemEnd <= range.startFrame) {
      result.push(item)
      continue
    }
    if (itemStart >= range.endFrame) {
      item.timelineStartFrame -= duration
      result.push(item)
      changedIds.push(item.id)
      shiftedByTrack.set(item.trackId, (shiftedByTrack.get(item.trackId) ?? 0) + 1)
      continue
    }
    removedIds.push(item.id)
    const leftFrames = Math.max(0, range.startFrame - itemStart)
    const rightFrames = Math.max(0, itemEnd - range.endFrame)
    if (leftFrames > 0) {
      const left = trimItemToTimelineRange(item, itemStart, range.startFrame)
      left.id = idFactory(item.id, 'left')
      result.push(left)
      createdIds.push(left.id)
    }
    if (rightFrames > 0) {
      const right = trimItemToTimelineRange(item, range.endFrame, itemEnd)
      right.id = idFactory(item.id, 'right')
      right.timelineStartFrame = range.startFrame
      result.push(right)
      createdIds.push(right.id)
    }
  }
  return finalizePlan({
    kind: 'ripple-delete',
    range,
    items: result,
    removedIds,
    createdIds,
    changedIds,
    shifts: [...shiftedByTrack].map(([trackId, count]) => ({
      trackId,
      fromFrame: range.endFrame,
      deltaFrames: -duration,
      count
    })),
    warnings
  })
}

export function planRippleInsert(input: {
  items: readonly TimelineItem[]
  tracks: readonly RippleTrack[]
  targetTrackId: string
  atFrame: number
  durationFrames: number
}): TimelineEditPlan {
  const atFrame = frame(input.atFrame, 'atFrame')
  const durationFrames = positiveFrame(input.durationFrames, 'durationFrames')
  const targetTrack = input.tracks.find(({ id }) => id === input.targetTrackId)
  if (!targetTrack) invalid(`Ripple target track does not exist: ${input.targetTrackId}`)
  if (targetTrack.locked) invalid(`Ripple target track is locked: ${input.targetTrackId}`)
  const affected = new Set(input.tracks
    .filter((track) => (track.id === targetTrack.id || track.syncLocked) && !track.locked)
    .map(({ id }) => id))
  const shiftedByTrack = new Map<string, number>()
  const changedIds: string[] = []
  const items = input.items.map((candidate) => {
    const item = structuredClone(candidate)
    if (affected.has(item.trackId) && item.timelineStartFrame >= atFrame) {
      item.timelineStartFrame += durationFrames
      changedIds.push(item.id)
      shiftedByTrack.set(item.trackId, (shiftedByTrack.get(item.trackId) ?? 0) + 1)
    }
    return item
  })
  return finalizePlan({
    kind: 'ripple-insert',
    range: { startFrame: atFrame, endFrame: atFrame + durationFrames },
    items,
    removedIds: [],
    createdIds: [],
    changedIds,
    shifts: [...shiftedByTrack].map(([trackId, count]) => ({
      trackId,
      fromFrame: atFrame,
      deltaFrames: durationFrames,
      count
    })),
    warnings: input.tracks
      .filter((track) => track.syncLocked && track.locked)
      .map((track) => ({ code: 'sync-track-locked', trackId: track.id }))
})
}

export function planRippleTrim(input: {
  items: readonly TimelineItem[]
  tracks: readonly RippleTrack[]
  targetTrackId: string
  itemId: string
  endFrame: number
}): TimelineEditPlan {
  const original = input.items.find(({ id }) => id === input.itemId)
  if (!original) invalid(`Ripple trim item does not exist: ${input.itemId}`)
  if (original.trackId !== input.targetTrackId) {
    invalid(`Ripple trim item ${input.itemId} is not on target track ${input.targetTrackId}`)
  }
  const originalEnd = original.timelineStartFrame + original.durationFrames
  const endFrame = frame(input.endFrame, 'endFrame')
  if (endFrame <= original.timelineStartFrame || endFrame > originalEnd) {
    invalid('Ripple trim end must stay within the selected item')
  }
  if (endFrame === originalEnd) {
    return finalizePlan({
      kind: 'ripple-trim',
      range: {
        startFrame: original.timelineStartFrame,
        endFrame: originalEnd
      },
      items: input.items.map((item) => structuredClone(item)),
      removedIds: [],
      createdIds: [],
      changedIds: [],
      shifts: [],
      warnings: []
    })
  }
  const duration = originalEnd - endFrame
  const targetTrack = input.tracks.find(({ id }) => id === input.targetTrackId)
  if (!targetTrack) invalid(`Ripple target track does not exist: ${input.targetTrackId}`)
  if (targetTrack.locked) invalid(`Ripple target track is locked: ${input.targetTrackId}`)
  const affectedTrackIds = new Set(input.tracks
    .filter((track) => (track.id === input.targetTrackId || track.syncLocked) && !track.locked)
    .map(({ id }) => id))
  const changedIds: string[] = []
  const shiftedByTrack = new Map<string, number>()
  const items = input.items.map((candidate) => {
    if (candidate.id === original.id) {
      changedIds.push(candidate.id)
      return trimItemToTimelineRange(candidate, candidate.timelineStartFrame, endFrame)
    }
    const item = structuredClone(candidate)
    if (affectedTrackIds.has(item.trackId) && item.timelineStartFrame >= originalEnd) {
      item.timelineStartFrame -= duration
      changedIds.push(item.id)
      shiftedByTrack.set(item.trackId, (shiftedByTrack.get(item.trackId) ?? 0) + 1)
    }
    return item
  })
  return finalizePlan({
    kind: 'ripple-trim',
    range: { startFrame: endFrame, endFrame: originalEnd },
    items,
    removedIds: [],
    createdIds: [],
    changedIds,
    shifts: [...shiftedByTrack].map(([trackId, count]) => ({
      trackId,
      fromFrame: originalEnd,
      deltaFrames: -duration,
      count
    })),
    warnings: input.tracks
      .filter((track) => track.syncLocked && track.locked)
      .map((track) => ({ code: 'sync-track-locked', trackId: track.id }))
  })
}

export function planRippleGapDelete(input: {
  items: readonly TimelineItem[]
  tracks: readonly RippleTrack[]
  targetTrackId: string
  startFrame: number
  endFrame: number
}): TimelineEditPlan {
  const range = editRange(input.startFrame, input.endFrame)
  const intersectsTarget = input.items.some((item) =>
    item.trackId === input.targetTrackId && overlaps(
      item.timelineStartFrame,
      item.timelineStartFrame + item.durationFrames,
      range.startFrame,
      range.endFrame
    )
  )
  if (intersectsTarget) invalid('Ripple gap delete requires an empty range on the target track')
  return {
    ...planRippleDelete(input),
    kind: 'ripple-gap-delete'
  }
}

export function planOverwrite(input: {
  items: readonly TimelineItem[]
  insertedItem: TimelineItem
  idFactory?: (originId: string, fragment: 'left' | 'right') => string
}): TimelineEditPlan {
  const inserted = structuredClone(input.insertedItem)
  const range = editRange(
    inserted.timelineStartFrame,
    inserted.timelineStartFrame + inserted.durationFrames
  )
  const idFactory = input.idFactory ?? fragmentId
  const result: TimelineItem[] = []
  const removedIds: string[] = []
  const createdIds: string[] = [inserted.id]
  const changedIds: string[] = []
  for (const original of input.items) {
    const item = structuredClone(original)
    if (item.trackId !== inserted.trackId) {
      result.push(item)
      continue
    }
    const itemStart = item.timelineStartFrame
    const itemEnd = itemStart + item.durationFrames
    if (!overlaps(itemStart, itemEnd, range.startFrame, range.endFrame)) {
      result.push(item)
      continue
    }
    removedIds.push(item.id)
    if (itemStart < range.startFrame) {
      const left = trimItemToTimelineRange(item, itemStart, range.startFrame)
      left.id = idFactory(item.id, 'left')
      result.push(left)
      createdIds.push(left.id)
    }
    if (itemEnd > range.endFrame) {
      const right = trimItemToTimelineRange(item, range.endFrame, itemEnd)
      right.id = idFactory(item.id, 'right')
      result.push(right)
      createdIds.push(right.id)
    }
  }
  result.push(inserted)
  return finalizePlan({
    kind: 'overwrite',
    range,
    items: result,
    removedIds,
    createdIds,
    changedIds,
    shifts: [],
    warnings: []
  })
}

export function planLinkedMove(input: {
  items: readonly TimelineItem[]
  linkGroups: readonly LinkGroup[]
  tracks: readonly Pick<Track, 'id' | 'locked'>[]
  itemId: string
  deltaFrames: number
  targetTrackId?: string
}): TimelineEditPlan {
  const deltaFrames = integer(input.deltaFrames, 'deltaFrames')
  const origin = input.items.find(({ id }) => id === input.itemId)
  if (!origin) invalid(`Linked move item does not exist: ${input.itemId}`)
  const linkedIds = linkedClosure(input.itemId, input.linkGroups)
  const tracks = new Map(input.tracks.map((track) => [track.id, track]))
  const changedIds: string[] = []
  const shiftedByTrack = new Map<string, number>()
  const items = input.items.map((candidate) => {
    const item = structuredClone(candidate)
    if (!linkedIds.has(item.id)) return item
    if (item.locked) invalid(`Linked move item is locked: ${item.id}`)
    const targetTrackId = item.id === input.itemId && input.targetTrackId
      ? input.targetTrackId
      : item.trackId
    const track = tracks.get(targetTrackId)
    if (!track) invalid(`Linked move target track does not exist: ${targetTrackId}`)
    if (track.locked) invalid(`Linked move target track is locked: ${targetTrackId}`)
    const nextStart = item.timelineStartFrame + deltaFrames
    if (nextStart < 0) invalid('Linked move would place an item before frame zero')
    item.timelineStartFrame = nextStart
    item.trackId = targetTrackId
    changedIds.push(item.id)
    shiftedByTrack.set(targetTrackId, (shiftedByTrack.get(targetTrackId) ?? 0) + 1)
    return item
  })
  return finalizePlan({
    kind: 'linked-move',
    range: {
      startFrame: origin.timelineStartFrame,
      endFrame: origin.timelineStartFrame + origin.durationFrames
    },
    items,
    removedIds: [],
    createdIds: [],
    changedIds,
    shifts: [...shiftedByTrack].map(([trackId, count]) => ({
      trackId,
      fromFrame: origin.timelineStartFrame,
      deltaFrames,
      count
    })),
    warnings: []
})
}

export function planLinkedTrim(input: {
  items: readonly TimelineItem[]
  linkGroups: readonly LinkGroup[]
  tracks: readonly Pick<Track, 'id' | 'locked'>[]
  itemId: string
  startFrame: number
  endFrame: number
}): TimelineEditPlan {
  const origin = input.items.find(({ id }) => id === input.itemId)
  if (!origin) invalid(`Linked trim item does not exist: ${input.itemId}`)
  const requested = editRange(input.startFrame, input.endFrame)
  const originEnd = origin.timelineStartFrame + origin.durationFrames
  if (requested.startFrame < origin.timelineStartFrame || requested.endFrame > originEnd) {
    invalid(`Linked trim range is outside item ${origin.id}`)
  }
  const startDelta = requested.startFrame - origin.timelineStartFrame
  const endDelta = originEnd - requested.endFrame
  const linkedIds = linkedClosure(input.itemId, input.linkGroups)
  const tracks = new Map(input.tracks.map((track) => [track.id, track]))
  const changedIds: string[] = []
  const items = input.items.map((candidate) => {
    if (!linkedIds.has(candidate.id)) return structuredClone(candidate)
    if (candidate.locked) invalid(`Linked trim item is locked: ${candidate.id}`)
    const track = tracks.get(candidate.trackId)
    if (!track) invalid(`Linked trim track does not exist: ${candidate.trackId}`)
    if (track.locked) invalid(`Linked trim track is locked: ${candidate.trackId}`)
    const candidateEnd = candidate.timelineStartFrame + candidate.durationFrames
    const nextStart = candidate.timelineStartFrame + startDelta
    const nextEnd = candidateEnd - endDelta
    if (nextEnd <= nextStart) invalid(`Linked trim would empty item ${candidate.id}`)
    changedIds.push(candidate.id)
    return trimItemToTimelineRange(candidate, nextStart, nextEnd)
  })
  return finalizePlan({
    kind: 'linked-trim',
    range: requested,
    items,
    removedIds: [],
    createdIds: [],
    changedIds,
    shifts: [],
    warnings: []
  })
}

export function planClipProperties(input: {
  items: readonly TimelineItem[]
  linkGroups: readonly LinkGroup[]
  tracks: readonly Pick<Track, 'id' | 'locked'>[]
  itemId: string
  patch: Omit<UpdateItemPropertiesOperation, 'type' | 'itemId'>
  propagateLinked?: boolean
}): TimelineEditPlan {
  const origin = input.items.find(({ id }) => id === input.itemId)
  if (!origin) invalid(`Clip properties item does not exist: ${input.itemId}`)
  validatePropertiesPatch(input.patch)
  const affectedIds = input.propagateLinked
    ? linkedClosure(input.itemId, input.linkGroups)
    : new Set([input.itemId])
  const tracks = new Map(input.tracks.map((track) => [track.id, track]))
  const changedIds: string[] = []
  const items = input.items.map((candidate) => {
    const item = structuredClone(candidate)
    if (!affectedIds.has(item.id)) return item
    const track = tracks.get(item.trackId)
    if (!track) invalid(`Clip properties track does not exist: ${item.trackId}`)
    if (track.locked) invalid(`Clip properties track is locked: ${item.trackId}`)
    if (item.locked && input.patch.locked !== false) invalid(`Clip properties item is locked: ${item.id}`)
    Object.assign(item, input.patch)
    if (item.fadeInFrames + item.fadeOutFrames > item.durationFrames) {
      invalid(`Clip properties fades exceed item ${item.id}`)
    }
    changedIds.push(item.id)
    return item
  })
  return finalizePlan({
    kind: 'clip-properties',
    range: {
      startFrame: origin.timelineStartFrame,
      endFrame: origin.timelineStartFrame + origin.durationFrames
    },
    items,
    removedIds: [],
    createdIds: [],
    changedIds,
    shifts: [],
    warnings: []
  })
}

export function compileTimelineEditPlanOperations(
  beforeItems: readonly TimelineItem[],
  plan: TimelineEditPlan,
  maximum = TIMELINE_EDIT_LIMITS.maxOperationsPerCommit
): TimelineOperation[] {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > TIMELINE_EDIT_LIMITS.maxOperationsPerCommit) {
    invalid(`Timeline operation limit must be between 1 and ${TIMELINE_EDIT_LIMITS.maxOperationsPerCommit}`)
  }
  const before = uniqueItems(beforeItems, 'beforeItems')
  const after = uniqueItems(plan.items, 'plan.items')
  const deletes: TimelineOperation[] = []
  const updates: TimelineOperation[] = []
  const adds: TimelineOperation[] = []

  for (const [id, original] of before) {
    const next = after.get(id)
    if (!next) {
      deletes.push({ type: 'delete-item', itemId: id })
      continue
    }
    if (sameItem(original, next)) continue
    if (sameItemExceptPlacement(original, next)) {
      updates.push({
        type: 'move-item',
        itemId: id,
        trackId: next.trackId,
        timelineStartFrame: next.timelineStartFrame
      })
      continue
    }
    const properties = changedItemProperties(original, next)
    if (properties) {
      updates.push({ type: 'update-item-properties', itemId: id, ...properties })
      continue
    }
    if (isContainedTimelineRange(original, next) && sameItem(trimItemToTimelineRange(
      original,
      next.timelineStartFrame,
      next.timelineStartFrame + next.durationFrames
    ), next)) {
      updates.push({
        type: 'trim-item',
        itemId: id,
        startFrame: next.timelineStartFrame,
        endFrame: next.timelineStartFrame + next.durationFrames
      })
      continue
    }
    deletes.push({ type: 'delete-item', itemId: id })
    adds.push({ type: 'add-item', item: structuredClone(next) })
  }
  for (const [id, item] of after) {
    if (!before.has(id)) adds.push({ type: 'add-item', item: structuredClone(item) })
  }
  const operations = [...deletes, ...updates, ...adds]
  if (operations.length > maximum) {
    invalid(`Timeline edit requires ${operations.length} operations; the bounded limit is ${maximum}`)
  }
  return operations
}

export async function commitTimelineEditPlan(
  service: Pick<ProjectService, 'applyOperationsWithReceipt'>,
  input: {
    projectId: string
    expectedRevision: number
    beforeItems: readonly TimelineItem[]
    plan: TimelineEditPlan
    metadata: Omit<CommitMetadata, 'operations' | 'inverseOperations'>
  }
): ReturnType<ProjectService['applyOperationsWithReceipt']> {
  return await service.applyOperationsWithReceipt(
    input.projectId,
    input.expectedRevision,
    compileTimelineEditPlanOperations(input.beforeItems, input.plan),
    input.metadata
  )
}

export function trimItemToTimelineRange(
  item: TimelineItem,
  startFrame: number,
  endFrame: number
): TimelineItem {
  const range = editRange(startFrame, endFrame)
  const itemStart = item.timelineStartFrame
  const itemEnd = itemStart + item.durationFrames
  if (range.startFrame < itemStart || range.endFrame > itemEnd) {
    invalid(`Trim range is outside item ${item.id}`)
  }
  const sourceSpan = item.sourceEndUs - item.sourceStartUs
  const startRatio = (range.startFrame - itemStart) / item.durationFrames
  const endRatio = (range.endFrame - itemStart) / item.durationFrames
  return {
    ...structuredClone(item),
    timelineStartFrame: range.startFrame,
    durationFrames: range.endFrame - range.startFrame,
    sourceStartUs: item.sourceStartUs + Math.round(sourceSpan * startRatio),
    sourceEndUs: item.sourceStartUs + Math.round(sourceSpan * endRatio),
    fadeInFrames: Math.min(item.fadeInFrames, range.endFrame - range.startFrame),
    fadeOutFrames: Math.min(item.fadeOutFrames, range.endFrame - range.startFrame)
  }
}

function linkedClosure(itemId: string, groups: readonly LinkGroup[]): Set<string> {
  const result = new Set([itemId])
  let changed = true
  while (changed) {
    changed = false
    for (const group of groups) {
      if (!group.locked || !group.itemIds.some((id) => result.has(id))) continue
      for (const id of group.itemIds) {
        if (result.has(id)) continue
        result.add(id)
        changed = true
      }
    }
  }
  return result
}

function uniqueItems(items: readonly TimelineItem[], label: string): Map<string, TimelineItem> {
  const result = new Map<string, TimelineItem>()
  for (const item of items) {
    if (result.has(item.id)) invalid(`${label} contains duplicate item ${item.id}`)
    result.set(item.id, item)
  }
  return result
}

function sameItem(left: TimelineItem, right: TimelineItem): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right))
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonicalValue(entry)]))
}

function sameItemExceptPlacement(left: TimelineItem, right: TimelineItem): boolean {
  return sameItem(
    { ...left, trackId: '', timelineStartFrame: 0 },
    { ...right, trackId: '', timelineStartFrame: 0 }
  )
}

function isContainedTimelineRange(original: TimelineItem, next: TimelineItem): boolean {
  return original.trackId === next.trackId &&
    next.timelineStartFrame >= original.timelineStartFrame &&
    next.timelineStartFrame + next.durationFrames <= original.timelineStartFrame + original.durationFrames
}

function changedItemProperties(
  original: TimelineItem,
  next: TimelineItem
): Omit<UpdateItemPropertiesOperation, 'type' | 'itemId'> | undefined {
  const comparableOriginal = withoutItemProperties(original)
  const comparableNext = withoutItemProperties(next)
  if (!sameItem(comparableOriginal, comparableNext)) return undefined
  const patch: Omit<UpdateItemPropertiesOperation, 'type' | 'itemId'> = {}
  if ((original.volume ?? 1) !== (next.volume ?? 1)) patch.volume = next.volume ?? 1
  if (original.fadeInFrames !== next.fadeInFrames) patch.fadeInFrames = next.fadeInFrames
  if (original.fadeOutFrames !== next.fadeOutFrames) patch.fadeOutFrames = next.fadeOutFrames
  if ((original.muted ?? false) !== (next.muted ?? false)) patch.muted = next.muted ?? false
  if ((original.visible ?? true) !== (next.visible ?? true)) patch.visible = next.visible ?? true
  if ((original.locked ?? false) !== (next.locked ?? false)) patch.locked = next.locked ?? false
  return Object.keys(patch).length > 0 ? patch : undefined
}

function withoutItemProperties(item: TimelineItem): TimelineItem {
  const result = structuredClone(item)
  result.volume = 1
  result.fadeInFrames = 0
  result.fadeOutFrames = 0
  result.muted = false
  result.visible = true
  result.locked = false
  return result
}

function validatePropertiesPatch(
  patch: Omit<UpdateItemPropertiesOperation, 'type' | 'itemId'>
): void {
  if (Object.keys(patch).length === 0) invalid('Clip properties patch cannot be empty')
  if (patch.volume !== undefined && (!Number.isFinite(patch.volume) || patch.volume < 0 || patch.volume > 4)) {
    invalid('Clip volume must be between 0 and 4')
  }
  for (const [label, value] of [
    ['fadeInFrames', patch.fadeInFrames],
    ['fadeOutFrames', patch.fadeOutFrames]
  ] as const) {
    if (value !== undefined) frame(value, label)
  }
  for (const [label, value] of [
    ['muted', patch.muted],
    ['visible', patch.visible],
    ['locked', patch.locked]
  ] as const) {
    if (value !== undefined && typeof value !== 'boolean') invalid(`${label} must be boolean`)
  }
}

function finalizePlan(plan: TimelineEditPlan): TimelineEditPlan {
  plan.items.sort((left, right) =>
    left.trackId.localeCompare(right.trackId) || left.timelineStartFrame - right.timelineStartFrame ||
    left.id.localeCompare(right.id)
  )
  plan.removedIds = uniqueSorted(plan.removedIds)
  plan.createdIds = uniqueSorted(plan.createdIds)
  plan.changedIds = uniqueSorted(plan.changedIds)
  plan.shifts.sort((left, right) =>
    left.trackId.localeCompare(right.trackId) || left.fromFrame - right.fromFrame
  )
  return plan
}

function fragmentId(originId: string, fragment: 'left' | 'right'): string {
  const suffix = fragment === 'left' ? '~l' : '~r'
  return `${originId.slice(0, Math.max(1, 128 - suffix.length))}${suffix}`
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

function editRange(startFrame: number, endFrame: number): { startFrame: number; endFrame: number } {
  const start = frame(startFrame, 'startFrame')
  const end = frame(endFrame, 'endFrame')
  if (end <= start) invalid('Timeline edit range must be non-empty and half-open')
  return { startFrame: start, endFrame: end }
}

function overlaps(start: number, end: number, rangeStart: number, rangeEnd: number): boolean {
  return start < rangeEnd && end > rangeStart
}

function positiveFrame(value: number, label: string): number {
  const result = frame(value, label)
  if (result <= 0) invalid(`${label} must be positive`)
  return result
}

function frame(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a non-negative safe integer frame`)
  return value
}

function integer(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) invalid(`${label} must be a safe integer`)
  return value
}

function invalid(message: string): never {
  throw engineError('invalid_operation', message)
}
