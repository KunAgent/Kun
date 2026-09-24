export type MemoryFeedbackPairedBootstrapResult = {
  pointEstimate: number
  lowerBound: number
  seed: number
  resamples: number
  confidenceLevel: number
}

export function memoryFeedbackPairedBootstrapLowerBound(input: {
  baseline: readonly number[]
  candidate: readonly number[]
  seed: number
  resamples: number
  confidenceLevel: number
}): MemoryFeedbackPairedBootstrapResult {
  if (input.baseline.length === 0 || input.baseline.length !== input.candidate.length) {
    throw new Error('paired bootstrap requires equal non-empty samples')
  }
  if (!Number.isInteger(input.resamples) || input.resamples < 1) {
    throw new Error('paired bootstrap resamples must be a positive integer')
  }
  if (input.confidenceLevel <= 0.5 || input.confidenceLevel >= 1) {
    throw new Error('paired bootstrap confidence level must be between 0.5 and 1')
  }
  const random = seededRandom(input.seed)
  const deltas = input.candidate.map((value, index) => value - input.baseline[index]!)
  const samples: number[] = []
  for (let sample = 0; sample < input.resamples; sample += 1) {
    let total = 0
    for (let index = 0; index < deltas.length; index += 1) {
      total += deltas[Math.floor(random() * deltas.length)]!
    }
    samples.push(total / deltas.length)
  }
  samples.sort((left, right) => left - right)
  const lowerIndex = Math.min(
    samples.length - 1,
    Math.floor((1 - input.confidenceLevel) * samples.length)
  )
  return {
    pointEstimate: round(average(deltas)),
    lowerBound: round(samples[lowerIndex]!),
    seed: input.seed,
    resamples: input.resamples,
    confidenceLevel: input.confidenceLevel
  }
}

function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
