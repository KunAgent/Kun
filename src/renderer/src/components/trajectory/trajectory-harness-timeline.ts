import type { HarnessCell } from './trajectory-harness-model'

export type HarnessTimelineMode = 'sequence' | 'duration' | 'time' | 'actual'
export type HarnessTimelineRange = { start: number; end: number }

export type HarnessTimelineSpan = HarnessTimelineRange & {
  id: string
  index: number
  lane: 0 | 1 | 2
  kind: HarnessCell['kind']
  error: boolean
  turn: number
  ttftFraction?: number
}

export type HarnessTimelineModel = HarnessTimelineRange & {
  spans: HarnessTimelineSpan[]
  boundaries: Array<{ turn: number; time: number }>
}

export function deriveHarnessTimeline(
  cells: readonly HarnessCell[],
  mode: HarnessTimelineMode
): HarnessTimelineModel | null {
  if (!cells.length) return null
  if (mode === 'sequence') return sequenceTimeline(cells)
  return timedTimeline(cells, mode)
}

export function harnessTimelineFocusIds(
  model: HarnessTimelineModel | null,
  range: HarnessTimelineRange | null
): ReadonlySet<string> | null {
  if (!model || !range) return null
  return new Set(model.spans
    .filter((span) => span.end >= range.start && span.start <= range.end)
    .map((span) => span.id))
}

function sequenceTimeline(cells: readonly HarnessCell[]): HarnessTimelineModel {
  const spans = cells.map((cell, index): HarnessTimelineSpan => ({
    id: cell.id,
    index,
    lane: lane(cell.kind),
    kind: cell.kind,
    error: cell.status === 'failed',
    turn: cell.turn,
    start: index,
    end: index + 1,
    ...assistantTtft(cell)
  }))
  return {
    start: 0,
    end: Math.max(1, cells.length),
    spans,
    boundaries: turnBoundaries(spans)
  }
}

function timedTimeline(
  cells: readonly HarnessCell[],
  mode: Exclude<HarnessTimelineMode, 'sequence'>
): HarnessTimelineModel {
  const actualDuration = mode === 'duration' || mode === 'actual'
  const compressIdle = mode === 'duration'
  const raw = cells.map((cell, index) => {
    const start = cell.startedAt ?? index
    const width = actualDuration ? Math.max(1, cell.durationMs ?? 1) : 1
    return { cell, index, start, end: start + width }
  }).sort((a, b) => a.start - b.start || a.index - b.index)
  let removed = 0
  let previousEnd = raw[0]?.start ?? 0
  const spans: HarnessTimelineSpan[] = []
  for (const entry of raw) {
    if (compressIdle && entry.start > previousEnd) removed += entry.start - previousEnd
    const start = entry.start - removed
    const end = entry.end - removed
    spans.push({
      id: entry.cell.id,
      index: entry.index,
      lane: lane(entry.cell.kind),
      kind: entry.cell.kind,
      error: entry.cell.status === 'failed',
      turn: entry.cell.turn,
      start,
      end,
      ...assistantTtft(entry.cell)
    })
    previousEnd = Math.max(previousEnd, entry.end)
  }
  spans.sort((a, b) => a.index - b.index)
  const start = Math.min(...spans.map((span) => span.start))
  const end = Math.max(start + 1, ...spans.map((span) => span.end))
  return { start, end, spans, boundaries: turnBoundaries(spans) }
}

function assistantTtft(cell: HarnessCell): { ttftFraction?: number } {
  const request = cell.request?.request
  const ttft = request?.usage?.requestTtftMs
  const generation = request?.usage?.requestGenerationMs
  if (cell.kind !== 'assistant' || !ttft || !generation || ttft + generation <= 0) return {}
  return { ttftFraction: Math.min(1, Math.max(0, ttft / (ttft + generation))) }
}

function turnBoundaries(spans: readonly HarnessTimelineSpan[]): Array<{ turn: number; time: number }> {
  const seen = new Set<number>()
  const out: Array<{ turn: number; time: number }> = []
  for (const span of spans) {
    if (span.turn <= 0 || seen.has(span.turn)) continue
    seen.add(span.turn)
    out.push({ turn: span.turn, time: span.start })
  }
  return out
}

function lane(kind: HarnessCell['kind']): 0 | 1 | 2 {
  if (kind === 'tool' || kind === 'subtool') return 2
  if (kind === 'assistant' || kind === 'compacted' || kind === 'request') return 1
  return 0
}
