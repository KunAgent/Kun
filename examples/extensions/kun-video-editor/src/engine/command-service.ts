import {
  MutationReceiptSchema,
  PROJECT_LIMITS,
  type MutationReceipt,
  type ReceiptId,
  type RevisionAuthor,
  type TimelineOperation,
  type UniformShift,
  type VideoProject
} from './schema.js'

export type CommandAttribution = {
  author: RevisionAuthor
  actorId?: string
  sourceOperation: string
  summary: string
}

export type ProjectCommand =
  | { kind: 'timeline'; operations: TimelineOperation[] }
  | { kind: 'replace-project'; project: VideoProject }
  | { kind: 'history-undo' }
  | { kind: 'history-redo' }
  | { kind: 'agent-undo'; actorId: string }
  | {
    kind: 'relink-media'
    assetId: string
    replacement?: VideoProject['assets'][number]
    mediaHandleId?: string
    workspaceRelativePath?: string
    sourceIdentity?: VideoProject['assets'][number]['sourceIdentity']
  }
  | { kind: 'cleanup-derived-cache'; derivedIds?: string[] }
  | { kind: 'confirm-recovery' }

export type ProjectCommandRequest = {
  projectId: string
  expectedRevision: number
  attribution: CommandAttribution
  command: ProjectCommand
}

export type ProjectCommandResult = {
  project: VideoProject
  receipt: MutationReceipt
}

export type ProjectSelectionPatch = Partial<Pick<
  VideoProject['selection'],
  | 'sequenceId'
  | 'playheadFrame'
  | 'selectedAssetIds'
  | 'selectedItemIds'
  | 'selectedCaptionIds'
  | 'selectedWordIds'
  | 'range'
>>

export type SelectionUpdateResult = {
  projectId: string
  revision: number
  generation: number
  eventGeneration: number
  selection: VideoProject['selection']
}

type DiffEntity = { kind: ReceiptId['kind']; id: string; value: unknown }

export function buildMutationReceipt(
  previous: VideoProject,
  next: VideoProject,
  transactionId: string,
  attribution: CommandAttribution,
  operationNotes: ReadonlyArray<MutationReceipt['notes'][number]> = []
): MutationReceipt {
  const before = collectEntities(previous)
  const after = collectEntities(next)
  const created: ReceiptId[] = []
  const changed: ReceiptId[] = []
  const removed: ReceiptId[] = []
  for (const [key, entity] of after) {
    const old = before.get(key)
    if (!old) created.push({ kind: entity.kind, id: entity.id })
    else if (JSON.stringify(old.value) !== JSON.stringify(entity.value)) {
      changed.push({ kind: entity.kind, id: entity.id })
    }
  }
  for (const [key, entity] of before) {
    if (!after.has(key)) removed.push({ kind: entity.kind, id: entity.id })
  }

  const compressed = compressedUniformShifts(previous, next)
  const compressedItemIds = new Set(compressed.itemIds)
  const actionableChanged = changed.filter(({ kind, id }) => kind !== 'item' || !compressedItemIds.has(id))
  const sequenceChanges = describeSequenceChanges(previous, next)
  const trackChanges = describeTrackChanges(previous, next)
  const notes: MutationReceipt['notes'] = [{
    code: 'command_committed',
    messageKey: 'video.receipt.commandCommitted',
    severity: 'info' as const,
    values: { operation: attribution.sourceOperation, revision: next.currentRevision }
  }, ...structuredClone(operationNotes)]

  const createdIds = bounded(created, PROJECT_LIMITS.receiptIds)
  const changedIds = bounded(actionableChanged, PROJECT_LIMITS.receiptIds)
  const removedIds = bounded(removed, PROJECT_LIMITS.receiptIds)
  const shifts = bounded(compressed.shifts, PROJECT_LIMITS.receiptShifts)
  const boundedSequenceChanges = bounded(sequenceChanges, PROJECT_LIMITS.receiptChanges)
  const boundedTrackChanges = bounded(trackChanges, PROJECT_LIMITS.receiptChanges)
  const boundedNotes = bounded(notes, PROJECT_LIMITS.receiptNotes)
  const receipt: MutationReceipt = {
    schemaVersion: 1,
    transactionId,
    projectId: next.id,
    sequenceId: next.activeSequenceId,
    previousRevision: previous.currentRevision,
    newRevision: next.currentRevision,
    generation: next.eventGeneration,
    attribution: {
      author: attribution.author,
      ...(attribution.actorId ? { actorId: attribution.actorId } : {}),
      sourceOperation: attribution.sourceOperation
    },
    createdIds,
    changedIds,
    removedIds,
    shifts,
    sequenceChanges: boundedSequenceChanges,
    trackChanges: boundedTrackChanges,
    proofInvalidated: renderState(previous) !== renderState(next),
    notes: boundedNotes,
    truncated: {
      created: Math.max(0, created.length - createdIds.length),
      changed: Math.max(0, actionableChanged.length - changedIds.length),
      removed: Math.max(0, removed.length - removedIds.length),
      shifts: Math.max(0, compressed.shifts.length - shifts.length),
      sequenceChanges: Math.max(0, sequenceChanges.length - boundedSequenceChanges.length),
      trackChanges: Math.max(0, trackChanges.length - boundedTrackChanges.length),
      notes: Math.max(0, notes.length - boundedNotes.length)
    }
  }
  return MutationReceiptSchema.parse(receipt)
}

function collectEntities(project: VideoProject): Map<string, DiffEntity> {
  const entries: DiffEntity[] = [
    ...project.assets.map((value) => ({ kind: 'asset' as const, id: value.id, value })),
    ...(project.mediaFolders ?? []).map((value) => ({ kind: 'media-folder' as const, id: value.id, value })),
    ...project.sequences.map((value) => ({
      kind: 'sequence' as const,
      id: value.id,
      value: { name: value.name, viewState: value.viewState }
    })),
    ...project.linkGroups.map((value) => ({ kind: 'link-group' as const, id: value.id, value })),
    ...project.transcripts.map((value) => ({ kind: 'transcript' as const, id: value.id, value })),
    ...project.derivedReferences.map((value) => ({ kind: 'derived' as const, id: value.id, value })),
    ...(project.multicamGroups ?? []).map((value) => ({
      kind: 'multicam-group' as const,
      id: value.id,
      value: {
        name: value.name,
        sequenceId: value.sequenceId,
        referenceMemberId: value.referenceMemberId,
        members: value.members,
        layouts: value.layouts
      }
    })),
    ...(project.multicamGroups ?? []).flatMap((group) => group.programFragments.map((value) => ({
      kind: 'multicam-fragment' as const,
      id: value.id,
      value: { groupId: group.id, ...value }
    })))
  ]
  for (const sequence of project.sequences) {
    entries.push(
      ...sequence.tracks.map((value) => ({ kind: 'track' as const, id: value.id, value })),
      ...sequence.items.map((value) => ({ kind: 'item' as const, id: value.id, value })),
      ...sequence.captions.map((value) => ({ kind: 'caption' as const, id: value.id, value }))
    )
  }
  return new Map(entries.map((entity) => [`${entity.kind}:${entity.id}`, entity]))
}

function compressedUniformShifts(
  previous: VideoProject,
  next: VideoProject
): { shifts: UniformShift[]; itemIds: string[] } {
  const previousItems = new Map(previous.items.map((item) => [item.id, item]))
  const groups = new Map<string, Array<{ id: string; frame: number; delta: number; trackId: string }>>()
  for (const item of next.items) {
    const old = previousItems.get(item.id)
    if (!old || old.timelineStartFrame === item.timelineStartFrame) continue
    const beforeRest = { ...old, timelineStartFrame: 0 }
    const afterRest = { ...item, timelineStartFrame: 0 }
    if (JSON.stringify(beforeRest) !== JSON.stringify(afterRest)) continue
    const delta = item.timelineStartFrame - old.timelineStartFrame
    const key = `${item.trackId}\u0000${delta}`
    const values = groups.get(key) ?? []
    values.push({ id: item.id, frame: old.timelineStartFrame, delta, trackId: item.trackId })
    groups.set(key, values)
  }
  const shifts: UniformShift[] = []
  const itemIds: string[] = []
  for (const values of groups.values()) {
    if (values.length < 3) continue
    values.sort((left, right) => left.frame - right.frame || left.id.localeCompare(right.id))
    shifts.push({
      sequenceId: next.activeSequenceId,
      trackId: values[0]!.trackId,
      fromFrame: values[0]!.frame,
      deltaFrames: values[0]!.delta,
      count: values.length
    })
    itemIds.push(...values.map(({ id }) => id))
  }
  shifts.sort((left, right) =>
    left.fromFrame - right.fromFrame || String(left.trackId).localeCompare(String(right.trackId))
  )
  return { shifts, itemIds }
}

function describeSequenceChanges(previous: VideoProject, next: VideoProject): string[] {
  const before = new Map(previous.sequences.map((sequence) => [sequence.id, sequence]))
  const after = new Map(next.sequences.map((sequence) => [sequence.id, sequence]))
  const changes: string[] = []
  for (const [id, sequence] of after) {
    if (!before.has(id)) changes.push(`created:${id}`)
    else if (before.get(id)!.name !== sequence.name) changes.push(`renamed:${id}`)
  }
  for (const id of before.keys()) if (!after.has(id)) changes.push(`removed:${id}`)
  if (previous.activeSequenceId !== next.activeSequenceId) changes.push(`active:${next.activeSequenceId}`)
  return changes.sort()
}

function describeTrackChanges(previous: VideoProject, next: VideoProject): string[] {
  const before = new Map(previous.tracks.map((track) => [track.id, track]))
  const after = new Map(next.tracks.map((track) => [track.id, track]))
  const changes: string[] = []
  for (const [id, track] of after) {
    if (!before.has(id)) changes.push(`created:${id}`)
    else if (JSON.stringify(before.get(id)) !== JSON.stringify(track)) changes.push(`changed:${id}`)
  }
  for (const id of before.keys()) if (!after.has(id)) changes.push(`removed:${id}`)
  return changes.sort()
}

function renderState(project: VideoProject): string {
  return JSON.stringify({
    canvas: project.canvas,
    assets: project.assets,
    sequences: project.sequences.map(({ id, tracks, items, captions }) => ({
      id,
      tracks,
      items,
      captions
    })),
    activeSequenceId: project.activeSequenceId,
    multicamGroups: project.multicamGroups ?? []
  })
}

function bounded<T>(values: readonly T[], maximum: number): T[] {
  return values.slice(0, maximum)
}
