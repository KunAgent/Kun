import { z } from 'zod'

/** A concrete task-workspace result, distinct from the generic /review prompt target. */
export const ReviewArtifactTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('task-workspace'), workspaceId: z.string().min(1).max(256) }).strict(),
  z.object({ kind: z.literal('source-checkout'), workspaceId: z.string().min(1).max(256) }).strict()
])
export type ReviewArtifactTarget = z.infer<typeof ReviewArtifactTargetSchema>

export const ReviewRevisionSchema = z.object({
  version: z.literal(1),
  target: ReviewArtifactTargetSchema,
  headRevision: z.string().regex(/^[a-f0-9]{40,64}$/).optional(),
  /** SHA-256 over HEAD, staged index delta, status and bounded file bytes. */
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  completeness: z.enum(['complete', 'incomplete']),
  reason: z.enum([
    'git_unavailable', 'too_many_files', 'file_too_large',
    'total_bytes_exceeded', 'concurrent_change', 'unsupported_entry'
  ]).optional(),
  fileCount: z.number().int().nonnegative(),
  capturedAt: z.string().datetime()
}).strict()
export type ReviewRevision = z.infer<typeof ReviewRevisionSchema>

export type ReviewRevisionValidity = 'current' | 'stale' | 'unknown'

/** Incomplete or legacy evidence never establishes a current verdict. */
export function reviewRevisionValidity(
  decided: ReviewRevision | undefined,
  current: ReviewRevision | undefined
): ReviewRevisionValidity {
  if (!decided || !current ||
      decided.completeness !== 'complete' || current.completeness !== 'complete' ||
      !decided.contentHash || !current.contentHash ||
      decided.target.kind !== current.target.kind ||
      decided.target.workspaceId !== current.target.workspaceId) return 'unknown'
  return decided.contentHash === current.contentHash ? 'current' : 'stale'
}
