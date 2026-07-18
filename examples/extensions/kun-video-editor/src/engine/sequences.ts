import { engineError } from './errors.js'
import {
  PROJECT_LIMITS,
  type Caption,
  type LinkGroup,
  type Rational,
  type Sequence,
  type TimelineItem,
  type TimelineOperation,
  type Track,
  type VideoProject
} from './schema.js'
import { framesToMicroseconds, microsecondsToFrames, normalizeRational } from './time.js'
import { trimKeyframeTrack } from './keyframes.js'
import { containsNullOrLineBreak } from '../text-safety.js'

export const SEQUENCE_EDIT_LIMITS = Object.freeze({
  nestingDepth: 8,
  decomposeItems: 2_000,
  decomposeCaptions: 2_000
})

export type SequenceSnapshot = {
  sequence: Sequence
  linkGroups: LinkGroup[]
}

export type NestedDurationPropagation = {
  project: VideoProject
  changedItemIds: string[]
  changedSequenceIds: string[]
}

export type DecomposeNestedSequencePlan = {
  parentSequenceId: string
  nestedSequenceId: string
  removedItemId: string
  items: TimelineItem[]
  captions: Caption[]
  operations: TimelineOperation[]
  warnings: Array<{ code: 'link-groups-not-copied'; count: number }>
}

export function sequenceDurationFrames(sequence: Pick<Sequence, 'items' | 'captions'>): number {
  return Math.max(
    0,
    ...sequence.items.map((item) => item.timelineStartFrame + item.durationFrames),
    ...sequence.captions.map((caption) => caption.endFrame)
  )
}

export function createEmptySequenceSnapshot(
  project: VideoProject,
  sequenceId: string,
  name: string
): SequenceSnapshot {
  boundedId(sequenceId, 'sequenceId')
  boundedName(name)
  if (project.sequences.length >= PROJECT_LIMITS.sequences) invalid('Sequence limit reached')
  if (project.sequences.some(({ id }) => id === sequenceId)) invalid(`Sequence already exists: ${sequenceId}`)
  const tracks: Track[] = [
    { id: derivedId(sequenceId, 'video-1'), name: 'Video 1', kind: 'video', order: 0, overlap: 'reject' },
    { id: derivedId(sequenceId, 'audio-1'), name: 'Audio 1', kind: 'audio', order: 1, overlap: 'mix' },
    { id: derivedId(sequenceId, 'captions-1'), name: 'Captions', kind: 'caption', order: 2, overlap: 'reject' }
  ]
  assertFreshIds(project, tracks.map(({ id }) => id), 'track')
  return {
    sequence: {
      id: sequenceId,
      name,
      tracks,
      items: [],
      captions: [],
      viewState: { zoom: 1, scrollFrame: 0, open: true }
    },
    linkGroups: []
  }
}

export function duplicateSequenceSnapshot(
  project: VideoProject,
  sourceSequenceId: string,
  sequenceId: string,
  name: string
): SequenceSnapshot {
  boundedId(sequenceId, 'sequenceId')
  boundedName(name)
  if (project.sequences.length >= PROJECT_LIMITS.sequences) invalid('Sequence limit reached')
  if (project.sequences.some(({ id }) => id === sequenceId)) invalid(`Sequence already exists: ${sequenceId}`)
  const source = requireSequence(project, sourceSequenceId)
  const trackIds = new Map(source.tracks.map((track) => [track.id, derivedId(sequenceId, `track-${track.id}`)]))
  const itemIds = new Map(source.items.map((item) => [item.id, derivedId(sequenceId, `item-${item.id}`)]))
  const captionIds = new Map(source.captions.map((caption) => [caption.id, derivedId(sequenceId, `caption-${caption.id}`)]))
  const sourceItemIds = new Set(source.items.map(({ id }) => id))
  const sourceGroups = project.linkGroups.filter((group) => group.itemIds.every((id) => sourceItemIds.has(id)))
  const groupIds = new Map(sourceGroups.map((group) => [group.id, derivedId(sequenceId, `link-${group.id}`)]))
  assertFreshIds(project, [...trackIds.values()], 'track')
  assertFreshIds(project, [...itemIds.values()], 'item')
  assertFreshIds(project, [...captionIds.values()], 'caption')
  assertFreshIds(project, [...groupIds.values()], 'link group')
  const linkGroups = sourceGroups.map((group): LinkGroup => ({
    ...structuredClone(group),
    id: groupIds.get(group.id)!,
    itemIds: group.itemIds.map((id) => itemIds.get(id)!)
  }))
  const sequence: Sequence = {
    id: sequenceId,
    name,
    tracks: source.tracks.map((track) => ({ ...structuredClone(track), id: trackIds.get(track.id)! })),
    items: source.items.map((item) => ({
      ...structuredClone(item),
      id: itemIds.get(item.id)!,
      trackId: trackIds.get(item.trackId)!,
      ...(item.linkGroupId && groupIds.has(item.linkGroupId)
        ? { linkGroupId: groupIds.get(item.linkGroupId)! }
        : { linkGroupId: undefined })
    })),
    captions: source.captions.map((caption) => ({
      ...structuredClone(caption),
      id: captionIds.get(caption.id)!,
      trackId: trackIds.get(caption.trackId)!
    })),
    viewState: { ...structuredClone(source.viewState), open: true }
  }
  return { sequence, linkGroups }
}

export function sequenceSnapshot(project: VideoProject, sequenceId: string): SequenceSnapshot {
  const sequence = structuredClone(requireSequence(project, sequenceId))
  const itemIds = new Set(sequence.items.map(({ id }) => id))
  return {
    sequence,
    linkGroups: structuredClone(project.linkGroups.filter((group) =>
      group.itemIds.every((itemId) => itemIds.has(itemId))
    ))
  }
}

export function assertSequenceDeleteSafe(project: VideoProject, sequenceId: string): void {
  const sequence = requireSequence(project, sequenceId)
  if (project.sequences.length <= 1) invalid('The final sequence cannot be deleted')
  if (project.activeSequenceId === sequenceId) invalid('The active sequence cannot be deleted')
  if (sequence.viewState.open) invalid('Close the sequence before deleting it')
  const parent = project.sequences.find((candidate) =>
    candidate.items.some(({ nestedSequenceId }) => nestedSequenceId === sequenceId)
  )
  if (parent) invalid(`Sequence ${sequenceId} is nested by ${parent.id}`)
}

export function assertSequenceNestAllowed(
  project: VideoProject,
  parentSequenceId: string,
  nestedSequenceId: string,
  maximumDepth = SEQUENCE_EDIT_LIMITS.nestingDepth
): void {
  requireSequence(project, parentSequenceId)
  requireSequence(project, nestedSequenceId)
  if (parentSequenceId === nestedSequenceId) invalid('A sequence cannot contain itself')
  if (!Number.isSafeInteger(maximumDepth) || maximumDepth < 1 || maximumDepth > 32) {
    invalid('Nesting depth limit is invalid')
  }
  const edges = new Map(project.sequences.map((sequence) => [
    sequence.id,
    new Set(sequence.items.flatMap(({ nestedSequenceId: child }) => child ? [child] : []))
  ]))
  edges.get(parentSequenceId)!.add(nestedSequenceId)
  const visiting = new Set<string>()
  const memo = new Map<string, number>()
  const depthFrom = (sequenceId: string): number => {
    if (visiting.has(sequenceId)) invalid('Nested sequence graph would contain a cycle')
    const retained = memo.get(sequenceId)
    if (retained !== undefined) return retained
    visiting.add(sequenceId)
    let depth = 0
    for (const child of edges.get(sequenceId) ?? []) depth = Math.max(depth, 1 + depthFrom(child))
    visiting.delete(sequenceId)
    if (depth > maximumDepth) invalid(`Nested sequence depth exceeds ${maximumDepth}`)
    memo.set(sequenceId, depth)
    return depth
  }
  for (const sequence of project.sequences) depthFrom(sequence.id)
}

export function planNestedSequenceItem(
  project: VideoProject,
  input: {
    parentSequenceId: string
    nestedSequenceId: string
    itemId: string
    trackId: string
    timelineStartFrame: number
    sourceStartFrame?: number
    sourceEndFrame?: number
    speed?: Rational
  }
): TimelineItem {
  assertSequenceNestAllowed(project, input.parentSequenceId, input.nestedSequenceId)
  boundedId(input.itemId, 'itemId')
  nonNegativeFrame(input.timelineStartFrame, 'timelineStartFrame')
  if (project.sequences.some((sequence) => sequence.items.some(({ id }) => id === input.itemId))) {
    invalid(`Timeline item already exists: ${input.itemId}`)
  }
  const parent = requireSequence(project, input.parentSequenceId)
  const track = parent.tracks.find(({ id }) => id === input.trackId)
  if (!track || track.kind !== 'video') invalid('Nested sequences require a video track')
  if (track.locked) invalid(`Timeline track is locked: ${track.id}`)
  const nested = requireSequence(project, input.nestedSequenceId)
  const nestedDuration = sequenceDurationFrames(nested)
  if (nestedDuration <= 0) invalid('An empty sequence cannot be nested')
  const sourceStartFrame = input.sourceStartFrame ?? 0
  const sourceEndFrame = input.sourceEndFrame ?? nestedDuration
  nonNegativeFrame(sourceStartFrame, 'sourceStartFrame')
  positiveFrame(sourceEndFrame, 'sourceEndFrame')
  if (sourceEndFrame <= sourceStartFrame || sourceEndFrame > nestedDuration) {
    invalid('Nested source range is outside the child sequence')
  }
  const speed = normalizeRational(input.speed ?? { numerator: 1, denominator: 1 })
  const sourceFrames = sourceEndFrame - sourceStartFrame
  const durationFrames = Math.max(1, Math.round(sourceFrames * speed.denominator / speed.numerator))
  return {
    id: input.itemId,
    // Kept for schema-v2 compatibility. Render and edit planners use nestedSequenceId.
    assetId: input.nestedSequenceId,
    nestedSequenceId: input.nestedSequenceId,
    trackId: track.id,
    timelineStartFrame: input.timelineStartFrame,
    durationFrames,
    sourceStartUs: framesToMicroseconds(sourceStartFrame, project.fps),
    sourceEndUs: framesToMicroseconds(sourceEndFrame, project.fps),
    speed,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    opacity: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0
  }
}

export function planOpenNestedSequence(item: TimelineItem): TimelineOperation[] {
  if (!item.nestedSequenceId) invalid(`Timeline item ${item.id} is not a nested sequence`)
  return [
    { type: 'open-sequence', sequenceId: item.nestedSequenceId },
    { type: 'select-sequence', sequenceId: item.nestedSequenceId }
  ]
}

export function planDecomposeNestedSequence(
  project: VideoProject,
  input: {
    parentSequenceId: string
    itemId: string
    trackMap: Readonly<Record<string, string>>
  }
): DecomposeNestedSequencePlan {
  const parent = requireSequence(project, input.parentSequenceId)
  const outer = parent.items.find(({ id }) => id === input.itemId)
  if (!outer?.nestedSequenceId) invalid(`Timeline item is not a nested sequence: ${input.itemId}`)
  if (!isNeutralNest(outer)) invalid('Bake or reset outer transforms, effects, keyframes, speed, and mix before decomposing')
  const nested = requireSequence(project, outer.nestedSequenceId)
  const sourceStartFrame = microsecondsToFrames(outer.sourceStartUs, project.fps)
  const sourceEndFrame = microsecondsToFrames(outer.sourceEndUs, project.fps)
  const parentTracks = new Map(parent.tracks.map((track) => [track.id, track]))
  const childTracks = new Map(nested.tracks.map((track) => [track.id, track]))
  const mapTrack = (trackId: string, expectedKind: Track['kind']): string => {
    const mappedId = input.trackMap[trackId]
    const mapped = mappedId ? parentTracks.get(mappedId) : undefined
    if (!mapped || mapped.kind !== expectedKind) {
      invalid(`Missing compatible parent track mapping for ${trackId}`)
    }
    return mapped.id
  }
  const items = nested.items
    .filter((item) => overlaps(item.timelineStartFrame, item.timelineStartFrame + item.durationFrames, sourceStartFrame, sourceEndFrame))
    .map((item) => {
      const childTrack = childTracks.get(item.trackId)
      if (!childTrack || childTrack.kind === 'caption') invalid(`Nested item ${item.id} has an invalid track`)
      const visibleStart = Math.max(item.timelineStartFrame, sourceStartFrame)
      const visibleEnd = Math.min(item.timelineStartFrame + item.durationFrames, sourceEndFrame)
      const trimmed = trimTimelineItem(project.fps, item, visibleStart, visibleEnd)
      return {
        ...trimmed,
        id: derivedId(outer.id, `decomposed-${item.id}`),
        trackId: mapTrack(item.trackId, childTrack.kind),
        timelineStartFrame: outer.timelineStartFrame + visibleStart - sourceStartFrame
      }
    })
  const captions = nested.captions
    .filter((caption) => overlaps(caption.startFrame, caption.endFrame, sourceStartFrame, sourceEndFrame))
    .map((caption) => ({
      ...structuredClone(caption),
      id: derivedId(outer.id, `decomposed-${caption.id}`),
      trackId: mapTrack(caption.trackId, 'caption'),
      startFrame: outer.timelineStartFrame + Math.max(caption.startFrame, sourceStartFrame) - sourceStartFrame,
      endFrame: outer.timelineStartFrame + Math.min(caption.endFrame, sourceEndFrame) - sourceStartFrame,
      words: caption.words?.flatMap((word) => {
        const startFrame = Math.max(word.startFrame, sourceStartFrame)
        const endFrame = Math.min(word.endFrame, sourceEndFrame)
        return endFrame <= startFrame ? [] : [{
          ...word,
          id: derivedId(outer.id, `decomposed-${word.id}`),
          startFrame: outer.timelineStartFrame + startFrame - sourceStartFrame,
          endFrame: outer.timelineStartFrame + endFrame - sourceStartFrame
        }]
      })
    }))
  if (items.length > SEQUENCE_EDIT_LIMITS.decomposeItems || captions.length > SEQUENCE_EDIT_LIMITS.decomposeCaptions) {
    invalid('Nested sequence decomposition exceeds its bounded operation limit')
  }
  const childIds = new Set(nested.items.map(({ id }) => id))
  const skippedLinks = project.linkGroups.filter((group) => group.itemIds.some((id) => childIds.has(id))).length
  return {
    parentSequenceId: parent.id,
    nestedSequenceId: nested.id,
    removedItemId: outer.id,
    items,
    captions,
    operations: [
      { type: 'delete-item', itemId: outer.id },
      ...items.map((item): TimelineOperation => ({ type: 'add-item', item })),
      ...captions.map((caption): TimelineOperation => ({ type: 'add-caption', caption }))
    ],
    warnings: skippedLinks > 0 ? [{ code: 'link-groups-not-copied', count: skippedLinks }] : []
  }
}

export function propagateNestedSequenceDuration(
  project: VideoProject,
  changedSequenceId: string,
  previousDurationFrames: number
): NestedDurationPropagation {
  nonNegativeFrame(previousDurationFrames, 'previousDurationFrames')
  const next = structuredClone(project)
  const changed = requireSequence(next, changedSequenceId)
  const queue: Array<{ sequenceId: string; before: number; after: number }> = [{
    sequenceId: changed.id,
    before: previousDurationFrames,
    after: sequenceDurationFrames(changed)
  }]
  const changedItemIds = new Set<string>()
  const changedSequenceIds = new Set<string>([changed.id])
  const processed = new Set<string>()
  while (queue.length > 0) {
    const current = queue.shift()!
    const key = `${current.sequenceId}:${current.before}:${current.after}`
    if (processed.has(key)) continue
    processed.add(key)
    const beforeUs = framesToMicroseconds(current.before, next.fps)
    const afterUs = framesToMicroseconds(current.after, next.fps)
    for (const parent of next.sequences) {
      const parentBefore = sequenceDurationFrames(parent)
      let parentChanged = false
      for (const item of parent.items) {
        if (item.nestedSequenceId !== current.sequenceId) continue
        const wasFullRange = item.sourceStartUs === 0 && item.sourceEndUs === beforeUs
        if (wasFullRange) {
          item.sourceEndUs = afterUs
        } else if (item.sourceEndUs > afterUs) {
          item.sourceEndUs = afterUs
        } else continue
        if (item.sourceEndUs <= item.sourceStartUs) invalid(`Nested duration change would empty item ${item.id}`)
        const sourceFrames = microsecondsToFrames(item.sourceEndUs - item.sourceStartUs, next.fps)
        item.durationFrames = Math.max(1, Math.round(sourceFrames * item.speed.denominator / item.speed.numerator))
        item.fadeInFrames = Math.min(item.fadeInFrames, item.durationFrames)
        item.fadeOutFrames = Math.min(item.fadeOutFrames, item.durationFrames - item.fadeInFrames)
        changedItemIds.add(item.id)
        parentChanged = true
      }
      if (!parentChanged) continue
      const parentAfter = sequenceDurationFrames(parent)
      changedSequenceIds.add(parent.id)
      if (parentAfter !== parentBefore) queue.push({ sequenceId: parent.id, before: parentBefore, after: parentAfter })
    }
  }
  const active = requireSequence(next, next.activeSequenceId)
  next.tracks = structuredClone(active.tracks)
  next.items = structuredClone(active.items)
  next.captions = structuredClone(active.captions)
  return {
    project: next,
    changedItemIds: [...changedItemIds].sort(),
    changedSequenceIds: [...changedSequenceIds].sort()
  }
}

function trimTimelineItem(fps: Rational, item: TimelineItem, startFrame: number, endFrame: number): TimelineItem {
  const startDelta = startFrame - item.timelineStartFrame
  const endDelta = item.timelineStartFrame + item.durationFrames - endFrame
  const speed = normalizeRational(item.speed)
  const sourceDelta = (frames: number): number => Math.round(
    framesToMicroseconds(frames, fps) * speed.numerator / speed.denominator
  )
  const durationFrames = endFrame - startFrame
  const fadeInFrames = Math.min(item.fadeInFrames, durationFrames)
  return {
    ...structuredClone(item),
    timelineStartFrame: startFrame,
    durationFrames,
    sourceStartUs: item.sourceStartUs + sourceDelta(startDelta),
    sourceEndUs: item.sourceEndUs - sourceDelta(endDelta),
    fadeInFrames,
    fadeOutFrames: Math.min(item.fadeOutFrames, durationFrames - fadeInFrames),
    ...(item.keyframes ? {
      keyframes: item.keyframes.map((track) =>
        trimKeyframeTrack(track, startDelta, item.durationFrames - endDelta, 'preserve-boundaries').track
      )
    } : {})
  }
}

function isNeutralNest(item: TimelineItem): boolean {
  return item.speed.numerator === item.speed.denominator &&
    item.transform.x === 0 && item.transform.y === 0 && item.transform.scaleX === 1 &&
    item.transform.scaleY === 1 && item.transform.rotation === 0 && item.opacity === 1 &&
    item.crop === undefined && (item.blendMode ?? 'normal') === 'normal' &&
    (item.volume ?? 1) === 1 && (item.effects?.length ?? 0) === 0 && (item.keyframes?.length ?? 0) === 0
}

function requireSequence(project: VideoProject, sequenceId: string): Sequence {
  const sequence = project.sequences.find(({ id }) => id === sequenceId)
  if (!sequence) invalid(`Sequence does not exist: ${sequenceId}`)
  return sequence
}

function assertFreshIds(project: VideoProject, ids: readonly string[], label: string): void {
  const existing = new Set<string>()
  for (const sequence of project.sequences) {
    if (label === 'track') sequence.tracks.forEach(({ id }) => existing.add(id))
    else if (label === 'item') sequence.items.forEach(({ id }) => existing.add(id))
    else if (label === 'caption') sequence.captions.forEach(({ id }) => existing.add(id))
  }
  if (label === 'link group') project.linkGroups.forEach(({ id }) => existing.add(id))
  const seen = new Set<string>()
  for (const id of ids) {
    if (existing.has(id) || seen.has(id)) invalid(`Duplicate ${label} identity: ${id}`)
    seen.add(id)
  }
}

function derivedId(base: string, suffix: string): string {
  const normalized = suffix.replace(/[^A-Za-z0-9._~-]/gu, '-').replace(/^-+/u, '') || 'copy'
  const marker = '~'
  return `${base.slice(0, Math.max(1, 128 - marker.length - normalized.length))}${marker}${normalized}`.slice(0, 128)
}

function overlaps(start: number, end: number, rangeStart: number, rangeEnd: number): boolean {
  return start < rangeEnd && rangeStart < end
}

function boundedId(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(value)) invalid(`${label} is invalid`)
}

function boundedName(value: string): void {
  if (!value.trim() || value.length > 160 || containsNullOrLineBreak(value)) invalid('Sequence name is invalid')
}

function nonNegativeFrame(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a non-negative frame`)
}

function positiveFrame(value: number, label: string): void {
  nonNegativeFrame(value, label)
  if (value === 0) invalid(`${label} must be positive`)
}

function invalid(message: string): never {
  throw engineError('invalid_operation', message)
}
