import { z } from 'zod'

// Receipts outlive editable chat history. Refuse new work at the limit rather
// than evict an admission identity and make an old request executable again.
export const MAX_NATIVE_FOLLOWUP_RECEIPTS = 1000
const id = z.string().min(1).max(300)
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/)

/** Host-only reference to the immutable effect and its Manager-issued permit. */
export const NativeFollowUpAdmissionSchema = z.object({
  requestId: id, effectId: id, attemptId: id, admissionKey: id, fingerprint
}).strict()
export type NativeFollowUpAdmission = z.infer<typeof NativeFollowUpAdmissionSchema>

export const NativeFollowUpRequestSchema = z.object({
  threadId: id,
  admission: NativeFollowUpAdmissionSchema,
  requestFingerprint: fingerprint,
  turnId: id,
  userMessageItemId: id,
  preparationRevision: z.number().int().positive(),
  phase: z.enum(['preparing', 'admitted', 'known_not_admitted']),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  executionStartedAt: z.string().datetime().optional(),
  terminalStatus: z.enum(['completed', 'failed', 'cancelled']).optional()
}).strict().refine((row) => row.phase === 'admitted' || !row.terminalStatus && !row.executionStartedAt,
  'only an admitted native request can have an execution outcome')
export type NativeFollowUpRequest = z.infer<typeof NativeFollowUpRequestSchema>
export const NativeFollowUpRequestsSchema = z.array(NativeFollowUpRequestSchema)
  .max(MAX_NATIVE_FOLLOWUP_RECEIPTS)
  .refine((rows) => new Set(rows.map((row) => row.admission.requestId)).size === rows.length,
    'duplicate native follow-up request identity')
