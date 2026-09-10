import { percentile } from './semantic-memory-evaluation.js'

export type SemanticMemoryResourceMeasurements = {
  coldReadinessMs: number
  warmQueryMs: readonly number[]
  fixtureBuildMs: number
  tenThousandRecordBuildMs: number
  incrementalProjectionMs: number
  modelBytes: number
  indexBytes: number
  additionalPeakRssBytes: number
}

export type SemanticMemoryResourceSummary = {
  coldReadinessMs: number
  warmQueryIterations: number
  warmQueryP50Ms: number
  warmQueryP95Ms: number
  fixtureBuildMs: number
  tenThousandRecordBuildMs: number
  incrementalProjectionMs: number
  modelBytes: number
  indexBytes: number
  additionalPeakRssBytes: number
}

export function summarizeSemanticMemoryResources(
  measurements: SemanticMemoryResourceMeasurements
): SemanticMemoryResourceSummary {
  if (measurements.warmQueryMs.length < 30) {
    throw new Error('semantic memory resource measurement requires at least 30 warm query samples')
  }
  const nonNegative = [
    measurements.coldReadinessMs,
    ...measurements.warmQueryMs,
    measurements.fixtureBuildMs,
    measurements.tenThousandRecordBuildMs,
    measurements.incrementalProjectionMs,
    measurements.modelBytes,
    measurements.indexBytes,
    measurements.additionalPeakRssBytes
  ]
  if (nonNegative.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('semantic memory resource measurements must be finite and non-negative')
  }
  return {
    coldReadinessMs: round(measurements.coldReadinessMs),
    warmQueryIterations: measurements.warmQueryMs.length,
    warmQueryP50Ms: percentile(measurements.warmQueryMs, 0.5),
    warmQueryP95Ms: percentile(measurements.warmQueryMs, 0.95),
    fixtureBuildMs: round(measurements.fixtureBuildMs),
    tenThousandRecordBuildMs: round(measurements.tenThousandRecordBuildMs),
    incrementalProjectionMs: round(measurements.incrementalProjectionMs),
    modelBytes: Math.floor(measurements.modelBytes),
    indexBytes: Math.floor(measurements.indexBytes),
    additionalPeakRssBytes: Math.floor(measurements.additionalPeakRssBytes)
  }
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}
