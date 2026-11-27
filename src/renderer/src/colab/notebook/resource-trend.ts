import type { ColabResourceSample } from '@shared/colab/colab-types'

export type ResourceMetricPoint = {
  at: number
  value: number
}

export type ResourceMetricSummary = {
  latest: number | null
  mean: number | null
  peak: number | null
  count: number
}

/**
 * Values stay aligned with the window samples so hover/readouts can address a
 * sample by index. Segments are split on null measurements and real time gaps,
 * which keeps a missing scrape from being drawn as a straight interpolation.
 */
export type ResourceMetricSeries = {
  values: Array<number | null>
  segments: ResourceMetricPoint[][]
  summary: ResourceMetricSummary
}

export type ResourceWindow = {
  samples: ColabResourceSample[]
  startMs: number
  endMs: number
}

export type ResourceTimeTick = {
  at: number
  offsetMs: number
  fraction: number
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** GPU percentages accept 0 but reject missing/negative values. */
export function percentValue(value: number | null | undefined): number | null {
  if (!isFiniteNumber(value) || value < 0) return null
  return Math.min(100, value)
}

/** Use the measured capacity, not the hardware catalogue estimate. */
export function ratioPercent(
  used: number | null | undefined,
  total: number | null | undefined
): number | null {
  if (!isFiniteNumber(used) || used < 0) return null
  if (!isFiniteNumber(total) || total <= 0) return null
  return Math.min(100, (used / total) * 100)
}

export function positiveNumber(value: number | null | undefined): number | null {
  return isFiniteNumber(value) && value > 0 ? value : null
}

/**
 * Window end follows the newest sample when it is slightly ahead of the local
 * clock, so a just-arrived sample is never hidden by clock skew. Old samples
 * leave the window normally, leaving a visible trailing gap when sampling stops.
 */
export function buildResourceWindow(
  rawSamples: readonly ColabResourceSample[] | null | undefined,
  nowMs: number,
  windowMs: number
): ResourceWindow {
  const safeNow = isFiniteNumber(nowMs) ? nowMs : Date.now()
  const span = isFiniteNumber(windowMs) && windowMs > 0 ? windowMs : 0
  let endMs = safeNow

  for (const sample of rawSamples ?? []) {
    if (isFiniteNumber(sample?.at) && sample.at > endMs) endMs = sample.at
  }

  const startMs = endMs - span
  const byTimestamp = new Map<number, ColabResourceSample>()
  for (const sample of rawSamples ?? []) {
    if (!isFiniteNumber(sample?.at) || sample.at < startMs) continue
    byTimestamp.set(sample.at, sample)
  }

  const samples = [...byTimestamp.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, sample]) => sample)

  return { samples, startMs, endMs }
}

export function buildMetricSeries(
  samples: readonly ColabResourceSample[],
  valueAt: (sample: ColabResourceSample) => number | null,
  gapMs: number
): ResourceMetricSeries {
  const values: Array<number | null> = new Array(samples.length).fill(null)
  const segments: ResourceMetricPoint[][] = []
  const effectiveGapMs =
    isFiniteNumber(gapMs) && gapMs > 0 ? gapMs : Number.POSITIVE_INFINITY
  let current: ResourceMetricPoint[] | null = null
  let previousAt: number | null = null

  samples.forEach((sample, index) => {
    const value = valueAt(sample)
    if (!isFiniteNumber(value)) {
      current = null
      previousAt = null
      return
    }

    values[index] = value
    if (
      current &&
      previousAt !== null &&
      sample.at - previousAt > effectiveGapMs
    ) {
      current = null
    }
    if (!current) {
      current = []
      segments.push(current)
    }
    current.push({ at: sample.at, value })
    previousAt = sample.at
  })

  let count = 0
  let total = 0
  let peak: number | null = null
  for (const value of values) {
    if (value === null) continue
    count += 1
    total += value
    peak = peak === null ? value : Math.max(peak, value)
  }

  return {
    values,
    segments,
    summary: {
      latest: values[values.length - 1] ?? null,
      mean: count > 0 ? total / count : null,
      peak,
      count
    }
  }
}

/** Newest real scrape even when it has already left the chart window. */
export function latestFiniteSample(
  samples: readonly ColabResourceSample[]
): ColabResourceSample | null {
  let latest: ColabResourceSample | null = null
  for (const sample of samples) {
    if (!isFiniteNumber(sample?.at)) continue
    if (!latest || sample.at > latest.at) latest = sample
  }
  return latest
}

/** One skipped scrape must split the line, while normal jitter stays connected. */
export function resourceGapThresholdMs(intervalMs: number): number {
  const interval = isFiniteNumber(intervalMs) && intervalMs > 0 ? intervalMs : 5000
  return interval * 1.75
}

/** A scrape older than three intervals means the live stream has stalled. */
export function isResourceSampleStale(
  latestAt: number | null | undefined,
  nowMs: number,
  intervalMs: number
): boolean {
  if (!isFiniteNumber(latestAt) || !isFiniteNumber(nowMs)) return false
  const interval = isFiniteNumber(intervalMs) && intervalMs > 0 ? intervalMs : 5000
  return nowMs - latestAt > interval * 3
}

export function pickNearestSampleIndex(
  samples: readonly ColabResourceSample[],
  atMs: number
): number {
  if (samples.length === 0 || !isFiniteNumber(atMs)) return -1
  let best = 0
  let bestDistance = Math.abs(samples[0].at - atMs)
  for (let index = 1; index < samples.length; index += 1) {
    const distance = Math.abs(samples[index].at - atMs)
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  }
  return best
}

export function buildTimeTicks(
  startMs: number,
  endMs: number,
  count = 6
): ResourceTimeTick[] {
  if (!isFiniteNumber(startMs) || !isFiniteNumber(endMs) || endMs <= startMs) {
    return []
  }
  const tickCount = Math.max(2, Math.floor(count))
  return Array.from({ length: tickCount }, (_, index) => {
    const fraction = index / (tickCount - 1)
    const at = startMs + Math.round((endMs - startMs) * fraction)
    return {
      at,
      offsetMs: at - endMs,
      fraction
    }
  })
}

export function xForTime(
  at: number,
  startMs: number,
  endMs: number,
  left: number,
  width: number
): number {
  if (
    !isFiniteNumber(at) ||
    !isFiniteNumber(startMs) ||
    !isFiniteNumber(endMs) ||
    endMs <= startMs ||
    width <= 0
  ) {
    return left
  }
  const fraction = Math.min(1, Math.max(0, (at - startMs) / (endMs - startMs)))
  return left + fraction * width
}

export function yForPercent(
  value: number,
  top: number,
  height: number,
  max = 100
): number {
  const safeMax = isFiniteNumber(max) && max > 0 ? max : 100
  const safeValue = isFiniteNumber(value) ? value : 0
  const clamped = Math.min(safeMax, Math.max(0, safeValue))
  return top + ((safeMax - clamped) * height) / safeMax
}
