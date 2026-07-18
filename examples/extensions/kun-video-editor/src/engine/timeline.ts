import { engineError } from './errors.js'
import {
  MAX_PROJECT_HISTORY,
  TimelineOperationSchema,
  VideoProjectSchema,
  syncActiveSequenceProjection,
  type CanvasFit,
  type CanvasPreset,
  type MediaAsset,
  type Rational,
  type TimelineItem,
  type TimelineOperation,
  type Track,
  type VideoProject
} from './schema.js'
import { framesToMicroseconds, microsecondsToFrames, normalizeRational } from './time.js'
import {
  retimeKeyframeTrack,
  splitKeyframeTrack,
  trimKeyframeTrack,
  type KeyframeEditNote
} from './keyframes.js'
import { validateKeyframeProperty } from './effects.js'
import {
  assertSequenceDeleteSafe,
  createEmptySequenceSnapshot,
  duplicateSequenceSnapshot,
  propagateNestedSequenceDuration,
  sequenceDurationFrames,
  sequenceSnapshot
} from './sequences.js'
import {
  applyMulticamTransactionPreview,
  compileMulticamPlanTransaction,
  planMulticamAngleSwitch,
  planMulticamLayout,
  planMulticamMerge,
  validateMulticamGroup,
  type MulticamGroup,
  type MulticamPlan
} from './multicam.js'

export type TimelineValidationIssue = {
  path: string
  code: string
  message: string
}

export type ApplyOperationsResult = {
  project: VideoProject
  inverseOperations: TimelineOperation[]
  changedIds: string[]
  notes: TimelineOperationNote[]
}

export type TimelineOperationNote = {
  code: string
  messageKey: string
  severity: 'info' | 'warning'
  values?: Record<string, string | number>
}

export type AssetTimeRange = {
  assetId: string
  startUs: number
  endUs: number
  reason?: 'filler' | 'silence' | 'selection'
}

export const CANVAS_PRESETS: Readonly<Record<CanvasPreset, { width: number; height: number }>> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 }
}

export function projectDurationFrames(project: VideoProject): number {
  const itemEnd = project.items.reduce(
    (maximum, item) => Math.max(maximum, item.timelineStartFrame + item.durationFrames),
    0
  )
  const captionEnd = project.captions.reduce(
    (maximum, caption) => Math.max(maximum, caption.endFrame),
    0
  )
  return Math.max(itemEnd, captionEnd)
}

export function validateTimeline(project: VideoProject): TimelineValidationIssue[] {
  const issues: TimelineValidationIssue[] = []
  try {
    project = syncActiveSequenceProjection(project)
    VideoProjectSchema.parse(project)
  } catch (error) {
    issues.push({
      path: 'project',
      code: 'schema',
      message: error instanceof Error ? error.message : String(error)
    })
    return issues
  }

  unique(project.assets, 'assets', issues)
  unique(project.tracks, 'tracks', issues)
  unique(project.items, 'items', issues)
  unique(project.captions, 'captions', issues)
  unique(project.transcripts, 'transcripts', issues)
  unique(project.sequences, 'sequences', issues)
  unique(project.linkGroups, 'linkGroups', issues)
  unique(project.derivedReferences, 'derivedReferences', issues)
  unique(project.multicamGroups ?? [], 'multicamGroups', issues)

  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const tracks = new Map(project.tracks.map((track) => [track.id, track]))
  const transcriptIds = new Set(project.transcripts.map(({ id }) => id))

  project.assets.forEach((asset, index) => {
    for (const transcriptId of asset.transcriptIds) {
      if (!transcriptIds.has(transcriptId)) {
        issues.push(refIssue(`assets[${index}].transcriptIds`, `Missing transcript ${transcriptId}`))
      }
    }
    if (asset.kind === 'video' && asset.video === undefined) {
      issues.push(refIssue(`assets[${index}].video`, 'Video assets require probed video metadata'))
    }
  })

  project.transcripts.forEach((transcript, index) => {
    const asset = assets.get(transcript.assetId)
    if (!asset) {
      issues.push(refIssue(`transcripts[${index}].assetId`, `Missing asset ${transcript.assetId}`))
      return
    }
    let previousEnd = -1
    transcript.segments.forEach((segment, segmentIndex) => {
      if (segment.endUs > asset.durationUs) {
        issues.push(rangeIssue(
          `transcripts[${index}].segments[${segmentIndex}]`,
          'Transcript segment exceeds the source asset duration'
        ))
      }
      if (segment.startUs < previousEnd) {
        issues.push(rangeIssue(
          `transcripts[${index}].segments[${segmentIndex}]`,
          'Transcript segments must be ordered and non-overlapping'
        ))
      }
      previousEnd = segment.endUs
      for (const word of segment.words ?? []) {
        if (word.startUs < segment.startUs || word.endUs > segment.endUs || word.endUs <= word.startUs) {
          issues.push(rangeIssue(
            `transcripts[${index}].segments[${segmentIndex}].words`,
            'Transcript word timing must remain within its segment'
          ))
        }
      }
    })
  })

  project.items.forEach((item, index) => validateItemReferences(
    project,
    item,
    index,
    assets,
    tracks,
    issues
  ))

  project.captions.forEach((caption, index) => {
    const track = tracks.get(caption.trackId)
    if (!track || track.kind !== 'caption') {
      issues.push(refIssue(`captions[${index}].trackId`, 'Caption must reference a caption track'))
    }
    if (caption.endFrame > projectDurationFramesWithoutCaptions(project)) {
      issues.push(rangeIssue(`captions[${index}]`, 'Caption exceeds the composed media duration'))
    }
  })

  for (const track of project.tracks) validateTrackOverlap(project, track, issues)

  validateSequenceReferences(project, issues)
  validateSelectionReferences(project, issues)
  validateDerivedReferences(project, issues)

  const revisions = new Set(project.revisions.map(({ revision }) => revision))
  if (!revisions.has(project.currentRevision)) {
    issues.push(refIssue('currentRevision', 'The current revision has no metadata record'))
  }
  if (project.revisions.at(-1)?.revision !== project.currentRevision) {
    issues.push(rangeIssue('revisions', 'Revision metadata must end at the current revision'))
  }
  if (project.revisions.length > MAX_PROJECT_HISTORY + 1) {
    issues.push(rangeIssue('revisions', 'Revision metadata exceeds the bounded history window'))
  }
  if (project.eventGeneration < project.currentRevision) {
    issues.push(rangeIssue('eventGeneration', 'Event generation cannot trail the project revision'))
  }
  const revisionsByNumber = new Map(project.revisions.map((revision) => [revision.revision, revision]))
  for (const [index, entry] of project.agentUndoStack.entries()) {
    const revision = revisionsByNumber.get(entry.revision)
    if (
      !revision ||
      revision.author !== 'agent' ||
      revision.actorId !== entry.actorId ||
      revision.transactionId !== entry.transactionId
    ) {
      issues.push(refIssue(
        `agentUndoStack[${index}]`,
        `Agent undo entry does not identify its retained Agent transaction`
      ))
    }
  }
  return issues
}

export function assertValidTimeline(project: VideoProject): void {
  const issues = validateTimeline(project)
  if (issues.length > 0) {
    throw engineError('invalid_project', issues[0]!.message, { issues })
  }
}

export function applyTimelineOperations(
  source: VideoProject,
  operations: readonly TimelineOperation[]
): ApplyOperationsResult {
  assertValidTimeline(source)
  const previousSequenceDurations = new Map(
    source.sequences.map((sequence) => [sequence.id, sequenceDurationFrames(sequence)])
  )
  const project = structuredClone(source)
  const inverseOperations: TimelineOperation[] = []
  const changedIds = new Set<string>()
  const notes: TimelineOperationNote[] = []

  for (const unchecked of operations) {
    const operation = TimelineOperationSchema.parse(unchecked)
    const inverses = applyOne(project, operation, changedIds, notes)
    inverseOperations.unshift(...inverses)
  }
  sortProjectCollections(project)
  let synchronized = syncActiveSequenceProjection(project)
  const durationChangedSequenceIds = synchronized.sequences
    .filter((sequence) => {
      const previous = previousSequenceDurations.get(sequence.id)
      return previous !== undefined && previous !== sequenceDurationFrames(sequence)
    })
    .map(({ id }) => id)
    .sort()
  const propagatedItemIds = new Set<string>()
  const propagatedSequenceIds = new Set<string>()
  for (const sequenceId of durationChangedSequenceIds) {
    const previousDuration = previousSequenceDurations.get(sequenceId)
    if (previousDuration === undefined) continue
    const propagated = propagateNestedSequenceDuration(synchronized, sequenceId, previousDuration)
    synchronized = propagated.project
    propagated.changedItemIds.forEach((id) => {
      propagatedItemIds.add(id)
      changedIds.add(id)
    })
    propagated.changedSequenceIds.forEach((id) => {
      propagatedSequenceIds.add(id)
      changedIds.add(id)
    })
  }
  if (propagatedItemIds.size > 0) {
    notes.push({
      code: 'nested-duration-propagated',
      messageKey: 'video.receipt.nestedDurationPropagated',
      severity: 'info',
      values: {
        itemCount: propagatedItemIds.size,
        sequenceCount: propagatedSequenceIds.size
      }
    })
  }
  assertValidTimeline(synchronized)
  return { project: synchronized, inverseOperations, changedIds: [...changedIds].sort(), notes }
}

export function removeAssetTimeRanges(
  source: VideoProject,
  ranges: readonly AssetTimeRange[]
): { project: VideoProject; removed: AssetTimeRange[]; changedIds: string[] } {
  assertValidTimeline(source)
  const normalized = normalizeAssetRanges(source, ranges)
  const project = structuredClone(source)
  const changedIds = new Set<string>()

  for (const track of project.tracks) {
    const original = project.items
      .filter((item) => item.trackId === track.id)
      .sort(compareItems)
    if (original.length === 0) continue
    let removedBefore = 0
    const replacement: TimelineItem[] = []
    for (const item of original) {
      const cuts = normalized.filter((range) =>
        range.assetId === item.assetId &&
        range.startUs < item.sourceEndUs &&
        range.endUs > item.sourceStartUs
      )
      if (cuts.length === 0) {
        replacement.push({ ...item, timelineStartFrame: item.timelineStartFrame - removedBefore })
        continue
      }
      changedIds.add(item.id)
      const kept = subtractSourceRanges(item, cuts, project.fps)
      const originalEnd = item.timelineStartFrame + item.durationFrames
      let cursor = item.timelineStartFrame - removedBefore
      kept.forEach((part, index) => {
        const next = {
          ...part,
          id: kept.length === 1 ? item.id : `${item.id}-part-${index + 1}`,
          timelineStartFrame: cursor
        }
        replacement.push(next)
        changedIds.add(next.id)
        cursor += next.durationFrames
      })
      const removedFromItem = item.durationFrames - kept.reduce((sum, part) => sum + part.durationFrames, 0)
      removedBefore += removedFromItem
      // Preserve pre-existing gaps while rippling only the frames deleted by this edit.
      const expectedCursor = originalEnd - removedBefore
      if (cursor > expectedCursor) {
        throw engineError('invalid_operation', 'Transcript range conversion expanded a timeline item')
      }
    }
    project.items = [
      ...project.items.filter((item) => item.trackId !== track.id),
      ...replacement
    ]
  }

  sortProjectCollections(project)
  const synchronized = syncActiveSequenceProjection(project)
  assertValidTimeline(synchronized)
  return { project: synchronized, removed: normalized, changedIds: [...changedIds].sort() }
}

function applyOne(
  project: VideoProject,
  operation: TimelineOperation,
  changedIds: Set<string>,
  notes: TimelineOperationNote[]
): TimelineOperation[] {
  switch (operation.type) {
    case 'add-item': {
      if (project.items.some(({ id }) => id === operation.item.id)) duplicate(operation.item.id)
      const track = project.tracks.find(({ id }) => id === operation.item.trackId)
      if (track?.locked) throw engineError('invalid_operation', `Timeline track is locked: ${track.id}`)
      project.items.push(structuredClone(operation.item))
      changedIds.add(operation.item.id)
      return [{ type: 'delete-item', itemId: operation.item.id }]
    }
    case 'delete-item': {
      assertItemEditable(project, operation.itemId)
      const index = itemIndex(project, operation.itemId)
      const [removed] = project.items.splice(index, 1)
      changedIds.add(operation.itemId)
      return [{ type: 'add-item', item: removed! }]
    }
    case 'split-item': {
      assertItemEditable(project, operation.itemId)
      const index = itemIndex(project, operation.itemId)
      const original = project.items[index]!
      const relativeFrame = operation.atFrame - original.timelineStartFrame
      if (relativeFrame <= 0 || relativeFrame >= original.durationFrames) {
        throw engineError('invalid_operation', 'Split frame must be strictly inside the item')
      }
      const sourceSplit = original.sourceStartUs + sourceDeltaUs(relativeFrame, original.speed, project.fps)
      if (sourceSplit <= original.sourceStartUs || sourceSplit >= original.sourceEndUs) {
        throw engineError('invalid_operation', 'Split frame cannot be represented in the source range')
      }
      const leftKeyframes = original.keyframes?.map((track) => {
        const result = splitKeyframeTrack(track, relativeFrame, original.durationFrames)
        appendKeyframePolicyNotes(notes, original.id, 'split', [...result.left.notes, ...result.right.notes])
        return result.left.track
      })
      const rightKeyframes = original.keyframes?.map((track) =>
        splitKeyframeTrack(track, relativeFrame, original.durationFrames).right.track
      )
      const left: TimelineItem = {
        ...original,
        id: `${original.id}-part-1`,
        durationFrames: relativeFrame,
        sourceEndUs: sourceSplit,
        fadeInFrames: Math.min(original.fadeInFrames, relativeFrame),
        fadeOutFrames: 0,
        ...(leftKeyframes ? { keyframes: leftKeyframes } : {})
      }
      const right: TimelineItem = {
        ...original,
        id: `${original.id}-part-2`,
        timelineStartFrame: operation.atFrame,
        durationFrames: original.durationFrames - relativeFrame,
        sourceStartUs: sourceSplit,
        fadeInFrames: 0,
        fadeOutFrames: Math.min(original.fadeOutFrames, original.durationFrames - relativeFrame),
        ...(rightKeyframes ? { keyframes: rightKeyframes } : {})
      }
      project.items.splice(index, 1, left, right)
      changedIds.add(original.id)
      changedIds.add(left.id)
      changedIds.add(right.id)
      return [
        { type: 'delete-item', itemId: right.id },
        { type: 'delete-item', itemId: left.id },
        { type: 'add-item', item: original }
      ]
    }
    case 'trim-item': {
      assertItemEditable(project, operation.itemId)
      const index = itemIndex(project, operation.itemId)
      const original = project.items[index]!
      const originalEnd = original.timelineStartFrame + original.durationFrames
      if (
        operation.startFrame < original.timelineStartFrame ||
        operation.endFrame > originalEnd ||
        operation.endFrame <= operation.startFrame
      ) {
        throw engineError('invalid_operation', 'Trim range must be a positive range within the item')
      }
      const startDelta = operation.startFrame - original.timelineStartFrame
      const endDelta = originalEnd - operation.endFrame
      const durationFrames = operation.endFrame - operation.startFrame
      const fadeInFrames = Math.min(original.fadeInFrames, durationFrames)
      const keyframes = original.keyframes?.map((track) => {
        const result = trimKeyframeTrack(
          track,
          startDelta,
          original.durationFrames - endDelta,
          'preserve-boundaries'
        )
        appendKeyframePolicyNotes(notes, original.id, 'trim', result.notes)
        return result.track
      })
      project.items[index] = {
        ...original,
        timelineStartFrame: operation.startFrame,
        durationFrames,
        sourceStartUs: original.sourceStartUs + sourceDeltaUs(startDelta, original.speed, project.fps),
        sourceEndUs: original.sourceEndUs - sourceDeltaUs(endDelta, original.speed, project.fps),
        fadeInFrames,
        fadeOutFrames: Math.min(original.fadeOutFrames, durationFrames - fadeInFrames),
        ...(keyframes ? { keyframes } : {})
      }
      changedIds.add(original.id)
      return [
        { type: 'delete-item', itemId: original.id },
        { type: 'add-item', item: original }
      ]
    }
    case 'move-item': {
      assertItemEditable(project, operation.itemId)
      const index = itemIndex(project, operation.itemId)
      const original = project.items[index]!
      project.items[index] = {
        ...original,
        trackId: operation.trackId,
        timelineStartFrame: operation.timelineStartFrame
      }
      changedIds.add(original.id)
      return [{
        type: 'move-item',
        itemId: original.id,
        trackId: original.trackId,
        timelineStartFrame: original.timelineStartFrame
      }]
    }
    case 'reorder-item': {
      assertItemEditable(project, operation.itemId)
      const target = project.items[itemIndex(project, operation.itemId)]!
      const track = project.tracks.find(({ id }) => id === target.trackId)
      if (!track || track.overlap === 'mix') {
        throw engineError('invalid_operation', 'Reordering requires a non-overlapping track')
      }
      const ordered = project.items.filter(({ trackId }) => trackId === target.trackId).sort(compareItems)
      const previousMoves = ordered.map((item): TimelineOperation => ({
        type: 'move-item',
        itemId: item.id,
        trackId: item.trackId,
        timelineStartFrame: item.timelineStartFrame
      }))
      const withoutTarget = ordered.filter(({ id }) => id !== target.id)
      const insertion = operation.beforeItemId === undefined
        ? withoutTarget.length
        : withoutTarget.findIndex(({ id }) => id === operation.beforeItemId)
      if (insertion < 0) throw engineError('invalid_operation', 'Reorder target does not exist on the same track')
      withoutTarget.splice(insertion, 0, target)
      let cursor = Math.min(...ordered.map(({ timelineStartFrame }) => timelineStartFrame))
      for (const item of withoutTarget) {
        item.timelineStartFrame = cursor
        cursor += item.durationFrames
        changedIds.add(item.id)
      }
      return previousMoves
    }
    case 'update-transform': {
      assertItemEditable(project, operation.itemId)
      const index = itemIndex(project, operation.itemId)
      const original = project.items[index]!
      project.items[index] = {
        ...original,
        transform: { ...original.transform, ...operation.transform },
        opacity: operation.opacity ?? original.opacity
      }
      changedIds.add(original.id)
      return [{
        type: 'update-transform',
        itemId: original.id,
        transform: original.transform,
        opacity: original.opacity
      }]
    }
    case 'update-track-state': {
      const index = project.tracks.findIndex(({ id }) => id === operation.trackId)
      if (index < 0) missing(operation.trackId)
      const original = project.tracks[index]!
      project.tracks[index] = {
        ...original,
        ...(operation.muted !== undefined ? { muted: operation.muted } : {}),
        ...(operation.locked !== undefined ? { locked: operation.locked } : {}),
        ...(operation.syncLocked !== undefined ? { syncLocked: operation.syncLocked } : {})
      }
      changedIds.add(original.id)
      return [{
        type: 'update-track-state',
        trackId: original.id,
        muted: original.muted ?? false,
        locked: original.locked ?? false,
        syncLocked: original.syncLocked ?? false
      }]
    }
    case 'update-item-properties': {
      const index = itemIndex(project, operation.itemId)
      const original = project.items[index]!
      if (
        (original.locked || project.tracks.find(({ id }) => id === original.trackId)?.locked) &&
        operation.locked !== false
      ) {
        throw engineError('invalid_operation', `Timeline item is locked: ${original.id}`)
      }
      project.items[index] = {
        ...original,
        ...(operation.volume !== undefined ? { volume: operation.volume } : {}),
        ...(operation.fadeInFrames !== undefined ? { fadeInFrames: operation.fadeInFrames } : {}),
        ...(operation.fadeOutFrames !== undefined ? { fadeOutFrames: operation.fadeOutFrames } : {}),
        ...(operation.muted !== undefined ? { muted: operation.muted } : {}),
        ...(operation.visible !== undefined ? { visible: operation.visible } : {}),
        ...(operation.locked !== undefined ? { locked: operation.locked } : {})
      }
      changedIds.add(original.id)
      return [{
        type: 'update-item-properties',
        itemId: original.id,
        volume: original.volume ?? 1,
        fadeInFrames: original.fadeInFrames,
        fadeOutFrames: original.fadeOutFrames,
        muted: original.muted ?? false,
        visible: original.visible ?? true,
        locked: original.locked ?? false
      }]
    }
    case 'set-link-group': {
      const group = structuredClone(operation.group)
      const existingIndex = project.linkGroups.findIndex(({ id }) => id === group.id)
      const existing = existingIndex >= 0 ? structuredClone(project.linkGroups[existingIndex]!) : undefined
      for (const itemId of existing?.itemIds ?? []) assertItemEditable(project, itemId)
      for (const itemId of group.itemIds) {
        assertItemEditable(project, itemId)
        const item = project.items[itemIndex(project, itemId)]!
        if (item.linkGroupId && item.linkGroupId !== group.id) {
          throw engineError('invalid_operation', `Timeline item already belongs to link group ${item.linkGroupId}`)
        }
      }
      if (existing) {
        const retained = new Set(group.itemIds)
        for (const itemId of existing.itemIds) {
          if (retained.has(itemId)) continue
          const item = project.items[itemIndex(project, itemId)]!
          delete item.linkGroupId
          changedIds.add(item.id)
        }
        project.linkGroups[existingIndex] = group
      } else {
        project.linkGroups.push(group)
      }
      for (const itemId of group.itemIds) {
        project.items[itemIndex(project, itemId)]!.linkGroupId = group.id
        changedIds.add(itemId)
      }
      changedIds.add(group.id)
      return [existing
        ? { type: 'set-link-group', group: existing }
        : { type: 'delete-link-group', linkGroupId: group.id }]
    }
    case 'delete-link-group': {
      const index = project.linkGroups.findIndex(({ id }) => id === operation.linkGroupId)
      if (index < 0) missing(operation.linkGroupId)
      const [removed] = project.linkGroups.splice(index, 1)
      for (const itemId of removed!.itemIds) {
        assertItemEditable(project, itemId)
        const item = project.items[itemIndex(project, itemId)]!
        delete item.linkGroupId
        changedIds.add(item.id)
      }
      changedIds.add(operation.linkGroupId)
      return [{ type: 'set-link-group', group: removed! }]
    }
    case 'create-sequence': {
      const previousActiveId = project.activeSequenceId
      const snapshot = createEmptySequenceSnapshot(project, operation.sequenceId, operation.name)
      addSequenceSnapshot(project, snapshot.sequence, snapshot.linkGroups)
      changedIds.add(snapshot.sequence.id)
      if (operation.activate) activateSequence(project, snapshot.sequence.id, changedIds)
      return operation.activate
        ? [
            { type: 'select-sequence', sequenceId: previousActiveId },
            { type: 'close-sequence', sequenceId: snapshot.sequence.id },
            { type: 'delete-sequence', sequenceId: snapshot.sequence.id }
          ]
        : [
            { type: 'close-sequence', sequenceId: snapshot.sequence.id },
            { type: 'delete-sequence', sequenceId: snapshot.sequence.id }
          ]
    }
    case 'restore-sequence': {
      const previousActiveId = project.activeSequenceId
      addSequenceSnapshot(project, operation.sequence, operation.linkGroups)
      changedIds.add(operation.sequence.id)
      if (operation.activate) activateSequence(project, operation.sequence.id, changedIds)
      return operation.activate
        ? [
            { type: 'select-sequence', sequenceId: previousActiveId },
            { type: 'close-sequence', sequenceId: operation.sequence.id },
            { type: 'delete-sequence', sequenceId: operation.sequence.id }
          ]
        : [
            ...(operation.sequence.viewState.open
              ? [{ type: 'close-sequence' as const, sequenceId: operation.sequence.id }]
              : []),
            { type: 'delete-sequence', sequenceId: operation.sequence.id }
          ]
    }
    case 'duplicate-sequence': {
      const previousActiveId = project.activeSequenceId
      const snapshot = duplicateSequenceSnapshot(
        project,
        operation.sourceSequenceId,
        operation.sequenceId,
        operation.name
      )
      addSequenceSnapshot(project, snapshot.sequence, snapshot.linkGroups)
      snapshot.sequence.items.forEach(({ id }) => changedIds.add(id))
      snapshot.sequence.captions.forEach(({ id }) => changedIds.add(id))
      snapshot.linkGroups.forEach(({ id }) => changedIds.add(id))
      changedIds.add(snapshot.sequence.id)
      if (operation.activate) activateSequence(project, snapshot.sequence.id, changedIds)
      return operation.activate
        ? [
            { type: 'select-sequence', sequenceId: previousActiveId },
            { type: 'close-sequence', sequenceId: snapshot.sequence.id },
            { type: 'delete-sequence', sequenceId: snapshot.sequence.id }
          ]
        : [
            { type: 'close-sequence', sequenceId: snapshot.sequence.id },
            { type: 'delete-sequence', sequenceId: snapshot.sequence.id }
          ]
    }
    case 'rename-sequence': {
      const sequence = project.sequences.find(({ id }) => id === operation.sequenceId)
      if (!sequence) missing(operation.sequenceId)
      const previousName = sequence.name
      sequence.name = operation.name
      changedIds.add(sequence.id)
      return [{ type: 'rename-sequence', sequenceId: sequence.id, name: previousName }]
    }
    case 'select-sequence': {
      const previousActiveId = project.activeSequenceId
      if (previousActiveId === operation.sequenceId) return []
      activateSequence(project, operation.sequenceId, changedIds)
      return [{ type: 'select-sequence', sequenceId: previousActiveId }]
    }
    case 'open-sequence': {
      const sequence = project.sequences.find(({ id }) => id === operation.sequenceId)
      if (!sequence) missing(operation.sequenceId)
      if (sequence.viewState.open) return []
      sequence.viewState.open = true
      changedIds.add(sequence.id)
      return [{ type: 'close-sequence', sequenceId: sequence.id }]
    }
    case 'close-sequence': {
      const sequence = project.sequences.find(({ id }) => id === operation.sequenceId)
      if (!sequence) missing(operation.sequenceId)
      if (!sequence.viewState.open) return []
      const wasActive = project.activeSequenceId === sequence.id
      if (wasActive) {
        if (!operation.fallbackSequenceId || operation.fallbackSequenceId === sequence.id) {
          throw engineError('invalid_operation', 'Closing the active sequence requires an open fallback sequence')
        }
        activateSequence(project, operation.fallbackSequenceId, changedIds)
      }
      sequence.viewState.open = false
      changedIds.add(sequence.id)
      return wasActive
        ? [
            { type: 'open-sequence', sequenceId: sequence.id },
            { type: 'select-sequence', sequenceId: sequence.id }
          ]
        : [{ type: 'open-sequence', sequenceId: sequence.id }]
    }
    case 'delete-sequence': {
      const multicamOwner = (project.multicamGroups ?? []).find(
        ({ sequenceId }) => sequenceId === operation.sequenceId
      )
      if (multicamOwner) {
        throw engineError(
          'invalid_operation',
          `Sequence ${operation.sequenceId} still owns multicam group ${multicamOwner.id}`
        )
      }
      assertSequenceDeleteSafe(project, operation.sequenceId)
      const snapshot = sequenceSnapshot(project, operation.sequenceId)
      const sequenceItemIds = new Set(snapshot.sequence.items.map(({ id }) => id))
      project.sequences = project.sequences.filter(({ id }) => id !== operation.sequenceId)
      project.linkGroups = project.linkGroups.filter((group) =>
        !group.itemIds.every((itemId) => sequenceItemIds.has(itemId))
      )
      snapshot.sequence.items.forEach(({ id }) => changedIds.add(id))
      snapshot.sequence.captions.forEach(({ id }) => changedIds.add(id))
      snapshot.linkGroups.forEach(({ id }) => changedIds.add(id))
      changedIds.add(snapshot.sequence.id)
      return [{
        type: 'restore-sequence',
        sequence: snapshot.sequence,
        linkGroups: snapshot.linkGroups,
        activate: false
      }]
    }
    case 'set-sequence-view': {
      const sequence = project.sequences.find(({ id }) => id === operation.sequenceId)
      if (!sequence) missing(operation.sequenceId)
      const previous = structuredClone(sequence.viewState)
      sequence.viewState.zoom = operation.zoom
      sequence.viewState.scrollFrame = operation.scrollFrame
      changedIds.add(sequence.id)
      return [{
        type: 'set-sequence-view',
        sequenceId: sequence.id,
        zoom: previous.zoom,
        scrollFrame: previous.scrollFrame
      }]
    }
    case 'set-item-keyframes': {
      assertItemEditable(project, operation.itemId)
      const index = itemIndex(project, operation.itemId)
      const original = project.items[index]!
      const properties = new Set<string>()
      for (const track of operation.keyframes) {
        validateKeyframeProperty(original, track)
        if (properties.has(track.property)) {
          throw engineError('invalid_operation', `Duplicate keyframe property: ${track.property}`)
        }
        if (track.points.some(({ frame }) => frame > original.durationFrames)) {
          throw engineError('invalid_operation', `Keyframe track exceeds item duration: ${track.id}`)
        }
        properties.add(track.property)
      }
      const previous = structuredClone(original.keyframes ?? [])
      project.items[index] = { ...original, keyframes: structuredClone(operation.keyframes) }
      changedIds.add(original.id)
      return [{ type: 'set-item-keyframes', itemId: original.id, keyframes: previous }]
    }
    case 'set-item-effects': {
      assertItemEditable(project, operation.itemId)
      const index = itemIndex(project, operation.itemId)
      const original = project.items[index]!
      const previous = structuredClone(original.effects ?? [])
      const replacement = { ...original, effects: structuredClone(operation.effects) }
      for (const track of replacement.keyframes ?? []) validateKeyframeProperty(replacement, track)
      project.items[index] = replacement
      changedIds.add(original.id)
      return [{ type: 'set-item-effects', itemId: original.id, effects: previous }]
    }
    case 'update-item-composition': {
      assertItemEditable(project, operation.itemId)
      const index = itemIndex(project, operation.itemId)
      const original = project.items[index]!
      project.items[index] = {
        ...original,
        ...(operation.crop !== undefined ? { crop: structuredClone(operation.crop) } : {}),
        ...(operation.opacity !== undefined ? { opacity: operation.opacity } : {}),
        ...(operation.blendMode !== undefined ? { blendMode: operation.blendMode } : {})
      }
      changedIds.add(original.id)
      return [{
        type: 'update-item-composition',
        itemId: original.id,
        crop: structuredClone(original.crop ?? { left: 0, top: 0, right: 0, bottom: 0 }),
        opacity: original.opacity,
        blendMode: original.blendMode ?? 'normal'
      }]
    }
    case 'retime-item': {
      assertItemEditable(project, operation.itemId)
      const index = itemIndex(project, operation.itemId)
      const original = project.items[index]!
      const speed = normalizeRational(operation.speed)
      const durationFrames = sourceUsToTimelineFrames(
        original.sourceEndUs - original.sourceStartUs,
        speed,
        project.fps
      )
      if (durationFrames <= 0) throw engineError('invalid_operation', 'Retime would empty the timeline item')
      const keyframes = original.keyframes?.map((track) => {
        const result = retimeKeyframeTrack(track, original.durationFrames, durationFrames)
        appendKeyframePolicyNotes(notes, original.id, 'retime', result.notes)
        return result.track
      })
      project.items[index] = {
        ...original,
        speed,
        durationFrames,
        fadeInFrames: Math.min(original.fadeInFrames, durationFrames),
        fadeOutFrames: Math.min(original.fadeOutFrames, Math.max(0, durationFrames - original.fadeInFrames)),
        ...(keyframes ? { keyframes } : {})
      }
      changedIds.add(original.id)
      return [{ type: 'retime-item', itemId: original.id, speed: original.speed }]
    }
    case 'add-caption': {
      if (project.captions.some(({ id }) => id === operation.caption.id)) duplicate(operation.caption.id)
      project.captions.push(structuredClone(operation.caption))
      changedIds.add(operation.caption.id)
      return [{ type: 'delete-caption', captionId: operation.caption.id }]
    }
    case 'update-caption': {
      const index = project.captions.findIndex(({ id }) => id === operation.captionId)
      if (index < 0) missing(operation.captionId)
      const original = project.captions[index]!
      project.captions[index] = { ...original, ...structuredClone(operation.patch), id: original.id }
      changedIds.add(original.id)
      return [{ type: 'update-caption', captionId: original.id, patch: original }]
    }
    case 'delete-caption': {
      const index = project.captions.findIndex(({ id }) => id === operation.captionId)
      if (index < 0) missing(operation.captionId)
      const [removed] = project.captions.splice(index, 1)
      changedIds.add(operation.captionId)
      return [{ type: 'add-caption', caption: removed! }]
    }
    case 'set-canvas': {
      const previousPreset = project.canvas.preset
      const previousFit = project.canvas.fit
      const dimensions = CANVAS_PRESETS[operation.preset]
      project.canvas = { ...project.canvas, ...dimensions, preset: operation.preset, fit: operation.fit }
      changedIds.add('canvas')
      return [{ type: 'set-canvas', preset: previousPreset, fit: previousFit }]
    }
    case 'set-multicam-group': {
      const group = structuredClone(validateMulticamGroup(operation.group)) as MulticamGroup
      const groups = project.multicamGroups ?? (project.multicamGroups = [])
      const index = groups.findIndex(({ id }) => id === group.id)
      const previous = index < 0 ? undefined : structuredClone(groups[index]!)
      if (index < 0) groups.push(group)
      else groups[index] = group
      changedIds.add(group.id)
      group.programFragments.forEach(({ id }) => changedIds.add(id))
      return [previous
        ? { type: 'set-multicam-group', group: previous }
        : { type: 'delete-multicam-group', groupId: group.id }]
    }
    case 'delete-multicam-group': {
      const groups = project.multicamGroups ?? []
      const index = groups.findIndex(({ id }) => id === operation.groupId)
      if (index < 0) missing(operation.groupId)
      const [removed] = groups.splice(index, 1)
      changedIds.add(operation.groupId)
      removed!.programFragments.forEach(({ id }) => changedIds.add(id))
      return [{ type: 'set-multicam-group', group: removed! }]
    }
    case 'switch-multicam-angle': {
      const group = multicamGroup(project, operation.groupId)
      const plan = planMulticamAngleSwitch({
        group,
        memberId: operation.memberId,
        requestedRange: { startFrame: operation.startFrame, endFrame: operation.endFrame },
        ...(operation.coveragePolicy ? { coveragePolicy: operation.coveragePolicy } : {}),
        ...(operation.minimumSyncConfidence === undefined
          ? {}
          : { minimumSyncConfidence: operation.minimumSyncConfidence })
      })
      return applyMulticamPlan(project, group, plan, changedIds, notes)
    }
    case 'apply-multicam-layout': {
      const group = multicamGroup(project, operation.groupId)
      const plan = planMulticamLayout({
        group,
        layoutId: operation.layoutId,
        requestedRange: { startFrame: operation.startFrame, endFrame: operation.endFrame },
        ...(operation.coveragePolicy ? { coveragePolicy: operation.coveragePolicy } : {}),
        ...(operation.minimumSyncConfidence === undefined
          ? {}
          : { minimumSyncConfidence: operation.minimumSyncConfidence })
      })
      return applyMulticamPlan(project, group, plan, changedIds, notes)
    }
    case 'merge-multicam-program': {
      const group = multicamGroup(project, operation.groupId)
      return applyMulticamPlan(project, group, planMulticamMerge(group), changedIds, notes)
    }
  }
}

function multicamGroup(project: VideoProject, groupId: string): MulticamGroup {
  const group = (project.multicamGroups ?? []).find(({ id }) => id === groupId)
  if (!group) missing(groupId)
  return structuredClone(group!)
}

function applyMulticamPlan(
  project: VideoProject,
  group: MulticamGroup,
  plan: Readonly<MulticamPlan>,
  changedIds: Set<string>,
  notes: TimelineOperationNote[]
): TimelineOperation[] {
  if (plan.outcome !== 'ready' || plan.refusal) {
    throw engineError('invalid_operation', plan.refusal?.message ?? 'Multicam plan was refused', {
      groupId: group.id,
      planId: plan.id,
      refusal: plan.refusal,
      requestedRange: plan.requestedRange,
      uncoveredRanges: plan.uncoveredRanges,
      limitingMemberIds: plan.limitingMemberIds
    })
  }
  const transaction = compileMulticamPlanTransaction({
    projectId: project.id,
    expectedRevision: project.currentRevision,
    group,
    plan: plan as MulticamPlan
  })
  const applied = applyMulticamTransactionPreview({
    projectId: project.id,
    sequenceId: group.sequenceId,
    currentRevision: project.currentRevision,
    group,
    transaction
  })
  const groups = project.multicamGroups ?? (project.multicamGroups = [])
  const index = groups.findIndex(({ id }) => id === group.id)
  if (index < 0) missing(group.id)
  groups[index] = structuredClone(applied.group) as MulticamGroup
  changedIds.add(group.id)
  for (const id of [
    ...transaction.receiptEvidence.createdFragmentIds,
    ...transaction.receiptEvidence.changedFragmentIds,
    ...transaction.receiptEvidence.removedFragmentIds
  ]) changedIds.add(id)
  notes.push({
    code: `multicam_${plan.kind.replaceAll('-', '_')}`,
    messageKey: 'video.receipt.multicamProgramChanged',
    severity: plan.uncoveredRanges.length > 0 ? 'warning' : 'info',
    values: {
      planId: plan.id,
      groupId: group.id,
      requestedStartFrame: plan.requestedRange.startFrame,
      requestedEndFrame: plan.requestedRange.endFrame,
      appliedRangeCount: plan.appliedRanges.length,
      uncoveredRangeCount: plan.uncoveredRanges.length,
      limitingAngles: transaction.receiptEvidence.limitingAngles
        .map(({ angleLabel }) => angleLabel)
        .join(', ') || 'none'
    }
  })
  return [{ type: 'set-multicam-group', group: structuredClone(group) }]
}

function assertItemEditable(project: VideoProject, itemId: string): void {
  const item = project.items[itemIndex(project, itemId)]!
  const track = project.tracks.find(({ id }) => id === item.trackId)
  if (item.locked) throw engineError('invalid_operation', `Timeline item is locked: ${item.id}`)
  if (track?.locked) throw engineError('invalid_operation', `Timeline track is locked: ${track.id}`)
}

function appendKeyframePolicyNotes(
  target: TimelineOperationNote[],
  itemId: string,
  operation: 'split' | 'trim' | 'retime',
  notes: readonly KeyframeEditNote[]
): void {
  const counts = new Map<KeyframeEditNote['code'], number>()
  for (const note of notes) counts.set(note.code, (counts.get(note.code) ?? 0) + note.count)
  for (const [policy, count] of [...counts].sort(([left], [right]) => left.localeCompare(right))) {
    target.push({
      code: `keyframe_${policy}`,
      messageKey: 'video.receipt.keyframePolicy',
      severity: policy.startsWith('dropped-') || policy === 'deduplicated' ? 'warning' : 'info',
      values: { itemId, operation, policy, count }
    })
  }
}

function addSequenceSnapshot(
  project: VideoProject,
  sequence: VideoProject['sequences'][number],
  linkGroups: VideoProject['linkGroups']
): void {
  if (project.sequences.some(({ id }) => id === sequence.id)) duplicate(sequence.id)
  const existingGroupIds = new Set(project.linkGroups.map(({ id }) => id))
  for (const group of linkGroups) {
    if (existingGroupIds.has(group.id)) duplicate(group.id)
    existingGroupIds.add(group.id)
  }
  project.sequences.push(structuredClone(sequence))
  project.linkGroups.push(...structuredClone(linkGroups))
}

function activateSequence(project: VideoProject, sequenceId: string, changedIds: Set<string>): void {
  const current = project.sequences.find(({ id }) => id === project.activeSequenceId)
  const target = project.sequences.find(({ id }) => id === sequenceId)
  if (!current || !target) missing(sequenceId)
  if (!target.viewState.open) {
    throw engineError('invalid_operation', `Sequence must be open before selection: ${sequenceId}`)
  }
  current.tracks = structuredClone(project.tracks)
  current.items = structuredClone(project.items)
  current.captions = structuredClone(project.captions)
  project.activeSequenceId = target.id
  project.tracks = structuredClone(target.tracks)
  project.items = structuredClone(target.items)
  project.captions = structuredClone(target.captions)
  project.selection = {
    ...project.selection,
    generation: project.selection.generation + 1,
    sequenceId: target.id,
    playheadFrame: 0,
    selectedItemIds: [],
    selectedCaptionIds: [],
    selectedWordIds: [],
    range: undefined
  }
  changedIds.add(current.id)
  changedIds.add(target.id)
}

function validateItemReferences(
  project: VideoProject,
  item: TimelineItem,
  index: number,
  assets: ReadonlyMap<string, MediaAsset>,
  tracks: ReadonlyMap<string, Track>,
  issues: TimelineValidationIssue[]
): void {
  const asset = item.nestedSequenceId ? undefined : assets.get(item.assetId)
  const track = tracks.get(item.trackId)
  if (!item.nestedSequenceId && !asset) {
    issues.push(refIssue(`items[${index}].assetId`, `Missing asset ${item.assetId}`))
  }
  if (!track) issues.push(refIssue(`items[${index}].trackId`, `Missing track ${item.trackId}`))
  if (track?.kind === 'caption') {
    issues.push(refIssue(`items[${index}].trackId`, 'Media items cannot be placed on caption tracks'))
  }
  if (
    track?.kind === 'video' && !item.nestedSequenceId &&
    asset?.kind !== 'video' && asset?.kind !== 'image' && asset?.kind !== 'animation'
  ) {
    issues.push(refIssue(`items[${index}]`, 'Only visual media can be placed on a video track'))
  }
  if (item.nestedSequenceId && track?.kind !== 'video') {
    issues.push(refIssue(`items[${index}]`, 'Nested sequences must be placed on a video track'))
  }
  if (track?.kind === 'audio' && !item.nestedSequenceId && asset?.audio === undefined) {
    issues.push(refIssue(`items[${index}]`, 'Audio tracks require a source with audio'))
  }
  if (!item.nestedSequenceId && item.sourceEndUs > (asset?.durationUs ?? 0)) {
    issues.push(rangeIssue(`items[${index}]`, 'Item source range exceeds the asset duration'))
  }
  if (item.fadeInFrames + item.fadeOutFrames > item.durationFrames) {
    issues.push(rangeIssue(`items[${index}]`, 'Item fades exceed its duration'))
  }
  const keyframeProperties = new Set<string>()
  for (const keyframes of item.keyframes ?? []) {
    if (keyframeProperties.has(keyframes.property)) {
      issues.push(rangeIssue(`items[${index}].keyframes`, `Duplicate keyframe property ${keyframes.property}`))
    }
    keyframeProperties.add(keyframes.property)
    if (keyframes.points.some(({ frame }) => frame > item.durationFrames)) {
      issues.push(rangeIssue(`items[${index}].keyframes`, `Keyframe track ${keyframes.id} exceeds item duration`))
    }
    try {
      validateKeyframeProperty(item, keyframes)
    } catch (error) {
      issues.push(rangeIssue(
        `items[${index}].keyframes`,
        error instanceof Error ? error.message : `Invalid keyframe property ${keyframes.property}`
      ))
    }
  }
  const expected = sourceDeltaUs(item.durationFrames, item.speed, project.fps)
  const actual = item.sourceEndUs - item.sourceStartUs
  const tolerance = Math.max(1, framesToMicroseconds(1, project.fps))
  if (Math.abs(expected - actual) > tolerance) {
    issues.push(rangeIssue(`items[${index}]`, 'Item source and timeline durations do not agree'))
  }
}

function validateTrackOverlap(
  project: VideoProject,
  track: Track,
  issues: TimelineValidationIssue[]
): void {
  if (track.overlap === 'mix') return
  const ordered = project.items.filter(({ trackId }) => trackId === track.id).sort(compareItems)
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!
    const current = ordered[index]!
    if (previous.timelineStartFrame + previous.durationFrames > current.timelineStartFrame) {
      issues.push({
        path: `tracks.${track.id}`,
        code: 'overlap',
        message: `Items ${previous.id} and ${current.id} overlap on track ${track.id}`
      })
    }
  }
}

function validateSequenceReferences(
  project: VideoProject,
  issues: TimelineValidationIssue[]
): void {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const sequences = new Map(project.sequences.map((sequence) => [sequence.id, sequence]))
  const allItems = new Map<string, { sequenceId: string; item: TimelineItem }>()
  const allTracks = new Map<string, string>()
  const allCaptions = new Map<string, string>()
  for (const [sequenceIndex, sequence] of project.sequences.entries()) {
    unique(sequence.tracks, `sequences[${sequenceIndex}].tracks`, issues)
    unique(sequence.items, `sequences[${sequenceIndex}].items`, issues)
    unique(sequence.captions, `sequences[${sequenceIndex}].captions`, issues)
    const tracks = new Map(sequence.tracks.map((track) => [track.id, track]))
    for (const track of sequence.tracks) {
      const owner = allTracks.get(track.id)
      if (owner) {
        issues.push(refIssue(
          `sequences[${sequenceIndex}].tracks`,
          `Track identity ${track.id} is already used by sequence ${owner}`
        ))
      } else allTracks.set(track.id, sequence.id)
    }
    for (const [itemIndex, item] of sequence.items.entries()) {
      const existing = allItems.get(item.id)
      if (existing) {
        issues.push(refIssue(
          `sequences[${sequenceIndex}].items[${itemIndex}].id`,
          `Item identity ${item.id} is already used by sequence ${existing.sequenceId}`
        ))
      } else {
        allItems.set(item.id, { sequenceId: sequence.id, item })
      }
      validateItemReferences(project, item, itemIndex, assets, tracks, issues)
      if (item.nestedSequenceId !== undefined && !sequences.has(item.nestedSequenceId)) {
        issues.push(refIssue(
          `sequences[${sequenceIndex}].items[${itemIndex}].nestedSequenceId`,
          `Missing nested sequence ${item.nestedSequenceId}`
        ))
      } else if (item.nestedSequenceId !== undefined) {
        const nested = sequences.get(item.nestedSequenceId)!
        const nestedDuration = sequenceDurationFramesForValidation(nested)
        const nestedDurationUs = framesToMicroseconds(nestedDuration, project.fps)
        if (item.sourceEndUs > nestedDurationUs) {
          issues.push(rangeIssue(
            `sequences[${sequenceIndex}].items[${itemIndex}]`,
            `Nested item exceeds sequence ${nested.id} duration`
          ))
        }
      }
    }
    for (const [captionIndex, caption] of sequence.captions.entries()) {
      const owner = allCaptions.get(caption.id)
      if (owner) {
        issues.push(refIssue(
          `sequences[${sequenceIndex}].captions[${captionIndex}].id`,
          `Caption identity ${caption.id} is already used by sequence ${owner}`
        ))
      } else allCaptions.set(caption.id, sequence.id)
      if (tracks.get(caption.trackId)?.kind !== 'caption') {
        issues.push(refIssue(
          `sequences[${sequenceIndex}].captions[${captionIndex}].trackId`,
          'Caption must reference a caption track in its sequence'
        ))
      }
    }
  }

  for (const [groupIndex, group] of project.linkGroups.entries()) {
    const members = new Set(group.itemIds)
    if (members.size !== group.itemIds.length) {
      issues.push(refIssue(`linkGroups[${groupIndex}].itemIds`, 'Link groups cannot contain duplicate items'))
    }
    let ownerSequenceId: string | undefined
    for (const itemId of group.itemIds) {
      const entry = allItems.get(itemId)
      if (!entry) {
        issues.push(refIssue(`linkGroups[${groupIndex}].itemIds`, `Missing linked item ${itemId}`))
      } else if (entry.item.linkGroupId !== group.id) {
        issues.push(refIssue(
          `linkGroups[${groupIndex}].itemIds`,
          `Linked item ${itemId} does not reference group ${group.id}`
        ))
      } else if (ownerSequenceId !== undefined && entry.sequenceId !== ownerSequenceId) {
        issues.push(refIssue(
          `linkGroups[${groupIndex}].itemIds`,
          `Link group ${group.id} cannot cross sequence boundaries`
        ))
      } else {
        ownerSequenceId = entry.sequenceId
      }
    }
  }
  for (const { item } of allItems.values()) {
    if (item.linkGroupId && !project.linkGroups.some(({ id }) => id === item.linkGroupId)) {
      issues.push(refIssue('items.linkGroupId', `Missing link group ${item.linkGroupId}`))
    }
  }
  validateNoSequenceCycles(project, sequences, issues)
}

function validateNoSequenceCycles(
  project: VideoProject,
  sequences: ReadonlyMap<string, VideoProject['sequences'][number]>,
  issues: TimelineValidationIssue[]
): void {
  const maximumDepth = 8
  const visiting = new Set<string>()
  const memo = new Map<string, number>()
  const depthFrom = (sequenceId: string): number | undefined => {
    if (visiting.has(sequenceId)) return undefined
    const retained = memo.get(sequenceId)
    if (retained !== undefined) return retained
    visiting.add(sequenceId)
    const sequence = sequences.get(sequenceId)
    let depth = 0
    for (const item of sequence?.items ?? []) {
      if (!item.nestedSequenceId) continue
      const childDepth = depthFrom(item.nestedSequenceId)
      if (childDepth === undefined) return undefined
      depth = Math.max(depth, 1 + childDepth)
    }
    visiting.delete(sequenceId)
    memo.set(sequenceId, depth)
    return depth
  }
  for (const sequence of project.sequences) {
    const depth = depthFrom(sequence.id)
    if (depth === undefined) {
      issues.push(refIssue(`sequences.${sequence.id}`, 'Nested sequence graph contains a cycle'))
      return
    }
    if (depth > maximumDepth) {
      issues.push(rangeIssue(`sequences.${sequence.id}`, `Nested sequence depth exceeds ${maximumDepth}`))
      return
    }
  }
}

function sequenceDurationFramesForValidation(sequence: VideoProject['sequences'][number]): number {
  return Math.max(
    0,
    ...sequence.items.map((item) => item.timelineStartFrame + item.durationFrames),
    ...sequence.captions.map((caption) => caption.endFrame)
  )
}

function validateSelectionReferences(
  project: VideoProject,
  issues: TimelineValidationIssue[]
): void {
  const sequence = project.sequences.find(({ id }) => id === project.selection.sequenceId)
  if (!sequence) return
  const references: Array<[readonly string[], Set<string>, string]> = [
    [project.selection.selectedAssetIds, new Set(project.assets.map(({ id }) => id)), 'selectedAssetIds'],
    [project.selection.selectedItemIds, new Set(sequence.items.map(({ id }) => id)), 'selectedItemIds'],
    [project.selection.selectedCaptionIds, new Set(sequence.captions.map(({ id }) => id)), 'selectedCaptionIds'],
    [
      project.selection.selectedWordIds,
      new Set(project.transcripts.flatMap((transcript) =>
        transcript.segments.flatMap((segment) => (segment.words ?? []).map(({ id }) => id))
      )),
      'selectedWordIds'
    ]
  ]
  for (const [ids, valid, key] of references) {
    for (const id of ids) {
      if (!valid.has(id)) issues.push(refIssue(`selection.${key}`, `Missing selected identity ${id}`))
    }
  }
  if (project.selection.revision > project.currentRevision) {
    issues.push(rangeIssue('selection.revision', 'Selection cannot target a future project revision'))
  }
}

function validateDerivedReferences(
  project: VideoProject,
  issues: TimelineValidationIssue[]
): void {
  const assetIds = new Set(project.assets.map(({ id }) => id))
  const derivedIds = new Set(project.derivedReferences.map(({ id }) => id))
  for (const [index, reference] of project.derivedReferences.entries()) {
    if (reference.sourceAssetId && !assetIds.has(reference.sourceAssetId)) {
      issues.push(refIssue(`derivedReferences[${index}].sourceAssetId`, `Missing asset ${reference.sourceAssetId}`))
    }
    for (const dependencyId of reference.dependencyIds) {
      if (!derivedIds.has(dependencyId)) {
        issues.push(refIssue(`derivedReferences[${index}].dependencyIds`, `Missing derived dependency ${dependencyId}`))
      }
    }
  }
}

function normalizeAssetRanges(project: VideoProject, ranges: readonly AssetTimeRange[]): AssetTimeRange[] {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const sorted = ranges.map((range) => {
    const asset = assets.get(range.assetId)
    if (
      !asset ||
      !Number.isSafeInteger(range.startUs) ||
      !Number.isSafeInteger(range.endUs) ||
      range.startUs < 0 ||
      range.endUs <= range.startUs ||
      range.endUs > asset.durationUs
    ) {
      throw engineError('invalid_operation', 'Transcript edit contains an invalid timed asset range')
    }
    return { ...range }
  }).sort((left, right) =>
    left.assetId.localeCompare(right.assetId) || left.startUs - right.startUs || left.endUs - right.endUs
  )
  const merged: AssetTimeRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (previous && previous.assetId === range.assetId && range.startUs <= previous.endUs) {
      previous.endUs = Math.max(previous.endUs, range.endUs)
      previous.reason = previous.reason === range.reason ? previous.reason : 'selection'
    } else {
      merged.push(range)
    }
  }
  return merged
}

function subtractSourceRanges(
  item: TimelineItem,
  ranges: readonly AssetTimeRange[],
  fps: Rational
): TimelineItem[] {
  let sourceCursor = item.sourceStartUs
  const keptSource: Array<{ startUs: number; endUs: number }> = []
  for (const range of ranges) {
    const startUs = Math.max(item.sourceStartUs, range.startUs)
    const endUs = Math.min(item.sourceEndUs, range.endUs)
    if (startUs > sourceCursor) keptSource.push({ startUs: sourceCursor, endUs: startUs })
    sourceCursor = Math.max(sourceCursor, endUs)
  }
  if (sourceCursor < item.sourceEndUs) keptSource.push({ startUs: sourceCursor, endUs: item.sourceEndUs })
  return keptSource.flatMap(({ startUs, endUs }) => {
    const durationFrames = sourceUsToTimelineFrames(endUs - startUs, item.speed, fps)
    return durationFrames <= 0 ? [] : [{
      ...item,
      sourceStartUs: startUs,
      sourceEndUs: endUs,
      durationFrames,
      fadeInFrames: 0,
      fadeOutFrames: 0
    }]
  })
}

function sourceDeltaUs(frames: number, speed: Rational, fps: Rational): number {
  const normalized = normalizeRational(speed)
  const timelineUs = BigInt(framesToMicroseconds(frames, fps))
  return Number(
    (timelineUs * BigInt(normalized.numerator) + BigInt(normalized.denominator) / 2n) /
    BigInt(normalized.denominator)
  )
}

function sourceUsToTimelineFrames(sourceUs: number, speed: Rational, fps: Rational): number {
  const normalized = normalizeRational(speed)
  const timelineUs = Number(
    (BigInt(sourceUs) * BigInt(normalized.denominator) + BigInt(normalized.numerator) / 2n) /
    BigInt(normalized.numerator)
  )
  return microsecondsToFrames(timelineUs, fps)
}

function unique(
  values: ReadonlyArray<{ id: string }>,
  collection: string,
  issues: TimelineValidationIssue[]
): void {
  const seen = new Set<string>()
  values.forEach(({ id }, index) => {
    if (seen.has(id)) issues.push(refIssue(`${collection}[${index}].id`, `Duplicate identity ${id}`))
    seen.add(id)
  })
}

function sortProjectCollections(project: VideoProject): void {
  sortSequenceCollections(project)
  for (const sequence of project.sequences) sortSequenceCollections(sequence)
  project.multicamGroups?.sort((left, right) => left.id.localeCompare(right.id))
  project.transcripts.forEach((transcript) => {
    transcript.segments.sort((left, right) => left.startUs - right.startUs || left.id.localeCompare(right.id))
  })
}

function sortSequenceCollections(sequence: Pick<VideoProject, 'tracks' | 'items' | 'captions'>): void {
  sequence.tracks.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  sequence.items.sort(compareItems)
  sequence.captions.sort((left, right) => left.startFrame - right.startFrame || left.id.localeCompare(right.id))
}

function compareItems(left: TimelineItem, right: TimelineItem): number {
  return left.timelineStartFrame - right.timelineStartFrame || left.id.localeCompare(right.id)
}

function projectDurationFramesWithoutCaptions(project: VideoProject): number {
  return project.items.reduce(
    (maximum, item) => Math.max(maximum, item.timelineStartFrame + item.durationFrames),
    0
  )
}

function itemIndex(project: VideoProject, id: string): number {
  const index = project.items.findIndex((item) => item.id === id)
  if (index < 0) missing(id)
  return index
}

function duplicate(id: string): never {
  throw engineError('invalid_operation', `Identity already exists: ${id}`)
}

function missing(id: string): never {
  throw engineError('invalid_operation', `Identity does not exist: ${id}`)
}

function refIssue(path: string, message: string): TimelineValidationIssue {
  return { path, code: 'invalid_reference', message }
}

function rangeIssue(path: string, message: string): TimelineValidationIssue {
  return { path, code: 'invalid_range', message }
}

export function canvasForPreset(preset: CanvasPreset, fit: CanvasFit = 'fit'): VideoProject['canvas'] {
  return { preset, fit, ...CANVAS_PRESETS[preset], background: '#000000' }
}
