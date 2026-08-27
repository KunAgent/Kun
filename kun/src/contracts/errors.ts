import { z } from 'zod'
import { RuntimeFlavorSchema } from './runtime-flavor.js'

/**
 * Structured API error codes returned by every Kun HTTP/SSE endpoint.
 *
 * The error contract mirrors what Kun diagnostics can render:
 * the renderer needs a stable `code` to drive UI state and a human-readable
 * `message` to surface in toasts. `details` carries optional, JSON-encodable
 * per-endpoint information (for example a Zod issue list).
 */
export const KunErrorCode = z.enum([
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'thread_closing',
  'conflict',
  'task_surface_locked',
  'design_profile_locked',
  'rate_limited',
  'thread_busy',
  'turn_in_progress',
  'turn_not_running',
  'approval_not_pending',
  'capability_unavailable',
  'provider_unavailable',
  'policy_blocked',
  'model_modality_unsupported',
  'attachment_validation_failed',
  'internal_error',
  'not_implemented',
  'aborted'
])
export type KunErrorCode = z.infer<typeof KunErrorCode>

/** Lease metadata that is safe to return to a user-facing client. */
export const ThreadBusyDetailsSchema = z.object({
  threadId: z.string().min(1),
  activeTurnId: z.string().min(1),
  ownerFlavor: RuntimeFlavorSchema,
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime()
}).strict()
export type ThreadBusyDetails = z.infer<typeof ThreadBusyDetailsSchema>

export const RuntimeErrorSeverity = z.enum(['info', 'warning', 'error'])
export type RuntimeErrorSeverity = z.infer<typeof RuntimeErrorSeverity>

export const KunErrorBody = z.object({
  code: KunErrorCode,
  message: z.string(),
  details: z.unknown().optional()
})
export type KunErrorBody = z.infer<typeof KunErrorBody>
