import { engineError } from './errors.js'
import type {
  Caption,
  Rational,
  TimelineItem,
  TimelineOperation,
  Transcript,
  TranscriptSegment,
  VideoProject
} from './schema.js'
import { microsecondsToFrames, normalizeRational } from './time.js'

export type CaptionWordTiming = {
  id: string
  text: string
  startFrame: number
  endFrame: number
  sourceWordId?: string
  sourceStartUs: number
  sourceEndUs: number
  timing: 'provided' | 'interpolated'
}

export type EditableCaptionClip = {
  id: string
  trackId: string
  startFrame: number
  endFrame: number
  text: string
  placement: 'top' | 'center' | 'bottom'
  style: {
    fontSize: number
    color: string
    background: string
    fontFamily?: string
    fontWeight?: number
    maxWidthRatio: number
  }
  animation: {
    kind: 'none' | 'fade' | 'word-highlight'
    durationFrames?: number
  }
  source: {
    transcriptId: string
    segmentIds: string[]
    assetId: string
    itemId: string
  }
  words: CaptionWordTiming[]
}

export type CaptionBuildOptions = {
  trackId: string
  idPrefix?: string
  maxWords?: number
  maxRenderedWidthPx?: number
  maxDurationFrames?: number
  placement?: EditableCaptionClip['placement']
  style?: Partial<EditableCaptionClip['style']>
  animation?: EditableCaptionClip['animation']
  measureText?: (text: string, style: EditableCaptionClip['style']) => number
}

export type CaptionBuildPlan = {
  schemaVersion: 1
  projectId: string
  expectedRevision: number
  captions: EditableCaptionClip[]
  operations: TimelineOperation[]
  warnings: string[]
  interpolatedWordCount: number
}

type SourceToken = {
  id: string
  segmentId: string
  text: string
  startUs: number
  endUs: number
  timing: 'provided' | 'interpolated'
  sourceWordId?: string
}

const DEFAULT_STYLE: EditableCaptionClip['style'] = Object.freeze({
  fontSize: 42,
  color: '#FFFFFF',
  background: '#000000',
  maxWidthRatio: 0.84
})

export function buildEditableCaptions(
  project: VideoProject,
  transcripts: readonly Transcript[],
  options: CaptionBuildOptions
): CaptionBuildPlan {
  const track = project.tracks.find(({ id }) => id === options.trackId)
  if (!track || track.kind !== 'caption') {
    throw engineError('invalid_operation', 'Caption generation requires an existing caption track')
  }
  const maxWords = boundedInteger(options.maxWords ?? 8, 1, 24, 'maxWords')
  const maxRenderedWidthPx = boundedInteger(options.maxRenderedWidthPx ?? 960, 80, 4096, 'maxRenderedWidthPx')
  const maxDurationFrames = boundedInteger(options.maxDurationFrames ?? 180, 1, 3600, 'maxDurationFrames')
  const style: EditableCaptionClip['style'] = {
    ...DEFAULT_STYLE,
    ...options.style,
    maxWidthRatio: options.style?.maxWidthRatio ?? DEFAULT_STYLE.maxWidthRatio
  }
  validateCaptionStyle(style)
  const measure = options.measureText ?? estimateRenderedWidth
  const animation = options.animation ?? { kind: 'none' as const }
  const placement = options.placement ?? 'bottom'
  const warnings: string[] = []
  const clips: EditableCaptionClip[] = []
  let sequence = 0

  for (const transcript of transcripts) {
    const items = project.items
      .filter(({ assetId }) => assetId === transcript.assetId)
      .sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || left.id.localeCompare(right.id))
    if (items.length === 0) {
      warnings.push(`Transcript ${transcript.id} has no visible timeline item.`)
      continue
    }
    const tokens = transcript.segments.flatMap(segmentTokens)
    for (const item of items) {
      const visible = tokens.flatMap((token) => clipToken(token, item))
      if (visible.length === 0) continue
      for (const group of groupTokens(visible, {
        maxWords,
        maxRenderedWidthPx,
        maxDurationFrames,
        style,
        measure,
        item,
        fps: project.fps
      })) {
        const words = group.map((token, index): CaptionWordTiming => {
          const startFrame = sourceUsToTimelineFrame(item, token.startUs, project.fps)
          const endFrame = Math.max(startFrame + 1, sourceUsToTimelineFrame(item, token.endUs, project.fps))
          return {
            id: `${safePrefix(options.idPrefix ?? 'caption-word')}-${sequence}-${index}`.slice(0, 128),
            text: token.text,
            startFrame,
            endFrame,
            ...(token.sourceWordId === undefined ? {} : { sourceWordId: token.sourceWordId }),
            sourceStartUs: token.startUs,
            sourceEndUs: token.endUs,
            timing: token.timing
          }
        })
        const startFrame = words[0]!.startFrame
        const endFrame = words.at(-1)!.endFrame
        const text = joinTokens(group.map(({ text: value }) => value))
        const id = `${safePrefix(options.idPrefix ?? `caption-${transcript.id}`)}-${sequence}`.slice(0, 128)
        sequence += 1
        clips.push({
          id,
          trackId: options.trackId,
          startFrame,
          endFrame,
          text,
          placement,
          style: { ...style },
          animation: { ...animation },
          source: {
            transcriptId: transcript.id,
            segmentIds: [...new Set(group.map(({ segmentId }) => segmentId))],
            assetId: transcript.assetId,
            itemId: item.id
          },
          words
        })
      }
    }
  }

  const captions = removeOverlaps(clips, warnings).slice(0, 2_000)
  if (clips.length > captions.length && clips.length > 2_000) {
    warnings.push(`Caption plan was bounded to 2000 clips; ${clips.length - 2_000} clips were omitted.`)
  }
  const operations = captions.map((caption): TimelineOperation => ({
    type: 'add-caption',
    caption: baseCaption(caption)
  }))
  return {
    schemaVersion: 1,
    projectId: project.id,
    expectedRevision: project.currentRevision,
    captions,
    operations,
    warnings: warnings.slice(0, 100),
    interpolatedWordCount: captions.reduce(
      (total, caption) => total + caption.words.filter(({ timing }) => timing === 'interpolated').length,
      0
    )
  }
}

function segmentTokens(segment: TranscriptSegment): SourceToken[] {
  if (segment.words?.length) {
    return segment.words.map((word) => ({
      id: word.id,
      segmentId: segment.id,
      text: word.text,
      startUs: word.startUs,
      endUs: word.endUs,
      timing: 'provided',
      sourceWordId: word.id
    }))
  }
  const tokens = tokenizeText(segment.text)
  if (tokens.length === 0) return []
  const weights = tokens.map(tokenWeight)
  const totalWeight = weights.reduce((total, weight) => total + weight, 0)
  const duration = segment.endUs - segment.startUs
  let weightCursor = 0
  return tokens.map((text, index) => {
    const startUs = segment.startUs + Math.round(duration * weightCursor / totalWeight)
    weightCursor += weights[index]!
    const endUs = index === tokens.length - 1
      ? segment.endUs
      : segment.startUs + Math.round(duration * weightCursor / totalWeight)
    return {
      id: `${segment.id}-interpolated-${index}`.slice(0, 128),
      segmentId: segment.id,
      text,
      startUs,
      endUs: Math.max(startUs + 1, endUs),
      timing: 'interpolated'
    }
  })
}

function clipToken(token: SourceToken, item: TimelineItem): SourceToken[] {
  const startUs = Math.max(token.startUs, item.sourceStartUs)
  const endUs = Math.min(token.endUs, item.sourceEndUs)
  return endUs <= startUs ? [] : [{ ...token, startUs, endUs }]
}

function groupTokens(
  tokens: readonly SourceToken[],
  options: {
    maxWords: number
    maxRenderedWidthPx: number
    maxDurationFrames: number
    style: EditableCaptionClip['style']
    measure: NonNullable<CaptionBuildOptions['measureText']>
    item: TimelineItem
    fps: Rational
  }
): SourceToken[][] {
  const groups: SourceToken[][] = []
  let current: SourceToken[] = []
  const flush = (): void => {
    if (current.length > 0) groups.push(current)
    current = []
  }
  for (const token of tokens) {
    const proposed = [...current, token]
    const text = joinTokens(proposed.map(({ text: value }) => value))
    const startFrame = sourceUsToTimelineFrame(options.item, proposed[0]!.startUs, options.fps)
    const endFrame = sourceUsToTimelineFrame(options.item, proposed.at(-1)!.endUs, options.fps)
    const exceeds = proposed.length > options.maxWords ||
      options.measure(text, options.style) > options.maxRenderedWidthPx ||
      endFrame - startFrame > options.maxDurationFrames
    if (exceeds && current.length > 0) flush()
    current.push(token)
    if (endsSentence(token.text) || current.length >= options.maxWords) flush()
  }
  flush()
  return groups
}

function removeOverlaps(clips: readonly EditableCaptionClip[], warnings: string[]): EditableCaptionClip[] {
  const ordered = [...clips].sort((left, right) => left.startFrame - right.startFrame || left.id.localeCompare(right.id))
  const result: EditableCaptionClip[] = []
  for (const clip of ordered) {
    const previous = result.at(-1)
    if (!previous || clip.startFrame >= previous.endFrame) {
      result.push(clip)
      continue
    }
    if (clip.endFrame <= previous.endFrame) {
      warnings.push(`Caption ${clip.id} was omitted because its visible range was fully overlapped.`)
      continue
    }
    warnings.push(`Caption ${clip.id} was clamped to avoid overlap on ${clip.trackId}.`)
    result.push({
      ...clip,
      startFrame: previous.endFrame,
      words: clip.words
        .filter(({ endFrame }) => endFrame > previous.endFrame)
        .map((word) => ({ ...word, startFrame: Math.max(previous.endFrame, word.startFrame) }))
    })
  }
  return result.filter(({ endFrame, startFrame, words }) => endFrame > startFrame && words.length > 0)
}

function baseCaption(caption: EditableCaptionClip): Caption {
  return {
    id: caption.id,
    trackId: caption.trackId,
    startFrame: caption.startFrame,
    endFrame: caption.endFrame,
    text: caption.text,
    placement: caption.placement,
    style: {
      fontSize: caption.style.fontSize,
      color: caption.style.color,
      background: caption.style.background,
      ...(caption.style.fontFamily === undefined ? {} : { fontFamily: caption.style.fontFamily }),
      ...(caption.style.fontWeight === undefined ? {} : { fontWeight: caption.style.fontWeight }),
      maxWidthRatio: caption.style.maxWidthRatio
    },
    sourceTranscriptId: caption.source.transcriptId,
    sourceSegmentIds: [...caption.source.segmentIds],
    words: caption.words.map((word) => ({
      id: word.id,
      text: word.text,
      startFrame: word.startFrame,
      endFrame: word.endFrame,
      ...(word.sourceWordId === undefined ? {} : { sourceWordId: word.sourceWordId })
    })),
    animation: { ...caption.animation }
  }
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

function tokenizeText(text: string): string[] {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  if (!normalized) return []
  if (/\s/u.test(normalized)) return normalized.match(/\S+/gu) ?? []
  return normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? [normalized]
}

function joinTokens(tokens: readonly string[]): string {
  let output = ''
  for (const token of tokens) {
    if (!output) output = token
    else if (/^[,.;:!?，。；：！？、）】》]/u.test(token) || isCjkBoundary(output.at(-1)!, token[0]!)) output += token
    else output += ` ${token}`
  }
  return output
}

function isCjkBoundary(left: string, right: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(left) ||
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(right)
}

function tokenWeight(token: string): number {
  return Math.max(1, [...token].length)
}

function endsSentence(text: string): boolean {
  return /[.!?。！？]["'”’）】》]*$/u.test(text)
}

function estimateRenderedWidth(text: string, style: EditableCaptionClip['style']): number {
  let units = 0
  for (const character of text) {
    units += /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(character)
      ? 1
      : /[A-Z0-9]/u.test(character)
        ? 0.66
        : /\s/u.test(character)
          ? 0.32
          : 0.54
  }
  return units * style.fontSize
}

function validateCaptionStyle(style: EditableCaptionClip['style']): void {
  if (!Number.isFinite(style.fontSize) || style.fontSize < 8 || style.fontSize > 256) {
    throw engineError('invalid_operation', 'Caption font size must be between 8 and 256')
  }
  if (!/^#[0-9A-Fa-f]{6}$/u.test(style.color) || !/^#[0-9A-Fa-f]{6}$/u.test(style.background)) {
    throw engineError('invalid_operation', 'Caption colors must be six-digit hexadecimal values')
  }
  if (!Number.isFinite(style.maxWidthRatio) || style.maxWidthRatio <= 0 || style.maxWidthRatio > 1) {
    throw engineError('invalid_operation', 'Caption max-width ratio must be in (0, 1]')
  }
}

function safePrefix(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._~-]+/gu, '-').replace(/^-+|-+$/gu, '')
  return (normalized || 'caption').slice(0, 96)
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw engineError('invalid_operation', `${name} must be an integer from ${minimum} through ${maximum}`)
  }
  return value
}
