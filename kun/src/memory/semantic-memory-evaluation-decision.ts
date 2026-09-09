import type { SemanticMemoryCandidateMetadata } from './semantic-memory-evaluation.js'
import type { SemanticMemoryEvaluationManifest } from './semantic-memory-evaluation-dataset.js'

export function semanticMemoryLockedCandidateMetadata(
  manifest: SemanticMemoryEvaluationManifest
): SemanticMemoryCandidateMetadata {
  const locked = manifest.candidateLock.candidate
  return {
    id: locked.id,
    kind: locked.kind,
    version: locked.version,
    runtime: locked.runtime,
    license: locked.license,
    artifactSha256: locked.artifactSha256,
    dimensions: locked.dimensions,
    normalization: locked.normalization,
    parameters: locked.parameters,
    platforms: locked.platforms
  }
}

export function assertSemanticMemoryCandidateMatchesLock(
  manifest: SemanticMemoryEvaluationManifest,
  candidate: SemanticMemoryCandidateMetadata
): void {
  const expected = semanticMemoryLockedCandidateMetadata(manifest)
  const differences = Object.keys(expected).filter((key) =>
    canonical(expected[key as keyof typeof expected]) !== canonical(candidate[key as keyof typeof candidate])
  )
  if (differences.length > 0) {
    throw new Error(`semantic Memory candidate differs from lock: ${differences.join(', ')}`)
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
