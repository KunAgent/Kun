import { createHash } from 'node:crypto'
import { z } from 'zod'

export const CONSOLIDATION_JOB_STORE_VERSION = 1 as const
export const CONSOLIDATION_PIPELINE_VERSION = 'v1' as const

export const ConsolidationJobStatus = z.enum([
  'eligible',
  'extracting',
  'materialized',
  'verified',
  'pruning',
  'deleting',
  'completed',
  'failed'
])
export type ConsolidationJobStatus = z.infer<typeof ConsolidationJobStatus>

export const ConsolidationReclaimMode = z.enum(['safe', 'reclaim-now'])
export type ConsolidationReclaimMode = z.infer<typeof ConsolidationReclaimMode>

export const ConsolidationReclaimTier = z.enum(['tier-1', 'tier-2'])
export type ConsolidationReclaimTier = z.infer<typeof ConsolidationReclaimTier>

export const ConsolidationJobHistoryEntry = z.object({
  status: ConsolidationJobStatus,
  at: z.string().datetime(),
  reason: z.string().min(1).max(512).optional()
}).strict()
export type ConsolidationJobHistoryEntry = z.infer<typeof ConsolidationJobHistoryEntry>

export const ConsolidationJobCheckpoint = z.object({
  memoryIds: z.array(z.string().min(1)).min(1),
  cutoffRevision: z.string().min(1),
  itemRevision: z.number().int().nonnegative().optional(),
  persistedAt: z.string().datetime()
}).strict()
export type ConsolidationJobCheckpoint = z.infer<typeof ConsolidationJobCheckpoint>

export const ConsolidationJobMeasuredBytes = z.object({
  before: z.number().nonnegative().optional(),
  after: z.number().nonnegative().optional(),
  reclaimed: z.number().nonnegative().optional()
}).strict()
export type ConsolidationJobMeasuredBytes = z.infer<typeof ConsolidationJobMeasuredBytes>

export const ConsolidationJob = z.object({
  schemaVersion: z.literal(CONSOLIDATION_JOB_STORE_VERSION),
  id: z.string().min(1),
  threadId: z.string().min(1),
  cutoffRevision: z.string().min(1),
  pipelineVersion: z.string().min(1),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  memoryIds: z.array(z.string().min(1)).min(1),
  status: ConsolidationJobStatus,
  reclaimMode: ConsolidationReclaimMode.optional(),
  reclaimTier: ConsolidationReclaimTier.optional(),
  cutoffTurnId: z.string().min(1).max(256).optional(),
  artifactOwnerIds: z.array(z.string().min(1).max(256)).max(512).optional(),
  measuredBytes: ConsolidationJobMeasuredBytes.optional(),
  recoverySnapshotId: z.string().min(1).max(256).optional(),
  archiveExpiresAt: z.string().datetime().optional(),
  checkpoint: ConsolidationJobCheckpoint.optional(),
  error: z.string().min(1).max(512).optional(),
  retryCount: z.number().int().nonnegative().default(0),
  history: z.array(ConsolidationJobHistoryEntry).min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict()
export type ConsolidationJob = z.infer<typeof ConsolidationJob>

export const ConsolidationJobStoreState = z.object({
  schemaVersion: z.literal(CONSOLIDATION_JOB_STORE_VERSION),
  jobs: z.record(z.string(), ConsolidationJob).default({})
}).strict()
export type ConsolidationJobStoreState = z.infer<typeof ConsolidationJobStoreState>

// JSON.stringify of a string array is an unambiguous encoding (each element is
// quoted, internal quotes/backslashes/control chars are escaped) regardless of
// what characters threadId/cutoffRevision/pipelineVersion happen to contain, so
// this cannot produce boundary-collision ambiguity the way raw separator-joined
// concatenation could if any input were ever allowed to contain the separator.
function consolidationBaseDigest(
  threadId: string,
  cutoffRevision: string,
  pipelineVersion: string
): string {
  return createHash('sha256')
    .update(JSON.stringify([threadId, cutoffRevision, pipelineVersion]), 'utf8')
    .digest('hex')
}

/** Raw, unsalted input digest — kept on the job record for audit/version-drift comparisons. */
export function deriveConsolidationInputHash(
  threadId: string,
  cutoffRevision: string,
  pipelineVersion: string
): string {
  return consolidationBaseDigest(threadId, cutoffRevision, pipelineVersion)
}

export function deriveConsolidationJobId(
  threadId: string,
  cutoffRevision: string,
  pipelineVersion: string
): string {
  const base = consolidationBaseDigest(threadId, cutoffRevision, pipelineVersion)
  const digest = createHash('sha256').update(`${base}\0job`, 'utf8').digest('hex')
  return `cj_${digest.slice(0, 24)}`
}

export function deriveConsolidationMemoryId(
  threadId: string,
  cutoffRevision: string,
  pipelineVersion: string
): string {
  const base = consolidationBaseDigest(threadId, cutoffRevision, pipelineVersion)
  const digest = createHash('sha256').update(`${base}\0memory`, 'utf8').digest('hex')
  return `mem_${digest.slice(0, 24)}`
}
