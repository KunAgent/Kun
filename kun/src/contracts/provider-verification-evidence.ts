import { z } from 'zod'
export type ProviderVerificationFact = { status: 'unknown' | 'success' | 'failed' | 'not-required'; observedAt?: string }
export type ProviderVerificationEvidence = {
  credential: ProviderVerificationFact
  connectivity: ProviderVerificationFact
  catalog: ProviderVerificationFact
  protocol: ProviderVerificationFact
  inference: ProviderVerificationFact & { model?: string }
}
export function emptyProviderEvidence(): ProviderVerificationEvidence {
  return { credential: { status: 'unknown' }, connectivity: { status: 'unknown' }, catalog: { status: 'unknown' },
    protocol: { status: 'unknown' }, inference: { status: 'unknown' } }
}

const fact = z.object({ status: z.enum(['unknown', 'success', 'failed', 'not-required']), observedAt: z.string().datetime().optional() }).strict()
export const ProviderVerificationEvidenceSchema = z.object({
  credential: fact, connectivity: fact, catalog: fact, protocol: fact,
  inference: fact.extend({ model: z.string().min(1).max(512).optional() })
}).strict()
