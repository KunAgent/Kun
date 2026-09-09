import type { SemanticMemoryCandidate } from './semantic-memory-evaluation.js'

export type SemanticMemoryCandidateUnavailableReason =
  | 'missing'
  | 'corrupt'
  | 'unsupported'
  | 'initialization-failed'

export type SemanticMemoryCandidateInitialization = {
  candidate: SemanticMemoryCandidate
  status: 'ready' | 'fallback'
  reason?: SemanticMemoryCandidateUnavailableReason
}

export class SemanticMemoryCandidateUnavailableError extends Error {
  constructor(readonly reason: Exclude<SemanticMemoryCandidateUnavailableReason, 'initialization-failed'>) {
    super(`semantic Memory candidate is ${reason}`)
    this.name = 'SemanticMemoryCandidateUnavailableError'
  }
}

export async function initializeSemanticMemoryEvaluationCandidate(input: {
  initialize: () => Promise<SemanticMemoryCandidate>
  fallback: SemanticMemoryCandidate
}): Promise<SemanticMemoryCandidateInitialization> {
  try {
    return { candidate: await input.initialize(), status: 'ready' }
  } catch (error) {
    return {
      candidate: input.fallback,
      status: 'fallback',
      reason: error instanceof SemanticMemoryCandidateUnavailableError
        ? error.reason
        : 'initialization-failed'
    }
  }
}
