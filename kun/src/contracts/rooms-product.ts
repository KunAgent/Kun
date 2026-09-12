import { z } from 'zod'
import { RoomIdSchema } from './rooms.js'

export const RoomRuleSchema = z.object({
  id: RoomIdSchema, messageId: RoomIdSchema, body: z.string().min(1).max(64000),
  version: z.number().int().positive(), active: z.boolean().default(true),
  updatedAt: z.string().optional()
})
export type RoomRule = z.infer<typeof RoomRuleSchema>
export const RoomRuleUpdateSchema = z.object({
  clientRequestId: RoomIdSchema, expectedRevision: z.number().int().nonnegative(),
  body: z.string().trim().min(1).max(64000).optional(), active: z.boolean().optional()
}).strict()
export const RoomRecoveryActionSchema = z.object({
  clientRequestId: RoomIdSchema, expectedRevision: z.number().int().nonnegative(),
  action: z.enum(['reconcile', 'retry', 'abandon'])
}).strict()
export type RoomRecoveryInfo = {
  taskId: string; state: 'active' | 'stopped' | 'unknown'; threadId?: string; turnId?: string
  reason: string; canRetry: boolean; canAbandon: boolean; observedAt: string
}
export type RoomRequestOutcome = {
  requestId: string; status: 'discussing' | 'running' | 'needs_attention' | 'partial' | 'awaiting_acceptance' | 'completed' | 'failed' | 'cancelled'
  total: number; completed: number; delivered: number; failed: number; active: number
  taskIds: string[]; summary: string; revision: string
}
export type RoomContextSnapshot = {
  id: string; roomId: string; coveredSeq: number; summary: string
  messages: Array<{ id: string; author: string; body: string }>
  rules: RoomRule[]; truncated: boolean
}
export type RoomIntegration = {
  id: string; roomId: string; taskId: string; deliveryId: string; sourceSha: string; targetSha: string
  path: string; branch: string; candidateSha?: string; status: 'preparing' | 'conflict' | 'validating' | 'ready' | 'failed' | 'recovery_required' | 'applied'
  conflicts: string[]; diff: string; validation: Array<{ command: string; exitCode: number | null; output: string }>
  threadId?: string; turnId?: string; error?: string; createdAt: string
  runKind?: 'resolve' | 'validate' | 'review'
  review?: { verdict: 'passed' | 'changes_requested'; versionHash: string; findings: unknown[]; limitations?: string[] }
  validationCommands?: string[]
  revision?: number
  candidatePinId?: string
  requestFingerprint?: string
  stepAttempt?: number
  stepRepairs?: number
  cancelRequested?: boolean
  attention?: { signature: string; approvalIds: string[]; userInputIds: string[] }
  validationVersionHash?: string
  applyIntent?: { clientRequestId: string; fingerprint: string; expectedTaskRevision: number; candidateSha: string; targetSha: string }
  candidates?: Array<{ sha: string; pinId: string; targetSha?: string; createdAt?: string; diff?: string;
    validation?: RoomIntegration['validation']; review?: RoomIntegration['review'] }>
}
export const RoomIntegrationActionSchema = z.object({
  clientRequestId: RoomIdSchema, expectedRevision: z.number().int().nonnegative(),
  confirmUnverified: z.boolean().default(false), validationCommands: z.array(z.string().min(1).max(8000)).max(20).optional()
}).strict()
export type RoomCleanupPreview = {
  taskId: string; eligible: boolean; reason?: string; paths: Array<{ path: string; bytes: number }>
  revision: number; token: string; retainsDeliveryPins: boolean
}
