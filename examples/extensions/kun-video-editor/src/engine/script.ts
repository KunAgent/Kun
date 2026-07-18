import { createHash } from 'node:crypto'
import { engineError } from './errors.js'
import type { Rational, TimelineItem, TranscriptSegment, VideoProject } from './schema.js'
import { microsecondsToFrames } from './time.js'
import {
  assertValidTimeline,
  removeAssetTimeRanges,
  type AssetTimeRange
} from './timeline.js'

const HEADER_PREFIX = '<!-- kun-video-timeline '
const HEADER_SUFFIX = ' -->'

export type TimelineScriptHeader = {
  schemaVersion: 1
  projectId: string
  revision: number
  digest: string
}

export type ApplyTimelineScriptResult = {
  project: VideoProject
  removed: AssetTimeRange[]
  changedIds: string[]
}

export function generateTimelineMarkdown(project: VideoProject): string {
  assertValidTimeline(project)
  const body = generateBody(project)
  const header: TimelineScriptHeader = {
    schemaVersion: 1,
    projectId: project.id,
    revision: project.currentRevision,
    digest: digest(body)
  }
  return `${HEADER_PREFIX}${JSON.stringify(header)}${HEADER_SUFFIX}\n${body}`
}

export function parseTimelineScriptHeader(markdown: string): TimelineScriptHeader {
  const firstLineEnd = markdown.indexOf('\n')
  const firstLine = firstLineEnd < 0 ? markdown : markdown.slice(0, firstLineEnd)
  if (!firstLine.startsWith(HEADER_PREFIX) || !firstLine.endsWith(HEADER_SUFFIX)) {
    throw engineError('script_invalid', 'timeline.md does not contain a Kun timeline header')
  }
  let value: unknown
  try {
    value = JSON.parse(firstLine.slice(HEADER_PREFIX.length, -HEADER_SUFFIX.length))
  } catch {
    throw engineError('script_invalid', 'timeline.md contains an invalid header')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw engineError('script_invalid', 'timeline.md header must be an object')
  }
  const header = value as Record<string, unknown>
  if (
    header.schemaVersion !== 1 ||
    typeof header.projectId !== 'string' ||
    !Number.isSafeInteger(header.revision) ||
    Number(header.revision) < 0 ||
    typeof header.digest !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(header.digest)
  ) {
    throw engineError('script_invalid', 'timeline.md header contains invalid identity or digest fields')
  }
  return header as TimelineScriptHeader
}

export function validateTimelineMarkdown(project: VideoProject, markdown: string): TimelineScriptHeader {
  const header = parseTimelineScriptHeader(markdown)
  if (header.projectId !== project.id || header.revision !== project.currentRevision) {
    throw engineError('script_stale', 'timeline.md is based on a different project revision', {
      scriptProjectId: header.projectId,
      scriptRevision: header.revision,
      projectId: project.id,
      currentRevision: project.currentRevision
    })
  }
  const firstLineEnd = markdown.indexOf('\n')
  const body = firstLineEnd < 0 ? '' : markdown.slice(firstLineEnd + 1)
  if (digest(body) !== header.digest) {
    throw engineError('script_invalid', 'timeline.md content does not match its recorded digest')
  }
  if (markdown !== generateTimelineMarkdown(project)) {
    throw engineError(
      'script_invalid',
      'timeline.md is not the deterministic projection of the authoritative project'
    )
  }
  return header
}

export function applyTimelineScript(
  project: VideoProject,
  markdown: string,
  ranges: readonly AssetTimeRange[]
): ApplyTimelineScriptResult {
  validateTimelineMarkdown(project, markdown)
  if (ranges.length === 0) {
    throw engineError('invalid_operation', 'A script edit must contain at least one timed source range')
  }
  return removeAssetTimeRanges(project, ranges)
}

function generateBody(project: VideoProject): string {
  const lines = [
    `# ${escapeMarkdown(project.name)}`,
    '',
    `Project: \`${project.id}\`  `,
    `Revision: \`${project.currentRevision}\`  `,
    `Frame rate: \`${project.fps.numerator}/${project.fps.denominator}\``,
    '',
    '## Timeline',
    ''
  ]
  const trackOrder = new Map(project.tracks.map((track) => [track.id, track.order]))
  const items = [...project.items].sort((left, right) =>
    left.timelineStartFrame - right.timelineStartFrame ||
    (trackOrder.get(left.trackId) ?? 0) - (trackOrder.get(right.trackId) ?? 0) ||
    left.id.localeCompare(right.id)
  )
  if (items.length === 0) lines.push('_No media items._', '')
  for (const item of items) {
    const asset = item.nestedSequenceId === undefined
      ? project.assets.find(({ id }) => id === item.assetId)
      : undefined
    const sourceReference = item.nestedSequenceId === undefined
      ? `Asset \`${asset!.id}\``
      : `Sequence \`${item.nestedSequenceId}\``
    const timelineEnd = item.timelineStartFrame + item.durationFrames
    lines.push(
      `### Item \`${item.id}\` · ${sourceReference}`,
      '',
      `- Track: \`${item.trackId}\``,
      `- Timeline: \`${formatFrameTime(item.timelineStartFrame, project.fps)} → ${formatFrameTime(timelineEnd, project.fps)}\``,
      ...(item.nestedSequenceId === undefined
        ? [`- Source: \`${formatMicroseconds(item.sourceStartUs)} → ${formatMicroseconds(item.sourceEndUs)}\``]
        : [`- Nested sequence: \`${item.nestedSequenceId}\``]),
      ''
    )
    if (asset === undefined) {
      lines.push('_Nested sequence content is projected from its child timeline._', '')
      continue
    }
    const transcript = project.transcripts.find(({ assetId }) => assetId === asset.id)
    const segments = transcript?.segments.filter((segment) =>
      segment.startUs < item.sourceEndUs && segment.endUs > item.sourceStartUs
    ) ?? []
    if (segments.length === 0) {
      lines.push('_No timed transcript for this source range._', '')
      continue
    }
    lines.push('| Segment | Source | Timeline | Text |', '| --- | --- | --- | --- |')
    for (const segment of segments) {
      const sourceStart = Math.max(segment.startUs, item.sourceStartUs)
      const sourceEnd = Math.min(segment.endUs, item.sourceEndUs)
      const timelineStart = sourceUsToTimelineFrame(item, sourceStart, project.fps)
      const timelineEndFrame = sourceUsToTimelineFrame(item, sourceEnd, project.fps)
      lines.push(
        `| \`${segment.id}\` | ${formatMicroseconds(sourceStart)} → ${formatMicroseconds(sourceEnd)} | ${formatFrameTime(timelineStart, project.fps)} → ${formatFrameTime(timelineEndFrame, project.fps)} | ${escapeTableText(segment)} |`
      )
    }
    lines.push('')
  }

  lines.push('## Captions', '')
  if (project.captions.length === 0) lines.push('_No captions._', '')
  else {
    lines.push('| Caption | Timeline | Text |', '| --- | --- | --- |')
    for (const caption of [...project.captions].sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id))) {
      lines.push(
        `| \`${caption.id}\` | ${formatFrameTime(caption.startFrame, project.fps)} → ${formatFrameTime(caption.endFrame, project.fps)} | ${escapeTableValue(caption.text)} |`
      )
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

function sourceUsToTimelineFrame(item: TimelineItem, sourceUs: number, fps: Rational): number {
  const sourceDelta = sourceUs - item.sourceStartUs
  const timelineUs = Math.round(sourceDelta * item.speed.denominator / item.speed.numerator)
  return item.timelineStartFrame + microsecondsToFrames(timelineUs, fps)
}

function escapeTableText(segment: TranscriptSegment): string {
  return escapeTableValue(segment.text)
}

function escapeTableValue(value: string): string {
  return value
    .replace(/\\/gu, '\\\\')
    .replace(/\r?\n/gu, ' ')
    .replace(/\|/gu, '\\|')
    .trim()
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!|-]/gu, '\\$&')
}

function formatFrameTime(frame: number, fps: Rational): string {
  const microseconds = Math.round(frame * fps.denominator * 1_000_000 / fps.numerator)
  return formatMicroseconds(microseconds)
}

function formatMicroseconds(microseconds: number): string {
  const milliseconds = Math.floor(microseconds / 1000)
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const seconds = Math.floor((milliseconds % 60_000) / 1000)
  const millis = milliseconds % 1000
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':') +
    `.${String(millis).padStart(3, '0')}`
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
