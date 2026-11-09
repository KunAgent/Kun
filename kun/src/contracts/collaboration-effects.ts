import { z } from 'zod'
import { StartTurnRequest } from './turns.js'
import {
  CommitmentRecordFields, FollowUpId, FollowUpRevision, FollowUpTime, FollowUpFingerprint,
  FollowUpEnvelopeSchema
} from './collaboration-followup.js'

export const FollowUpReceiptSchema = z.object({
  receiver: z.enum(['native', 'ade']), requestId: FollowUpId, fingerprint: FollowUpFingerprint,
  state: z.enum(['accepted', 'preparing', 'in_flight', 'known_not_admitted', 'terminal', 'unknown']),
  observedAt: FollowUpTime, targetRefId: FollowUpId.optional(),
  threadId: FollowUpId.optional(), turnId: FollowUpId.optional(),
  terminalStatus: z.enum(['completed', 'failed', 'cancelled']).optional(),
  reason: z.string().max(2000).optional()
}).strict().refine((value) => !['accepted', 'terminal'].includes(value.state) || Boolean(value.targetRefId),
  'accepted receipts require the authoritative target identity')
  .refine((value) => value.state !== 'terminal' || Boolean(value.terminalStatus), 'terminal receipt requires status')
export type FollowUpReceipt = z.infer<typeof FollowUpReceiptSchema>

export const FollowUpClaimSchema = z.object({
  ownerId: FollowUpId, token: FollowUpRevision, expiresAt: FollowUpTime,
  generation: FollowUpRevision, authorizationEpoch: FollowUpRevision
}).strict()

export const CommitmentExecutionPermitSchema = z.object({
  admissionKey: FollowUpId, controlRevision: FollowUpRevision,
  claimToken: FollowUpRevision, issuedAt: FollowUpTime, revokedAt: FollowUpTime.optional(),
  native: z.object({ threadId: FollowUpId, requestFingerprint: FollowUpFingerprint,
    targetFingerprint: FollowUpFingerprint, issuanceId: FollowUpId, manualEventId: FollowUpId.optional() }).strict().optional()
}).strict()
export type CommitmentExecutionPermit = z.infer<typeof CommitmentExecutionPermitSchema>

export const CommitmentExecutionSchema = z.object({
  ...CommitmentRecordFields, attemptId: FollowUpId, requestId: FollowUpId, effectId: FollowUpId,
  envelope: FollowUpEnvelopeSchema, fingerprint: FollowUpFingerprint,
  nativeRequest: z.object({ threadId: FollowUpId, request: StartTurnRequest }).strict().optional(),
  phase: z.enum(['reserved', 'admitted', 'accepted', 'reconciling', 'terminal']),
  permit: CommitmentExecutionPermitSchema.optional(),
  dispatch: z.object({ id: FollowUpId, startedAt: FollowUpTime, claimToken: FollowUpRevision }).strict().optional(),
  receipt: FollowUpReceiptSchema.optional(), nextReconcileAt: FollowUpTime.nullable(),
  stopRequestedAt: FollowUpTime.optional()
}).strict().refine((value) => value.id === value.attemptId && value.attemptId === value.envelope.attemptId &&
  value.requestId === value.envelope.requestId && value.effectId === value.envelope.effectId &&
  value.commitmentId === value.envelope.commitmentId && value.sourceRoomId === value.envelope.sourceRoomId,
  'execution and envelope identities must agree')
  .refine((value) => !value.nativeRequest || value.nativeRequest.request.clientRequestId === value.requestId,
    'native request must retain the receiver request identity')
  .refine((value) => value.phase === 'reserved' || value.phase === 'terminal' || Boolean(value.permit),
    'admitted execution requires a durable permit')
  .refine((value) => !value.dispatch || Boolean(value.permit?.native) && value.phase !== 'reserved' &&
    value.dispatch.claimToken >= value.permit!.claimToken, 'native dispatch requires its durable permit')
  .refine((value) => !value.receipt || value.receipt.requestId === value.requestId && value.receipt.fingerprint === value.fingerprint,
    'execution receipt identity mismatch')
export type CommitmentExecution = z.infer<typeof CommitmentExecutionSchema>

export const CommitmentEffectSchema = z.object({
  ...CommitmentRecordFields, effectId: FollowUpId,
  kind: z.enum(['continue', 'cancel', 'notify']), requestId: FollowUpId, admissionKey: FollowUpId,
  fingerprint: FollowUpFingerprint, envelope: FollowUpEnvelopeSchema,
  status: z.enum(['pending', 'dispatching', 'outcome_unknown', 'succeeded', 'failed', 'cancelled']),
  claim: FollowUpClaimSchema.optional(), retryAt: FollowUpTime.nullable(),
  nextReconcileAt: FollowUpTime.nullable(), receipt: FollowUpReceiptSchema.optional(),
  error: z.object({ code: z.string().min(1).max(100), message: z.string().max(2000) }).strict().optional()
}).strict().refine((value) => value.id === value.effectId && value.effectId === value.envelope.effectId &&
  value.requestId === value.envelope.requestId && value.commitmentId === value.envelope.commitmentId &&
  value.sourceRoomId === value.envelope.sourceRoomId, 'effect and envelope identities must agree')
  .refine((value) => value.status !== 'outcome_unknown' || value.retryAt === null,
    'unknown outcomes must be reconciled, never retried as pending work')
  .refine((value) => !['dispatching', 'outcome_unknown'].includes(value.status) || Boolean(value.claim),
    'dispatch requires a claim')
  .refine((value) => !value.receipt || value.receipt.requestId === value.requestId && value.receipt.fingerprint === value.fingerprint,
    'effect receipt identity mismatch')
  .refine((value) => !value.claim || value.claim.generation === value.envelope.generation &&
    value.claim.authorizationEpoch === value.envelope.authorizationEpoch, 'effect claim authorization mismatch')
export type CommitmentEffect = z.infer<typeof CommitmentEffectSchema>
