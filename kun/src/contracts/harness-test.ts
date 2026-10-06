import { HarnessGatewayBindingSchema } from './harness-gateway-binding.js'
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
  gatewayBinding: HarnessGatewayBindingSchema.optional(),
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
    authentication: z.enum(['verified', 'unverified', 'missing']).optional(),
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

export const HarnessReadinessSchema = z.object({
  profileKey: z.string(),
  usable: z.boolean(),
  authentication: z.enum(['verified', 'unverified', 'missing']),
  checks: z.array(z.object({
    id: z.enum(['installation', 'configuration', 'credentials', 'protocol']),
    ok: z.boolean(),
    detail: z.string().optional()
  }).strict()),
  checkedAt: z.string().datetime(),
  detail: z.string().optional()
}).strict()
export type HarnessReadiness = z.infer<typeof HarnessReadinessSchema>

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
    trial: HarnessTestTrialSchema.optional(),
    readiness: HarnessReadinessSchema.optional()
  })
  .strict()
export type HarnessTestResponse = z.infer<typeof HarnessTestResponseSchema>

/**
 * `POST /v1/harnesses/probe-definition` (docs/ade/impl/p4 §3.7, P4-12):
 * handshake a custom ACP definition before it is saved. Mirrors the
 * `harnesses.custom[]` entry shape minus `id` — the unsaved agent has no
 * stable id yet, so `id` is optional and only used for log correlation.
 */
export const HarnessProbeDefinitionRequestSchema = z
  .object({
    id: z.string().trim().min(1).max(128).optional(),
    displayName: z.string().trim().min(1).max(64),
    command: z.string().trim().min(1).max(4_096),
    args: z.array(z.string().max(1_024)).max(32).default([]),
    env: z
      .record(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), z.string().max(1_024))
      .default({}),
    secretEnv: z
      .array(
        z
          .object({
            name: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
            secretRef: z.string().min(1).max(256)
          })
          .strict()
      )
      .max(32)
      .default([])
  })
  .strict()
export type HarnessProbeDefinitionRequest = z.infer<
  typeof HarnessProbeDefinitionRequestSchema
>

/** `POST /v1/harness-secrets` request — stores a value, returns its ref. */
export const HarnessSecretCreateRequestSchema = z
  .object({
    value: z.string().min(1).max(16_384)
  })
  .strict()
export type HarnessSecretCreateRequest = z.infer<
  typeof HarnessSecretCreateRequestSchema
>
