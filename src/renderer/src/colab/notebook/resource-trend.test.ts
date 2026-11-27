import { describe, expect, it } from 'vitest'
import type { ColabResourceSample } from '@shared/colab/colab-types'
import {
  buildMetricSeries,
  buildResourceWindow,
  buildTimeTicks,
  isResourceSampleStale,
  latestFiniteSample,
  percentValue,
  pickNearestSampleIndex,
  positiveNumber,
  ratioPercent,
  resourceGapThresholdMs,
  xForTime,
  yForPercent
} from './resource-trend'

const NOW = Date.UTC(2026, 10, 27, 3, 32, 0)

function sample(
  offsetMs: number,
  patch: Partial<ColabResourceSample> = {}
): ColabResourceSample {
  return {
    at: NOW + offsetMs,
    gpuPct: null,
    vramUsedGiB: null,
    vramTotalGiB: null,
    ramUsedGiB: null,
    ramTotalGiB: null,
    diskPct: null,
    ...patch
  }
}

describe('resource sample validation', () => {
  it('keeps zero and clamps utilization while rejecting missing or negative data', () => {
    expect(percentValue(0)).toBe(0)
    expect(percentValue(42.5)).toBe(42.5)
    expect(percentValue(120)).toBe(100)
    expect(percentValue(null)).toBeNull()
    expect(percentValue(undefined)).toBeNull()
    expect(percentValue(Number.NaN)).toBeNull()
    expect(percentValue(-1)).toBeNull()
  })

  it('computes memory percentage from real capacity and rejects unusable totals', () => {
    expect(ratioPercent(0, 16)).toBe(0)
    expect(ratioPercent(8, 16)).toBe(50)
    expect(ratioPercent(20, 16)).toBe(100)
    expect(ratioPercent(null, 16)).toBeNull()
    expect(ratioPercent(8, null)).toBeNull()
    expect(ratioPercent(8, 0)).toBeNull()
    expect(ratioPercent(8, -1)).toBeNull()
    expect(positiveNumber(0)).toBeNull()
    expect(positiveNumber(16)).toBe(16)
  })
})

describe('resource window and line gaps', () => {
  it('plots actual timestamps inside the five-minute window and dedupes scrapes', () => {
    const samples = [
      sample(-1000, { gpuPct: 20 }),
      sample(-300_000, { gpuPct: 10 }),
      sample(-301_000, { gpuPct: 99 }),
      sample(0, { gpuPct: 0 }),
      sample(-1000, { gpuPct: 50 }),
      { ...sample(0), at: Number.NaN }
    ]

    const window = buildResourceWindow(samples, NOW, 300_000)

    expect(window.startMs).toBe(NOW - 300_000)
    expect(window.endMs).toBe(NOW)
    expect(window.samples).toHaveLength(3)
    expect(window.samples.map((item) => item.at)).toEqual([
      NOW - 300_000,
      NOW - 1000,
      NOW
    ])
    expect(window.samples[1].gpuPct).toBe(50)
  })

  it('follows a slightly future sample instead of hiding it behind clock skew', () => {
    const window = buildResourceWindow([sample(2000, { gpuPct: 30 })], NOW, 300_000)
    expect(window.endMs).toBe(NOW + 2000)
    expect(window.startMs).toBe(NOW - 298_000)
    expect(window.samples).toHaveLength(1)
  })

  it('breaks the line on a missing scrape even when only one interval is absent', () => {
    const samples = [
      sample(-25_000, { gpuPct: 10 }),
      sample(-20_000, { gpuPct: 20 }),
      sample(-15_000, { gpuPct: null }),
      sample(-10_000, { gpuPct: 0 }),
      sample(-5000, { gpuPct: 30 }),
      sample(0, { gpuPct: 40 })
    ]

    const series = buildMetricSeries(samples, (item) => percentValue(item.gpuPct), 12_500)

    expect(series.values).toEqual([10, 20, null, 0, 30, 40])
    expect(series.segments.map((segment) => segment.map((point) => point.value))).toEqual([
      [10, 20],
      [0, 30, 40]
    ])
    expect(series.summary).toEqual({ latest: 40, mean: 20, peak: 40, count: 5 })
  })

  it('breaks the line when timestamps leave a real sampling gap', () => {
    const samples = [
      sample(-30_000, { gpuPct: 10 }),
      sample(-25_000, { gpuPct: 20 }),
      sample(-5000, { gpuPct: 30 }),
      sample(0, { gpuPct: 40 })
    ]

    const series = buildMetricSeries(samples, (item) => percentValue(item.gpuPct), 12_500)

    expect(series.segments.map((segment) => segment.map((point) => point.at))).toEqual([
      [NOW - 30_000, NOW - 25_000],
      [NOW - 5000, NOW]
    ])
  })

  it('keeps an all-zero series instead of treating zero as missing', () => {
    const samples = [sample(-10_000, { gpuPct: 0 }), sample(0, { gpuPct: 0 })]
    const series = buildMetricSeries(samples, (item) => percentValue(item.gpuPct), 12_500)

    expect(series.summary).toEqual({ latest: 0, mean: 0, peak: 0, count: 2 })
    expect(series.segments).toHaveLength(1)
  })

  it('marks sampling stale only after three intervals without a scrape', () => {
    expect(isResourceSampleStale(NOW - 10_000, NOW, 5000)).toBe(false)
    expect(isResourceSampleStale(NOW - 16_000, NOW, 5000)).toBe(true)
    expect(isResourceSampleStale(null, NOW, 5000)).toBe(false)
    expect(isResourceSampleStale(NOW + 2000, NOW, 5000)).toBe(false)
    expect(resourceGapThresholdMs(5000)).toBe(8750)
    expect(resourceGapThresholdMs(0)).toBe(8750)
  })
})

describe('resource chart geometry', () => {
  it('places ticks at exact elapsed times across the window', () => {
    const ticks = buildTimeTicks(NOW - 300_000, NOW, 6)

    expect(ticks).toHaveLength(6)
    expect(ticks.map((tick) => tick.offsetMs)).toEqual([
      -300_000,
      -240_000,
      -180_000,
      -120_000,
      -60_000,
      0
    ])
    expect(ticks[0].at).toBe(NOW - 300_000)
    expect(ticks[5].at).toBe(NOW)
    expect(ticks[3].fraction).toBeCloseTo(0.6)
  })

  it('maps actual times and percentages onto the plot without clipping valid values', () => {
    expect(xForTime(NOW - 300_000, NOW - 300_000, NOW, 30, 300)).toBe(30)
    expect(xForTime(NOW, NOW - 300_000, NOW, 30, 300)).toBe(330)
    expect(xForTime(NOW - 150_000, NOW - 300_000, NOW, 30, 300)).toBe(180)
    expect(xForTime(NOW, NOW - 300_000, NOW, 30, 300)).toBe(330)
    expect(xForTime(NOW - 600_000, NOW - 300_000, NOW, 30, 300)).toBe(30)

    expect(yForPercent(0, 8, 100)).toBe(108)
    expect(yForPercent(50, 8, 100)).toBe(58)
    expect(yForPercent(100, 8, 100)).toBe(8)
    expect(yForPercent(80, 8, 100)).toBe(28)
    expect(yForPercent(120, 8, 100)).toBe(8)
    expect(yForPercent(-10, 8, 100)).toBe(108)
  })

  it('selects the nearest sample for hover and tolerates empty windows', () => {
    const samples = [sample(-10_000), sample(0), sample(10_000)]

    expect(pickNearestSampleIndex(samples, NOW + 4000)).toBe(1)
    expect(pickNearestSampleIndex(samples, NOW + 6000)).toBe(2)
    expect(pickNearestSampleIndex(samples, NOW + 15_000)).toBe(2)
    expect(pickNearestSampleIndex([], NOW)).toBe(-1)
    expect(latestFiniteSample([samples[2], samples[0]])?.at).toBe(NOW + 10_000)
    expect(latestFiniteSample([])).toBeNull()
    expect(latestFiniteSample([{ ...samples[0], at: Number.NaN }])).toBeNull()
  })
})
