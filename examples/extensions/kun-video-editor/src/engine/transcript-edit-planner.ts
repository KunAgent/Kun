import { createHash } from 'node:crypto'
import { engineError } from './errors.js'
import type { Rational, TimelineItem, Transcript, VideoProject } from './schema.js'
import { framesToMicroseconds, microsecondsToFrames, normalizeRational } from './time.js'
import {
  detectFillerRanges,
  detectSilenceRanges
} from './transcript.js'
import {
  removeAssetTimeRanges,
  type AssetTimeRange
} from './timeline.js'

export type TranscriptEditIntent =
  | { kind: 'explicit-ranges'; ranges: readonly AssetTimeRange[] }
  | { kind: 'words'; transcript: Transcript; wordIds: readonly string[] }
  | { kind: 'fillers'; transcript: Transcript; fillers?: ReadonlySet<string> }
  | { kind: 'silence'; transcript: Transcript; assetDurationUs: number; minimumSilenceUs?: number }

export type TranscriptLinkGroup = {
  id: string
  itemIds: readonly string[]
}

export type MappedTranscriptRange = {
  assetId: string
  itemId: string
  trackId: string
  sourceStartUs: number
  sourceEndUs: number
  timelineStartFrame: number
  timelineEndFrame: number
  reason: NonNullable<AssetTimeRange['reason']>
  linkGroupId?: string
  propagatedFromItemId?: string
}

export type TranscriptEditPlan = {
  schemaVersion: 1
  projectId: string
  expectedRevision: number
  intent: TranscriptEditIntent['kind']
  sourceRanges: AssetTimeRange[]
  mappedRanges: MappedTranscriptRange[]
  affectedItemIds: string[]
  affectedTrackIds: string[]
  wordIds: string[]
  evidenceDigest: string
  requiresWordIndexRefresh: boolean
}

export type AppliedTranscriptEdit = {
  project: VideoProject
  receipt: {
    previousRevision: number
    removedSourceRanges: AssetTimeRange[]
    removedFrameRanges: MappedTranscriptRange[]
    changedIds: string[]
    refreshWordIndices: true
    evidenceDigest: string
  }
}

export function planTranscriptEdits(
  project: VideoProject,
  intent: TranscriptEditIntent,
  options: { linkGroups?: readonly TranscriptLinkGroup[] } = {}
): TranscriptEditPlan {
  const resolved = resolveIntent(intent)
  if (resolved.ranges.length === 0) {
    throw engineError('invalid_operation', 'Transcript edit evidence did not resolve to a timed source range')
  }
  const normalized = normalizeRanges(project, resolved.ranges)
  const direct = mapSourceRanges(project, normalized)
  if (direct.length === 0) {
    throw engineError('invalid_operation', 'Transcript evidence does not intersect any visible timeline item')
  }
  const propagated = propagateLinkedRanges(project, direct, options.linkGroups ?? [])
  const mappedRanges = dedupeMapped([...direct, ...propagated])
  const effectiveSources = normalizeRanges(project, [
    ...normalized,
    ...propagated.map(({ assetId, sourceStartUs, sourceEndUs, reason }) => ({
      assetId,
      startUs: sourceStartUs,
      endUs: sourceEndUs,
      reason
    }))
  ])
  const evidenceDigest = createHash('sha256').update(JSON.stringify({
    projectId: project.id,
    revision: project.currentRevision,
    intent: intent.kind,
    ranges: effectiveSources,
    words: resolved.wordIds
  })).digest('hex')
  return {
    schemaVersion: 1,
    projectId: project.id,
    expectedRevision: project.currentRevision,
    intent: intent.kind,
    sourceRanges: effectiveSources,
    mappedRanges,
    affectedItemIds: [...new Set(mappedRanges.map(({ itemId }) => itemId))].sort(),
    affectedTrackIds: [...new Set(mappedRanges.map(({ trackId }) => trackId))].sort(),
    wordIds: resolved.wordIds,
    evidenceDigest,
    requiresWordIndexRefresh: intent.kind === 'words' || intent.kind === 'fillers'
  }
}

export function applyTranscriptEditPlan(
  project: VideoProject,
  plan: TranscriptEditPlan
): AppliedTranscriptEdit {
  if (plan.projectId !== project.id || plan.expectedRevision !== project.currentRevision) {
    throw engineError('revision_conflict', 'Transcript edit plan is stale', {
      planProjectId: plan.projectId,
      planRevision: plan.expectedRevision,
      projectId: project.id,
      currentRevision: project.currentRevision
    })
  }
  const applied = removeAssetTimeRanges(project, plan.sourceRanges)
  return {
    project: applied.project,
    receipt: {
      previousRevision: project.currentRevision,
      removedSourceRanges: applied.removed,
      removedFrameRanges: plan.mappedRanges,
      changedIds: applied.changedIds,
      refreshWordIndices: true,
      evidenceDigest: plan.evidenceDigest
    }
  }
}

function resolveIntent(intent: TranscriptEditIntent): { ranges: AssetTimeRange[]; wordIds: string[] } {
  if (intent.kind === 'explicit-ranges') {
    return { ranges: intent.ranges.map((range) => ({ ...range, reason: range.reason ?? 'selection' })), wordIds: [] }
  }
  if (intent.kind === 'fillers') {
    return { ranges: detectFillerRanges(intent.transcript, intent.fillers), wordIds: fillerWordIds(intent) }
  }
  if (intent.kind === 'silence') {
    return {
      ranges: detectSilenceRanges(intent.transcript, intent.assetDurationUs, intent.minimumSilenceUs),
      wordIds: []
    }
  }
  const requested = new Set(intent.wordIds)
  if (requested.size === 0) throw engineError('invalid_operation', 'At least one transcript word ID is required')
  const ranges: AssetTimeRange[] = []
  const found = new Set<string>()
  for (const segment of intent.transcript.segments) {
    for (const word of segment.words ?? []) {
      if (!requested.has(word.id)) continue
      found.add(word.id)
      ranges.push({
        assetId: intent.transcript.assetId,
        startUs: word.startUs,
        endUs: word.endUs,
        reason: 'selection'
      })
    }
  }
  const missing = [...requested].filter((id) => !found.has(id))
  if (missing.length > 0) {
    throw engineError('transcript_invalid', 'Requested transcript words are missing timed evidence', {
      missingWordIds: missing.slice(0, 100)
    })
  }
  return { ranges, wordIds: [...requested].sort() }
}

function fillerWordIds(intent: Extract<TranscriptEditIntent, { kind: 'fillers' }>): string[] {
  const fillers = intent.fillers ?? new Set(['ah', 'eh', 'er', 'hmm', 'like', 'mm', 'uh', 'um', '嗯', '呃', '那个'])
  const normalized = new Set([...fillers].map(normalizeToken))
  return intent.transcript.segments.flatMap((segment) =>
    (segment.words ?? []).filter((word) => normalized.has(normalizeToken(word.text))).map(({ id }) => id)
  ).sort()
}

function normalizeRanges(project: VideoProject, ranges: readonly AssetTimeRange[]): AssetTimeRange[] {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const sorted = ranges.map((range) => {
    const asset = assets.get(range.assetId)
    if (!asset) throw engineError('invalid_operation', `Transcript range references missing asset ${range.assetId}`)
    if (
      !Number.isSafeInteger(range.startUs) ||
      !Number.isSafeInteger(range.endUs) ||
      range.startUs < 0 ||
      range.endUs <= range.startUs ||
      range.endUs > asset.durationUs
    ) {
      throw engineError('invalid_operation', 'Transcript source range is outside the granted media duration')
    }
    return { ...range, reason: range.reason ?? 'selection' }
  }).sort((left, right) =>
    left.assetId.localeCompare(right.assetId) || left.startUs - right.startUs || left.endUs - right.endUs
  )
  const merged: AssetTimeRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (previous && previous.assetId === range.assetId && range.startUs <= previous.endUs) {
      previous.endUs = Math.max(previous.endUs, range.endUs)
      if (previous.reason !== range.reason) previous.reason = 'selection'
    } else merged.push({ ...range })
  }
  return merged
}

function mapSourceRanges(project: VideoProject, ranges: readonly AssetTimeRange[]): MappedTranscriptRange[] {
  const mapped: MappedTranscriptRange[] = []
  for (const item of project.items) {
    for (const range of ranges) {
      if (range.assetId !== item.assetId) continue
      const sourceStartUs = Math.max(item.sourceStartUs, range.startUs)
      const sourceEndUs = Math.min(item.sourceEndUs, range.endUs)
      if (sourceEndUs <= sourceStartUs) continue
      const timelineStartFrame = sourceUsToTimelineFrame(item, sourceStartUs, project.fps)
      const timelineEndFrame = Math.max(
        timelineStartFrame + 1,
        sourceUsToTimelineFrame(item, sourceEndUs, project.fps)
      )
      mapped.push({
        assetId: item.assetId,
        itemId: item.id,
        trackId: item.trackId,
        sourceStartUs,
        sourceEndUs,
        timelineStartFrame,
        timelineEndFrame,
        reason: range.reason ?? 'selection'
      })
    }
  }
  return mapped.sort(compareMapped)
}

function propagateLinkedRanges(
  project: VideoProject,
  direct: readonly MappedTranscriptRange[],
  groups: readonly TranscriptLinkGroup[]
): MappedTranscriptRange[] {
  const itemById = new Map(project.items.map((item) => [item.id, item]))
  const groupByItem = new Map<string, TranscriptLinkGroup>()
  for (const group of groups) {
    if (!group.id || group.itemIds.length < 2) continue
    for (const itemId of group.itemIds) groupByItem.set(itemId, group)
  }
  const propagated: MappedTranscriptRange[] = []
  for (const range of direct) {
    const group = groupByItem.get(range.itemId)
    if (!group) continue
    for (const linkedId of group.itemIds) {
      if (linkedId === range.itemId) continue
      const linked = itemById.get(linkedId)
      if (!linked) throw engineError('invalid_operation', `Link group ${group.id} references missing item ${linkedId}`)
      const linkedStart = linked.timelineStartFrame
      const linkedEnd = linked.timelineStartFrame + linked.durationFrames
      const timelineStartFrame = Math.max(linkedStart, range.timelineStartFrame)
      const timelineEndFrame = Math.min(linkedEnd, range.timelineEndFrame)
      if (timelineEndFrame <= timelineStartFrame) continue
      propagated.push({
        assetId: linked.assetId,
        itemId: linked.id,
        trackId: linked.trackId,
        sourceStartUs: timelineFrameToSourceUs(linked, timelineStartFrame, project.fps),
        sourceEndUs: timelineFrameToSourceUs(linked, timelineEndFrame, project.fps),
        timelineStartFrame,
        timelineEndFrame,
        reason: range.reason,
        linkGroupId: group.id,
        propagatedFromItemId: range.itemId
      })
    }
  }
  return propagated
}

function sourceUsToTimelineFrame(item: TimelineItem, sourceUs: number, fps: Rational): number {
  const speed = normalizeRational(item.speed)
  const sourceDelta = BigInt(sourceUs - item.sourceStartUs)
  const timelineUs = Number(
    (sourceDelta * BigInt(speed.denominator) + BigInt(speed.numerator) / 2n) /
    BigInt(speed.numerator)
  )
  return item.timelineStartFrame + microsecondsToFrames(timelineUs, fps)
}

function timelineFrameToSourceUs(item: TimelineItem, frame: number, fps: Rational): number {
  const speed = normalizeRational(item.speed)
  const frameDelta = Math.max(0, frame - item.timelineStartFrame)
  const timelineUs = BigInt(framesToMicroseconds(frameDelta, fps))
  const sourceDelta = Number(
    (timelineUs * BigInt(speed.numerator) + BigInt(speed.denominator) / 2n) /
    BigInt(speed.denominator)
  )
  return Math.min(item.sourceEndUs, item.sourceStartUs + sourceDelta)
}

function dedupeMapped(ranges: readonly MappedTranscriptRange[]): MappedTranscriptRange[] {
  const seen = new Set<string>()
  return ranges.filter((range) => {
    const key = [range.itemId, range.sourceStartUs, range.sourceEndUs, range.timelineStartFrame, range.timelineEndFrame].join(':')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).sort(compareMapped)
}

function compareMapped(left: MappedTranscriptRange, right: MappedTranscriptRange): number {
  return left.timelineStartFrame - right.timelineStartFrame ||
    left.trackId.localeCompare(right.trackId) ||
    left.itemId.localeCompare(right.itemId)
}

function normalizeToken(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')
}
