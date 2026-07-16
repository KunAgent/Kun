import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export type MoaEvalSample = {
  id: string
  prompt: string
  baselineScore: number
  moaScore: number
  baselineLatencyMs: number
  moaLatencyMs: number
  baselineCostUsd: number
  moaCostUsd: number
}

export function evaluateMoaSamples(
  samples: readonly MoaEvalSample[],
  options: { seed: number; maxCostMultiplier: number }
) {
  if (samples.length === 0) throw new Error('MoA evaluation requires at least one sample')
  const deltas = samples.map((sample) => sample.moaScore - sample.baselineScore)
  const bootstrap = bootstrapMeans(deltas, options.seed, 2_000).sort((a, b) => a - b)
  const baselineCost = sum(samples.map((sample) => sample.baselineCostUsd))
  const moaCost = sum(samples.map((sample) => sample.moaCostUsd))
  const costMultiplier = baselineCost > 0 ? moaCost / baselineCost : Number.POSITIVE_INFINITY
  return {
    sampleCount: samples.length,
    blinded: true,
    qualityDelta: {
      mean: mean(deltas),
      confidenceLow: percentile(bootstrap, 0.025),
      confidenceHigh: percentile(bootstrap, 0.975)
    },
    latencyMs: {
      baselineP50: percentile(samples.map((sample) => sample.baselineLatencyMs).sort((a, b) => a - b), 0.5),
      baselineP95: percentile(samples.map((sample) => sample.baselineLatencyMs).sort((a, b) => a - b), 0.95),
      moaP50: percentile(samples.map((sample) => sample.moaLatencyMs).sort((a, b) => a - b), 0.5),
      moaP95: percentile(samples.map((sample) => sample.moaLatencyMs).sort((a, b) => a - b), 0.95)
    },
    cost: { baselineUsd: baselineCost, moaUsd: moaCost, multiplier: costMultiplier },
    withinBudget: costMultiplier <= options.maxCostMultiplier,
    verified: percentile(bootstrap, 0.025) > 0 && costMultiplier <= options.maxCostMultiplier
  }
}

export async function readEvalFixture(path: string): Promise<MoaEvalSample[]> {
  const lines = (await readFile(path, 'utf8')).split(/\r?\n/).filter((line) => line.trim())
  return lines.map((line, index) => validateSample(JSON.parse(line), index + 1))
}

function validateSample(value: unknown, line: number): MoaEvalSample {
  if (!value || typeof value !== 'object') throw new Error(`Invalid fixture object at line ${line}`)
  const record = value as Record<string, unknown>
  for (const key of ['id', 'prompt']) if (typeof record[key] !== 'string') throw new Error(`Invalid ${key} at line ${line}`)
  for (const key of ['baselineScore', 'moaScore', 'baselineLatencyMs', 'moaLatencyMs', 'baselineCostUsd', 'moaCostUsd']) {
    if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) throw new Error(`Invalid ${key} at line ${line}`)
  }
  return record as MoaEvalSample
}

function bootstrapMeans(values: readonly number[], seed: number, iterations: number): number[] {
  const random = seededRandom(seed)
  return Array.from({ length: iterations }, () => {
    const sample = Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)])
    return mean(sample)
  })
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function sum(values: readonly number[]): number { return values.reduce((total, value) => total + value, 0) }
function mean(values: readonly number[]): number { return sum(values) / values.length }
function percentile(sorted: readonly number[], quantile: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))]
}

async function main(): Promise<void> {
  const fixtureIndex = process.argv.indexOf('--fixture')
  const fixture = fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : undefined
  if (!fixture) throw new Error('Usage: --fixture <path> [--dry-run]')
  const samples = await readEvalFixture(fixture)
  const report = evaluateMoaSamples(samples, { seed: 42, maxCostMultiplier: 3 })
  console.log(JSON.stringify({ dryRun: process.argv.includes('--dry-run'), ...report }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
