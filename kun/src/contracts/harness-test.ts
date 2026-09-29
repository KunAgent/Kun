import { z } from 'zod'
import { HarnessCredentialModeSchema, HarnessStatusSchema } from './harness.js'

/**
 * `POST /v1/harnesses/:id/test` contract (docs/ade/impl/p4 §3.5, P4-10).
 *
 * Three progressive levels — each deeper level includes the shallower
 * results so a single response renders the whole checklist:
 * 1. `detect`    — binary path + version + login verdict.
 * 2. `handshake` — ACP `initialize` (agent name/version/capabilities) or the
 *    SDK model list; transports without a handshake surface report
 *    `supported: false` and are not a failure by themselves.
 * 3. `trial`     — one fixed prompt through a real delegated turn on a side
 *    thread that never appears in conversation lists and is deleted after.
 */
export const HarnessTestLevelSchema = z.enum(['detect', 'handshake', 'trial'])
export type HarnessTestLevel = z.infer<typeof HarnessTestLevelSchema>

export const HarnessTestRequestSchema = z
  .object({
    level: HarnessTestLevelSchema,
    credentialMode: HarnessCredentialModeSchema.optional(),
    providerId: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).optional(),
    /** Per-request cap for the whole test; defaults to 120s, capped at 5min. */
    timeoutMs: z.number().int().positive().max(300_000).optional()
  })
  .strict()
export type HarnessTestRequest = z.infer<typeof HarnessTestRequestSchema>

export const HarnessTestDetectSchema = z
  .object({
    durationMs: z.number().nonnegative(),
    ok: z.boolean(),
    status: HarnessStatusSchema
  })
  .strict()
export type HarnessTestDetect = z.infer<typeof HarnessTestDetectSchema>

export const HarnessTestHandshakeSchema = z
  .object({
    durationMs: z.number().nonnegative(),
    ok: z.boolean(),
    /** False when the transport has no handshake surface at all. */
    supported: z.boolean(),
    protocol: z.string().optional(),
    protocolVersion: z.number().int().optional(),
    agent: z
      .object({ name: z.string().optional(), version: z.string().optional() })
      .strict()
      .optional(),
    capabilities: z
      .object({
        sessionResume: z.boolean().optional(),
        imageInput: z.boolean().optional(),
        mcpTransports: z.array(z.string()).optional()
      })
      .strict()
      .optional(),
    authMethods: z
      .array(z.object({ id: z.string(), name: z.string().optional() }).strict())
      .optional(),
    authRequired: z.boolean().optional(),
    /** SDK transports surface their supported model list as the handshake. */
    models: z.array(z.string()).optional(),
    detail: z.string().optional()
  })
  .strict()
export type HarnessTestHandshake = z.infer<typeof HarnessTestHandshakeSchema>

export const HarnessTestTrialSchema = z
  .object({
    durationMs: z.number().nonnegative(),
    ok: z.boolean(),
    status: z.enum(['completed', 'failed', 'aborted']),
    error: z.string().optional(),
    terminalCode: z.string().optional(),
    /** Token usage emitted by the trial turn, when the harness reports any. */
    usage: z
      .object({
        totalTokens: z.number().int().nonnegative(),
        promptTokens: z.number().int().nonnegative().optional(),
        completionTokens: z.number().int().nonnegative().optional(),
        model: z.string().optional(),
        providerId: z.string().optional()
      })
      .strict()
      .optional()
  })
  .strict()
export type HarnessTestTrial = z.infer<typeof HarnessTestTrialSchema>

export const HarnessTestResponseSchema = z
  .object({
    harnessId: z.string(),
    transport: z.string(),
    level: HarnessTestLevelSchema,
    /** Deepest requested level succeeded. */
    ok: z.boolean(),
    durationMs: z.number().nonnegative(),
    detect: HarnessTestDetectSchema,
    handshake: HarnessTestHandshakeSchema.optional(),
    trial: HarnessTestTrialSchema.optional()
  })
  .strict()
export type HarnessTestResponse = z.infer<typeof HarnessTestResponseSchema>
