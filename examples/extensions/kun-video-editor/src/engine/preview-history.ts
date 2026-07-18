import { engineError } from './errors.js'
import type { TimelineOperation, VideoProject } from './schema.js'
import { framesToMicroseconds, normalizeRational } from './time.js'
import { containsNullOrLineBreak } from '../text-safety.js'

export const PREVIEW_HISTORY_LIMITS = Object.freeze({
  entries: 40,
  selectedIds: 64,
  attachmentBytes: 16 * 1024
})

export type PreviewSource =
  | { kind: 'asset'; assetId: string; startUs: number; endUs: number }
  | { kind: 'timeline'; sequenceId: string; revision: number; startFrame: number; endFrame: number; artifactId?: string }
  | { kind: 'generated'; assetId: string; jobId: string; variantIndex: number }

export type PreviewHistoryEntry = {
  id: string
  projectId: string
  createdAt: string
  label: string
  source: PreviewSource
}

export type PreviewHistory = {
  schemaVersion: 1
  generation: number
  activeEntryId?: string
  entries: PreviewHistoryEntry[]
}

export type PreviewComparison = {
  left: PreviewHistoryEntry
  right: PreviewHistoryEntry
  mode: 'wipe' | 'side-by-side'
  sameRevision: boolean
}

export type VideoSelectionAttachment = {
  schemaVersion: 1
  projectId: string
  sequenceId: string
  revision: number
  selectionGeneration: number
  playheadFrame: number
  selectedAssetIds: string[]
  selectedItemIds: string[]
  selectedCaptionIds: string[]
  selectedWordIds: string[]
  range?: { startFrame: number; endFrame: number }
  previewEntryIds: string[]
}

export function emptyPreviewHistory(): PreviewHistory {
  return { schemaVersion: 1, generation: 0, entries: [] }
}

export function appendPreviewHistory(
  history: PreviewHistory,
  entry: PreviewHistoryEntry
): PreviewHistory {
  validateHistory(history)
  validateEntry(entry)
  const entries = [
    ...history.entries.filter(({ id }) => id !== entry.id),
    structuredClone(entry)
  ].slice(-PREVIEW_HISTORY_LIMITS.entries)
  return {
    schemaVersion: 1,
    generation: history.generation + 1,
    activeEntryId: entry.id,
    entries
  }
}

export function selectPreviewHistory(history: PreviewHistory, entryId: string): PreviewHistory {
  validateHistory(history)
  if (!history.entries.some(({ id }) => id === entryId)) invalid(`Preview entry does not exist: ${entryId}`)
  if (history.activeEntryId === entryId) return structuredClone(history)
  return { ...structuredClone(history), generation: history.generation + 1, activeEntryId: entryId }
}

export function comparePreviewHistory(
  history: PreviewHistory,
  leftEntryId: string,
  rightEntryId: string,
  mode: PreviewComparison['mode']
): PreviewComparison {
  validateHistory(history)
  if (!['wipe', 'side-by-side'].includes(mode)) invalid('Preview comparison mode is invalid')
  if (leftEntryId === rightEntryId) invalid('Preview comparison requires two different entries')
  const left = history.entries.find(({ id }) => id === leftEntryId)
  const right = history.entries.find(({ id }) => id === rightEntryId)
  if (!left || !right) invalid('Preview comparison refers to a missing entry')
  if (left.projectId !== right.projectId) invalid('Preview comparison cannot cross project boundaries')
  return {
    left: structuredClone(left),
    right: structuredClone(right),
    mode,
    sameRevision: left.source.kind === 'timeline' && right.source.kind === 'timeline' &&
      left.source.sequenceId === right.source.sequenceId && left.source.revision === right.source.revision
  }
}

export function planReplaceTimelineItemFromPreview(
  project: VideoProject,
  input: {
    itemId: string
    preview: Extract<PreviewSource, { kind: 'asset' | 'generated' }>
    generatedSourceRange?: { startUs: number; endUs: number }
  }
): TimelineOperation[] {
  const item = project.items.find(({ id }) => id === input.itemId)
  if (!item) invalid(`Timeline item does not exist: ${input.itemId}`)
  if (item.locked || project.tracks.find(({ id }) => id === item.trackId)?.locked) {
    invalid(`Timeline item is locked: ${item.id}`)
  }
  const assetId = input.preview.assetId
  const asset = project.assets.find(({ id }) => id === assetId)
  if (!asset) invalid(`Preview asset does not exist: ${assetId}`)
  const track = project.tracks.find(({ id }) => id === item.trackId)
  if (!track || track.kind === 'caption') invalid('Replacement target track is invalid')
  if (track.kind === 'audio' && asset.kind !== 'audio' && asset.audio === undefined) {
    invalid('An audio track requires an asset with audio')
  }
  if (track.kind === 'video' && !['video', 'image', 'animation'].includes(asset.kind)) {
    invalid('A video track requires visual media')
  }
  const sourceRange = input.preview.kind === 'asset'
    ? { startUs: input.preview.startUs, endUs: input.preview.endUs }
    : input.generatedSourceRange ?? { startUs: 0, endUs: asset.durationUs }
  if (
    !Number.isSafeInteger(sourceRange.startUs) || !Number.isSafeInteger(sourceRange.endUs) ||
    sourceRange.startUs < 0 || sourceRange.endUs <= sourceRange.startUs || sourceRange.endUs > asset.durationUs
  ) invalid('Preview replacement source range is invalid')
  const timelineDurationUs = framesToMicroseconds(item.durationFrames, project.fps)
  const speed = normalizeRational({
    numerator: sourceRange.endUs - sourceRange.startUs,
    denominator: timelineDurationUs
  })
  return [
    { type: 'delete-item', itemId: item.id },
    {
      type: 'add-item',
      item: {
        ...structuredClone(item),
        assetId,
        nestedSequenceId: undefined,
        sourceStartUs: sourceRange.startUs,
        sourceEndUs: sourceRange.endUs,
        speed
      }
    }
  ]
}

export function buildVideoSelectionAttachment(
  project: VideoProject,
  previewEntryIds: readonly string[] = []
): VideoSelectionAttachment {
  const selection = project.selection
  for (const ids of [
    selection.selectedAssetIds,
    selection.selectedItemIds,
    selection.selectedCaptionIds,
    selection.selectedWordIds,
    previewEntryIds
  ]) {
    if (ids.length > PREVIEW_HISTORY_LIMITS.selectedIds) invalid('Selection attachment exceeds its ID limit')
  }
  const attachment: VideoSelectionAttachment = {
    schemaVersion: 1,
    projectId: project.id,
    sequenceId: selection.sequenceId,
    revision: project.currentRevision,
    selectionGeneration: selection.generation,
    playheadFrame: selection.playheadFrame,
    selectedAssetIds: [...selection.selectedAssetIds],
    selectedItemIds: [...selection.selectedItemIds],
    selectedCaptionIds: [...selection.selectedCaptionIds],
    selectedWordIds: [...selection.selectedWordIds],
    ...(selection.range ? { range: structuredClone(selection.range) } : {}),
    previewEntryIds: [...previewEntryIds]
  }
  if (Buffer.byteLength(JSON.stringify(attachment), 'utf8') > PREVIEW_HISTORY_LIMITS.attachmentBytes) {
    invalid('Selection attachment exceeds its byte limit')
  }
  return attachment
}

export function validateHistory(history: PreviewHistory): void {
  if (history.schemaVersion !== 1) invalid('Preview history schema version is unsupported')
  if (!Number.isSafeInteger(history.generation) || history.generation < 0) invalid('Preview history generation is invalid')
  if (history.entries.length > PREVIEW_HISTORY_LIMITS.entries) invalid('Preview history exceeds its entry limit')
  const ids = new Set<string>()
  for (const entry of history.entries) {
    validateEntry(entry)
    if (ids.has(entry.id)) invalid(`Duplicate preview entry: ${entry.id}`)
    ids.add(entry.id)
  }
  if (history.activeEntryId !== undefined && !ids.has(history.activeEntryId)) {
    invalid('Active preview entry is missing from history')
  }
}

function validateEntry(entry: PreviewHistoryEntry): void {
  boundedId(entry.id, 'preview.id')
  boundedId(entry.projectId, 'preview.projectId')
  if (!entry.label || entry.label.length > 160 || containsNullOrLineBreak(entry.label)) invalid('Preview label is invalid')
  if (!Number.isFinite(Date.parse(entry.createdAt))) invalid('Preview timestamp is invalid')
  if (entry.source.kind === 'asset') {
    boundedId(entry.source.assetId, 'preview.assetId')
    nonNegative(entry.source.startUs, 'preview.startUs')
    positive(entry.source.endUs, 'preview.endUs')
    if (entry.source.endUs <= entry.source.startUs) invalid('Preview source range is empty')
  } else if (entry.source.kind === 'timeline') {
    boundedId(entry.source.sequenceId, 'preview.sequenceId')
    nonNegative(entry.source.revision, 'preview.revision')
    nonNegative(entry.source.startFrame, 'preview.startFrame')
    positive(entry.source.endFrame, 'preview.endFrame')
    if (entry.source.endFrame <= entry.source.startFrame) invalid('Preview timeline range is empty')
    if (entry.source.artifactId !== undefined) boundedId(entry.source.artifactId, 'preview.artifactId')
  } else {
    boundedId(entry.source.assetId, 'preview.generated.assetId')
    boundedId(entry.source.jobId, 'preview.generated.jobId')
    nonNegative(entry.source.variantIndex, 'preview.generated.variantIndex')
  }
}

function boundedId(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._~-]{0,191}$/u.test(value)) invalid(`${label} is invalid`)
}

function nonNegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a non-negative integer`)
}

function positive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) invalid(`${label} must be a positive integer`)
}

function invalid(message: string): never {
  throw engineError('invalid_operation', message)
}
