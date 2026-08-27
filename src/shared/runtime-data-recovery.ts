import { z } from 'zod'

export const RUNTIME_DATA_RECOVERY_SCHEMA_VERSION = 1 as const

export const RuntimeDataRecoveryCandidateKindSchema = z.enum([
  'current',
  'legacy',
  'staging',
  'backup'
])
export type RuntimeDataRecoveryCandidateKind = z.infer<
  typeof RuntimeDataRecoveryCandidateKindSchema
>

export const RuntimeDataRecoveryCredentialStateSchema = z.enum([
  'none',
  'complete',
  'incomplete'
])
export type RuntimeDataRecoveryCredentialState = z.infer<
  typeof RuntimeDataRecoveryCredentialStateSchema
>

export const RuntimeDataRecoveryInventorySchema = z.object({
  files: z.number().int().nonnegative(),
  directories: z.number().int().nonnegative(),
  symlinks: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  threads: z.number().int().nonnegative(),
  providers: z.number().int().nonnegative(),
  graphs: z.number().int().nonnegative()
}).strict()
export type RuntimeDataRecoveryInventory = z.infer<
  typeof RuntimeDataRecoveryInventorySchema
>

/**
 * Deliberately redacted. Filesystem paths, fingerprints, credential IDs, and
 * journal contents never cross the Main -> renderer boundary.
 */
export const RuntimeDataRecoveryCandidateSchema = z.object({
  candidateId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  kind: RuntimeDataRecoveryCandidateKindSchema,
  label: z.string().min(1).max(160),
  modifiedAt: z.string().datetime(),
  inventory: RuntimeDataRecoveryInventorySchema,
  credentialState: RuntimeDataRecoveryCredentialStateSchema,
  /** A migration journal names this fixed path, but has not proved its bytes. */
  journalReferenced: z.boolean(),
  /** A complete recovery verified-phase record proves this exact tree snapshot. */
  recoveryVerified: z.boolean(),
  /** Reserved for a fully validated migration journal and matching tree. */
  journalVerified: z.boolean(),
  equivalentCopies: z.number().int().positive(),
  warnings: z.array(z.string().min(1).max(200)).max(10)
}).strict()
export type RuntimeDataRecoveryCandidate = z.infer<
  typeof RuntimeDataRecoveryCandidateSchema
>

export const RuntimeDataRecoveryStateSchema = z.enum([
  'new-install',
  'candidate-ready',
  'selection-required',
  'start-over-required',
  'recovering',
  'completed',
  'failed'
])
export type RuntimeDataRecoveryState = z.infer<typeof RuntimeDataRecoveryStateSchema>

export const RuntimeDataRecoveryStatusSchema = z.object({
  schemaVersion: z.literal(RUNTIME_DATA_RECOVERY_SCHEMA_VERSION),
  generation: z.string().uuid(),
  state: RuntimeDataRecoveryStateSchema,
  historicalEvidence: z.boolean(),
  candidates: z.array(RuntimeDataRecoveryCandidateSchema).max(100),
  recommendedCandidateId: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  invalidEvidenceCount: z.number().int().nonnegative(),
  warnings: z.array(z.string().min(1).max(300)).max(20),
  message: z.string().min(1).max(500).optional()
}).strict()
export type RuntimeDataRecoveryStatus = z.infer<typeof RuntimeDataRecoveryStatusSchema>

const generationSchema = z.string().uuid()
const candidateIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

export const RuntimeDataRecoveryExecuteInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('restore'),
    generation: generationSchema,
    candidateId: candidateIdSchema
  }).strict(),
  z.object({
    action: z.literal('initialize-new-install'),
    generation: generationSchema,
    confirmation: z.literal('initialize-empty-new-install')
  }).strict(),
  z.object({
    action: z.literal('start-over'),
    generation: generationSchema,
    confirmation: z.literal('preserve-existing-evidence-and-start-over')
  }).strict()
])
export type RuntimeDataRecoveryExecuteInput = z.infer<
  typeof RuntimeDataRecoveryExecuteInputSchema
>

export type RuntimeDataRecoveryApi = {
  getStatus: () => Promise<RuntimeDataRecoveryStatus>
  execute: (input: RuntimeDataRecoveryExecuteInput) => Promise<RuntimeDataRecoveryStatus>
}

export type RuntimeDataRecoveryWindowApi = RuntimeDataRecoveryApi
