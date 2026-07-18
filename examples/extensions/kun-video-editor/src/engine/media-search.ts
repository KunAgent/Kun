import { engineError } from './errors.js'
import type { MediaAsset, TimelineOperation, Track, VideoProject } from './schema.js'
import { microsecondsToFrames } from './time.js'

export type MediaSearchEvidenceKind = 'filename' | 'spoken' | 'visual'
export type MediaIndexCompleteness = 'complete' | 'partial' | 'unavailable'

export type MediaSourceRange = {
  assetId: string
  startUs: number
  endUs: number
}

export type MediaSearchResult = {
  id: string
  assetId: string
  assetName: string
  evidenceKind: MediaSearchEvidenceKind
  sourceRange: MediaSourceRange
  label: string
  excerpt: string
  score: number
  scoreSemantics: 'uncalibrated'
  indexCompleteness: MediaIndexCompleteness
  evidenceId?: string
  actions: {
    preview: { kind: 'preview-source-range'; range: MediaSourceRange }
    insert: { kind: 'insert-source-range'; range: MediaSourceRange }
  }
}

export type MediaSearchRequest = {
  query: string
  kinds?: readonly Exclude<MediaSearchEvidenceKind, 'visual'>[]
  pageSize?: number
  cursor?: string
  spokenCompleteness?: MediaIndexCompleteness
}

export type SearchableMediaProject = {
  currentRevision: number
  assets: ReadonlyArray<Pick<MediaAsset, 'id' | 'name' | 'durationUs' | 'transcriptIds'>>
  transcripts: ReadonlyArray<{
    id: string
    assetId: string
    segments: ReadonlyArray<{ id: string; startUs: number; endUs: number; text: string }>
  }>
}

export type MediaSearchPage = {
  schemaVersion: 1
  query: string
  results: MediaSearchResult[]
  nextCursor?: string
  totalMatches: number
  completeness: {
    filename: 'complete'
    spoken: MediaIndexCompleteness
    indexedTranscriptCount: number
    totalTranscriptCount: number
  }
}

export type SearchInsertRequest = {
  result: MediaSearchResult
  trackId: string
  timelineStartFrame: number
  itemId: string
}

const MAX_QUERY_LENGTH = 256
const MAX_MATCHES = 5_000

/**
 * Searches only bounded, attributable evidence already present in the project.
 * Scores are lexical and deliberately uncalibrated; no semantic or visual claim
 * is inferred from filenames or transcript prose.
 */
export function searchProjectMedia(
  project: SearchableMediaProject,
  request: MediaSearchRequest
): MediaSearchPage {
  const query = normalizedQuery(request.query)
  const kinds = new Set(request.kinds ?? ['filename', 'spoken'])
  const pageSize = boundedInteger(request.pageSize ?? 20, 1, 100, 'pageSize')
  const fingerprint = cursorFingerprint(query, [...kinds].sort().join(','), project.currentRevision)
  const offset = decodeCursor(request.cursor, fingerprint)
  const spokenCompleteness = request.spokenCompleteness ?? 'complete'
  const matches: MediaSearchResult[] = []

  for (const asset of project.assets) {
    if (kinds.has('filename')) {
      const score = lexicalScore(asset.name, query)
      if (score > 0) matches.push(filenameResult(asset, score))
    }
  }

  if (kinds.has('spoken') && spokenCompleteness !== 'unavailable') {
    for (const transcript of project.transcripts) {
      const asset = project.assets.find(({ id }) => id === transcript.assetId)
      if (!asset) continue
      for (const segment of transcript.segments) {
        const score = lexicalScore(segment.text, query)
        if (score <= 0) continue
        matches.push(spokenResult(
          asset,
          transcript.id,
          segment.id,
          segment.startUs,
          segment.endUs,
          segment.text,
          score,
          spokenCompleteness
        ))
        if (matches.length >= MAX_MATCHES) break
      }
      if (matches.length >= MAX_MATCHES) break
    }
  }

  matches.sort(compareSearchResults)
  const bounded = matches.slice(0, MAX_MATCHES)
  const results = bounded.slice(offset, offset + pageSize)
  const nextOffset = offset + results.length
  return {
    schemaVersion: 1,
    query,
    results,
    ...(nextOffset < bounded.length ? { nextCursor: encodeCursor(nextOffset, fingerprint) } : {}),
    totalMatches: bounded.length,
    completeness: {
      filename: 'complete',
      spoken: spokenCompleteness,
      indexedTranscriptCount: project.transcripts.length,
      totalTranscriptCount: project.assets.reduce(
        (total, asset) => total + asset.transcriptIds.length,
        0
      )
    }
  }
}

export function previewSearchResult(result: MediaSearchResult): MediaSearchResult['actions']['preview'] {
  return {
    kind: 'preview-source-range',
    range: { ...result.sourceRange }
  }
}

/** Builds the standard timeline operation used by both UI and Agent callers. */
export function planSearchResultInsertion(
  project: VideoProject,
  request: SearchInsertRequest
): TimelineOperation {
  const asset = project.assets.find(({ id }) => id === request.result.assetId)
  if (!asset) throw engineError('invalid_operation', `Search result asset is unavailable: ${request.result.assetId}`)
  assertRange(asset, request.result.sourceRange)
  const track = project.tracks.find(({ id }) => id === request.trackId)
  if (!track) throw engineError('invalid_operation', `Insertion track does not exist: ${request.trackId}`)
  assertCompatibleTrack(asset, track)
  if (!Number.isSafeInteger(request.timelineStartFrame) || request.timelineStartFrame < 0) {
    throw engineError('invalid_operation', 'Insertion frame must be a non-negative integer')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(request.itemId)) {
    throw engineError('invalid_operation', 'Insertion item ID is invalid')
  }
  const durationFrames = Math.max(
    1,
    microsecondsToFrames(
      request.result.sourceRange.endUs - request.result.sourceRange.startUs,
      project.fps
    )
  )
  return {
    type: 'add-item',
    item: {
      id: request.itemId,
      assetId: asset.id,
      trackId: track.id,
      timelineStartFrame: request.timelineStartFrame,
      durationFrames,
      sourceStartUs: request.result.sourceRange.startUs,
      sourceEndUs: request.result.sourceRange.endUs,
      speed: { numerator: 1, denominator: 1 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      opacity: 1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      ...(asset.kind === 'audio' ? { volume: 1 } : {})
    }
  }
}

function filenameResult(asset: SearchableMediaProject['assets'][number], score: number): MediaSearchResult {
  return result({
    id: `search:filename:${asset.id}`,
    asset,
    evidenceKind: 'filename',
    startUs: 0,
    endUs: asset.durationUs,
    label: asset.name,
    excerpt: asset.name,
    score,
    completeness: 'complete'
  })
}

function spokenResult(
  asset: SearchableMediaProject['assets'][number],
  transcriptId: string,
  segmentId: string,
  startUs: number,
  endUs: number,
  text: string,
  score: number,
  completeness: MediaIndexCompleteness
): MediaSearchResult {
  return result({
    id: `search:spoken:${transcriptId}:${segmentId}`.slice(0, 256),
    asset,
    evidenceKind: 'spoken',
    startUs,
    endUs,
    label: asset.name,
    excerpt: text,
    score,
    completeness,
    evidenceId: `${transcriptId}:${segmentId}`
  })
}

function result(input: {
  id: string
  asset: SearchableMediaProject['assets'][number]
  evidenceKind: MediaSearchEvidenceKind
  startUs: number
  endUs: number
  label: string
  excerpt: string
  score: number
  completeness: MediaIndexCompleteness
  evidenceId?: string
}): MediaSearchResult {
  const range = { assetId: input.asset.id, startUs: input.startUs, endUs: input.endUs }
  return {
    id: input.id,
    assetId: input.asset.id,
    assetName: input.asset.name,
    evidenceKind: input.evidenceKind,
    sourceRange: range,
    label: input.label,
    excerpt: input.excerpt.slice(0, 1_024),
    score: input.score,
    scoreSemantics: 'uncalibrated',
    indexCompleteness: input.completeness,
    ...(input.evidenceId ? { evidenceId: input.evidenceId } : {}),
    actions: {
      preview: { kind: 'preview-source-range', range: { ...range } },
      insert: { kind: 'insert-source-range', range: { ...range } }
    }
  }
}

function lexicalScore(value: string, query: string): number {
  const normalized = value.normalize('NFKC').toLocaleLowerCase()
  if (normalized === query) return 1
  if (normalized.startsWith(query)) return 0.9
  const index = normalized.indexOf(query)
  if (index < 0) return 0
  const density = query.length / Math.max(query.length, normalized.length)
  return Number(Math.min(0.89, 0.55 + density * 0.3).toFixed(6))
}

function compareSearchResults(left: MediaSearchResult, right: MediaSearchResult): number {
  return right.score - left.score ||
    evidenceOrder(left.evidenceKind) - evidenceOrder(right.evidenceKind) ||
    left.assetName.localeCompare(right.assetName) ||
    left.sourceRange.startUs - right.sourceRange.startUs ||
    left.id.localeCompare(right.id)
}

function evidenceOrder(kind: MediaSearchEvidenceKind): number {
  return kind === 'spoken' ? 0 : kind === 'filename' ? 1 : 2
}

function normalizedQuery(value: string): string {
  const query = value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
  if (!query || query.length > MAX_QUERY_LENGTH) {
    throw engineError('invalid_operation', `Search query must contain 1 through ${MAX_QUERY_LENGTH} characters`)
  }
  return query
}

function assertRange(asset: MediaAsset, range: MediaSourceRange): void {
  if (
    range.assetId !== asset.id ||
    !Number.isSafeInteger(range.startUs) ||
    !Number.isSafeInteger(range.endUs) ||
    range.startUs < 0 ||
    range.endUs <= range.startUs ||
    range.endUs > asset.durationUs
  ) {
    throw engineError('invalid_operation', 'Search result source range is invalid for its asset')
  }
}

function assertCompatibleTrack(asset: MediaAsset, track: Track): void {
  if (track.kind === 'caption' || track.kind !== asset.kind) {
    throw engineError('invalid_operation', `${asset.kind} media requires a ${asset.kind} track`)
  }
}

function encodeCursor(offset: number, fingerprint: string): string {
  return `v1:${offset}:${fingerprint}`
}

function decodeCursor(cursor: string | undefined, fingerprint: string): number {
  if (cursor === undefined) return 0
  const match = /^v1:(\d{1,8}):([a-f0-9]{8})$/u.exec(cursor)
  if (!match || match[2] !== fingerprint) {
    throw engineError('invalid_operation', 'Search cursor does not belong to this query and revision')
  }
  const offset = Number(match[1])
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_MATCHES) {
    throw engineError('invalid_operation', 'Search cursor offset is out of bounds')
  }
  return offset
}

function cursorFingerprint(...values: readonly (string | number)[]): string {
  let hash = 0x811c9dc5
  for (const character of values.join('\u0000')) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw engineError('invalid_operation', `${name} must be an integer from ${minimum} through ${maximum}`)
  }
  return value
}
