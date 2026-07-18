import { access } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import { constants } from 'node:fs'
import { engineError } from './errors.js'
import type {
  MediaAsset,
  Transcript,
  TranscriptSegment,
  TranscriptWord
} from './schema.js'
import type { AssetTimeRange } from './timeline.js'

export type TranscriptFormat = 'srt' | 'vtt' | 'json'

export type ImportTranscriptOptions = {
  format: TranscriptFormat
  transcriptId: string
  asset: MediaAsset
  language?: string
}

export type TranscriberCapability =
  | {
      available: true
      backend: 'whisper-cli'
      executable: string
      source: 'configured' | 'environment' | 'path'
    }
  | {
      available: false
      code: 'transcriber_unavailable'
      remediation: string
    }

export type DetectTranscriberOptions = {
  configuredPath?: string
  env?: Readonly<Record<string, string | undefined>>
  platform?: NodeJS.Platform
  canExecute?: (path: string) => Promise<boolean>
}

const DEFAULT_FILLERS = new Set([
  'ah', 'eh', 'er', 'hmm', 'like', 'mm', 'uh', 'um', '嗯', '呃', '那个'
])

export function importTranscript(source: string, options: ImportTranscriptOptions): Transcript {
  if (!isStableId(options.transcriptId)) {
    throw engineError('transcript_invalid', 'Transcript ID must be a stable identifier')
  }
  const segments = options.format === 'srt'
    ? parseSrt(source)
    : options.format === 'vtt'
      ? parseVtt(source)
      : parseJsonTranscript(source)
  const transcript: Transcript = {
    id: options.transcriptId,
    assetId: options.asset.id,
    language: options.language ?? extractJsonLanguage(source, options.format) ?? 'und',
    provenance: options.format,
    segments
  }
  validateTimedTranscript(transcript, options.asset)
  return transcript
}

export function validateTimedTranscript(transcript: Transcript, asset: MediaAsset): void {
  if (transcript.assetId !== asset.id) {
    throw engineError('transcript_invalid', 'Transcript is bound to a different asset')
  }
  const ids = new Set<string>()
  let previousEnd = -1
  for (const segment of transcript.segments) {
    if (
      !isStableId(segment.id) ||
      !Number.isSafeInteger(segment.startUs) ||
      !Number.isSafeInteger(segment.endUs) ||
      segment.startUs < 0 ||
      segment.endUs <= segment.startUs ||
      segment.endUs > asset.durationUs ||
      segment.startUs < previousEnd ||
      segment.text.trim().length === 0
    ) {
      throw engineError('transcript_invalid', 'Transcript segments must have ordered in-bounds timing', {
        segmentId: segment.id
      })
    }
    if (ids.has(segment.id)) {
      throw engineError('transcript_invalid', `Duplicate transcript segment: ${segment.id}`)
    }
    ids.add(segment.id)
    previousEnd = segment.endUs
    validateWords(segment)
  }
}

export function detectFillerRanges(
  transcript: Transcript,
  fillers: ReadonlySet<string> = DEFAULT_FILLERS
): AssetTimeRange[] {
  const ranges: AssetTimeRange[] = []
  for (const segment of transcript.segments) {
    if (segment.words && segment.words.length > 0) {
      for (const word of segment.words) {
        if (fillers.has(normalizeToken(word.text))) {
          ranges.push({
            assetId: transcript.assetId,
            startUs: word.startUs,
            endUs: word.endUs,
            reason: 'filler'
          })
        }
      }
    } else if (fillers.has(normalizeToken(segment.text))) {
      ranges.push({
        assetId: transcript.assetId,
        startUs: segment.startUs,
        endUs: segment.endUs,
        reason: 'filler'
      })
    }
  }
  return mergeRanges(ranges)
}

export function detectSilenceRanges(
  transcript: Transcript,
  assetDurationUs: number,
  minimumSilenceUs = 500_000
): AssetTimeRange[] {
  if (!Number.isSafeInteger(assetDurationUs) || assetDurationUs <= 0) {
    throw engineError('transcript_invalid', 'Asset duration must be a positive integer')
  }
  if (!Number.isSafeInteger(minimumSilenceUs) || minimumSilenceUs <= 0) {
    throw engineError('transcript_invalid', 'Minimum silence duration must be positive')
  }
  const ranges: AssetTimeRange[] = []
  let cursor = 0
  for (const segment of transcript.segments) {
    if (segment.startUs - cursor >= minimumSilenceUs) {
      ranges.push({
        assetId: transcript.assetId,
        startUs: cursor,
        endUs: segment.startUs,
        reason: 'silence'
      })
    }
    cursor = Math.max(cursor, segment.endUs)
  }
  if (assetDurationUs - cursor >= minimumSilenceUs) {
    ranges.push({
      assetId: transcript.assetId,
      startUs: cursor,
      endUs: assetDurationUs,
      reason: 'silence'
    })
  }
  return ranges
}

export async function detectLocalTranscriber(
  options: DetectTranscriberOptions = {}
): Promise<TranscriberCapability> {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const canExecute = options.canExecute ?? defaultCanExecute
  const candidates: Array<{
    path: string
    source: 'configured' | 'environment' | 'path'
  }> = []
  if (options.configuredPath) candidates.push({ path: options.configuredPath, source: 'configured' })
  if (env.WHISPER_CLI_PATH) candidates.push({ path: env.WHISPER_CLI_PATH, source: 'environment' })
  const names = platform === 'win32'
    ? ['whisper-cli.exe', 'whisper.exe']
    : ['whisper-cli', 'whisper']
  for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const name of names) candidates.push({ path: join(directory, name), source: 'path' })
  }
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (!isAbsolute(candidate.path) || seen.has(candidate.path)) continue
    seen.add(candidate.path)
    if (await canExecute(candidate.path)) {
      return {
        available: true,
        backend: 'whisper-cli',
        executable: candidate.path,
        source: candidate.source
      }
    }
  }
  return {
    available: false,
    code: 'transcriber_unavailable',
    remediation: 'Install whisper-cli locally or configure WHISPER_CLI_PATH; transcript import remains available.'
  }
}

export function requireLocalTranscriber(
  capability: TranscriberCapability
): Extract<TranscriberCapability, { available: true }> {
  if (!capability.available) {
    throw engineError('transcriber_unavailable', capability.remediation, { code: capability.code })
  }
  return capability
}

function parseSrt(source: string): TranscriptSegment[] {
  const normalized = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').trim()
  if (normalized.length === 0) return []
  return normalized.split(/\n{2,}/u).map((block, index) => {
    const lines = block.split('\n')
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex < 0) invalidCue(index)
    const [start, end] = parseTimingLine(lines[timingIndex]!, true)
    const text = lines.slice(timingIndex + 1).join('\n').trim()
    if (text.length === 0) invalidCue(index)
    const suppliedId = timingIndex > 0 ? lines[0]!.trim() : ''
    return {
      id: stableCueId(suppliedId, index),
      startUs: start,
      endUs: end,
      text
    }
  })
}

function parseVtt(source: string): TranscriptSegment[] {
  const normalized = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').trim()
  const withoutHeader = normalized.startsWith('WEBVTT')
    ? normalized.replace(/^WEBVTT[^\n]*\n?/u, '')
    : normalized
  if (withoutHeader.trim().length === 0) return []
  return withoutHeader.trim().split(/\n{2,}/u).flatMap((block, index) => {
    const lines = block.split('\n')
    if (/^(NOTE|STYLE|REGION)(?:\s|$)/u.test(lines[0] ?? '')) return []
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex < 0) invalidCue(index)
    const [start, end] = parseTimingLine(lines[timingIndex]!, false)
    const text = lines.slice(timingIndex + 1).join('\n').trim()
    if (text.length === 0) invalidCue(index)
    return [{
      id: stableCueId(timingIndex > 0 ? lines[0]!.trim() : '', index),
      startUs: start,
      endUs: end,
      text
    }]
  })
}

function parseJsonTranscript(source: string): TranscriptSegment[] {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw engineError('transcript_invalid', 'Transcript JSON is malformed')
  }
  const segmentsValue = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.segments)
      ? value.segments
      : undefined
  if (!segmentsValue) {
    throw engineError('transcript_invalid', 'Transcript JSON must contain a segments array')
  }
  return segmentsValue.map((entry, index) => parseJsonSegment(entry, index))
}

function parseJsonSegment(value: unknown, index: number): TranscriptSegment {
  if (!isRecord(value)) invalidCue(index)
  const startUs = timingInteger(value.startUs, value.start, `segments[${index}].start`)
  const endUs = timingInteger(value.endUs, value.end, `segments[${index}].end`)
  if (typeof value.text !== 'string' || value.text.trim().length === 0) invalidCue(index)
  const words = value.words === undefined
    ? undefined
    : Array.isArray(value.words)
      ? value.words.map((word, wordIndex) => parseJsonWord(word, index, wordIndex))
      : invalidCue(index)
  return {
    id: stableCueId(typeof value.id === 'string' ? value.id : '', index),
    startUs,
    endUs,
    text: value.text,
    ...(words === undefined ? {} : { words })
  }
}

function parseJsonWord(value: unknown, segmentIndex: number, wordIndex: number): TranscriptWord {
  if (!isRecord(value) || typeof value.text !== 'string') invalidCue(segmentIndex)
  return {
    id: stableCueId(
      typeof value.id === 'string' ? value.id : `word-${segmentIndex + 1}-${wordIndex + 1}`,
      wordIndex
    ),
    startUs: timingInteger(value.startUs, value.start, 'word.start'),
    endUs: timingInteger(value.endUs, value.end, 'word.end'),
    text: value.text,
    ...(typeof value.confidence === 'number' ? { confidence: value.confidence } : {})
  }
}

function timingInteger(microseconds: unknown, seconds: unknown, path: string): number {
  const value = Number.isSafeInteger(microseconds)
    ? Number(microseconds)
    : typeof seconds === 'number' && Number.isFinite(seconds)
      ? Math.round(seconds * 1_000_000)
      : NaN
  if (!Number.isSafeInteger(value) || value < 0) {
    throw engineError('transcript_invalid', `${path} must be integer microseconds or finite seconds`)
  }
  return value
}

function parseTimingLine(line: string, commaRequired: boolean): [number, number] {
  const parts = line.split('-->')
  if (parts.length !== 2) throw engineError('transcript_invalid', 'Subtitle cue has invalid timing')
  const start = parseTimestamp(parts[0]!.trim(), commaRequired)
  const endToken = parts[1]!.trim().split(/\s+/u)[0]!
  const end = parseTimestamp(endToken, commaRequired)
  if (end <= start) throw engineError('transcript_invalid', 'Subtitle cue has an empty timing range')
  return [start, end]
}

function parseTimestamp(value: string, commaRequired: boolean): number {
  const separator = commaRequired ? ',' : '[.,]'
  const match = new RegExp(`^(?:(\\d{1,2}):)?(\\d{2}):(\\d{2})${separator}(\\d{3})$`, 'u').exec(value)
  if (!match) throw engineError('transcript_invalid', `Invalid subtitle timestamp: ${value}`)
  const hours = Number(match[1] ?? 0)
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const milliseconds = Number(match[4])
  if (minutes > 59 || seconds > 59) {
    throw engineError('transcript_invalid', `Invalid subtitle timestamp: ${value}`)
  }
  return ((hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds) * 1000
}

function validateWords(segment: TranscriptSegment): void {
  let previousEnd = segment.startUs
  const ids = new Set<string>()
  for (const word of segment.words ?? []) {
    if (
      !isStableId(word.id) ||
      word.startUs < segment.startUs ||
      word.endUs > segment.endUs ||
      word.endUs <= word.startUs ||
      word.startUs < previousEnd ||
      ids.has(word.id)
    ) {
      throw engineError('transcript_invalid', 'Transcript words must have ordered in-segment timing')
    }
    ids.add(word.id)
    previousEnd = word.endUs
  }
}

function mergeRanges(ranges: AssetTimeRange[]): AssetTimeRange[] {
  const sorted = ranges.sort((left, right) => left.startUs - right.startUs || left.endUs - right.endUs)
  const merged: AssetTimeRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (previous && previous.assetId === range.assetId && range.startUs <= previous.endUs) {
      previous.endUs = Math.max(previous.endUs, range.endUs)
    } else merged.push({ ...range })
  }
  return merged
}

function extractJsonLanguage(source: string, format: TranscriptFormat): string | undefined {
  if (format !== 'json') return undefined
  try {
    const value: unknown = JSON.parse(source)
    return isRecord(value) && typeof value.language === 'string' ? value.language : undefined
  } catch {
    return undefined
  }
}

function normalizeToken(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')
}

function stableCueId(value: string, index: number): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._~-]+/gu, '-').replace(/^-+|-+$/gu, '')
  return isStableId(normalized) ? normalized : `segment-${index + 1}`
}

function isStableId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(value)
}

function invalidCue(index: number): never {
  throw engineError('transcript_invalid', `Transcript cue ${index + 1} is invalid`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function defaultCanExecute(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
