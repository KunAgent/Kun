import { z } from 'zod'
import { KUN_TOOL_PERMISSION_MODES } from './policy.js'
import { HarnessCapabilitiesSchema } from './harness-capabilities.js'

export const HarnessIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{1,47}$/)
export type HarnessId = z.infer<typeof HarnessIdSchema>

/** How an engine is attached; decides which DelegatedTurnRuntime runs it. */
export const HarnessTransportSchema = z.enum([
  'native-loop',
  'agent-sdk',
  'cursor-sdk',
  'antigravity-cli',
  'acp',
  'terminal'
])
export type HarnessTransport = z.infer<typeof HarnessTransportSchema>

export const HarnessCredentialModeSchema = z.enum([
  'native-login',
  'provider',
  'kun-gateway'
])
export type HarnessCredentialMode = z.infer<typeof HarnessCredentialModeSchema>

export const HarnessPermissionModeSchema = z
  .object({
    /** The harness's own level id, e.g. 'default' | 'acceptEdits' | 'bypassPermissions'. */
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(64),
    /**
     * Conservative upper bound mapped onto Kun's product permission ladder
     * (KUN_TOOL_PERMISSION_MODES). Clamps and admission use only this field.
     */
    kunPermissionMode: z.enum(KUN_TOOL_PERMISSION_MODES)
  })
  .strict()
export type HarnessPermissionMode = z.infer<typeof HarnessPermissionModeSchema>

/** Loopback model-gateway wiring for SDK harnesses; see docs/ade/04-model-gateway-bridge.md. */
export const HarnessGatewaySchema = z
  .object({
    protocol: z.enum(['anthropic-messages', 'openai-chat', 'openai-responses']),
    env: z
      .object({
        baseUrl: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
        token: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
        model: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).optional(),
        smallModel: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).optional()
      })
      .strict(),
    /** Provider/OAuth env vars removed from the harness process in gateway mode. */
    stripEnv: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)).max(32).default([])
  })
  .strict()
export type HarnessGateway = z.infer<typeof HarnessGatewaySchema>

export const HarnessDefinitionSchema = z
  .object({
    id: HarnessIdSchema,
    displayName: z.string().min(1).max(64),
    transport: HarnessTransportSchema,
    /** Local detection; native-loop has none. */
    detect: z
      .object({
        command: z.string().min(1).max(256),
        aliases: z.array(z.string().min(1).max(256)).max(8).default([]),
        versionArgs: z.array(z.string().max(64)).max(4).default(['--version']),
        versionPattern: z.string().max(256).optional(),
        minVersion: z.string().max(32).optional()
      })
      .strict()
      .optional(),
    /** Launch command for acp / terminal transports; SDK transports decide internally. */
    launch: z
      .object({
        command: z.string().min(1).max(256),
        args: z.array(z.string().max(1_024)).max(32).default([]),
        /** Non-sensitive variables only; credentials are injected via credentialMode. */
        env: z
          .record(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), z.string().max(1_024))
          .default({})
      })
      .strict()
      .optional(),
    /** Terminal (tier-0) launch details for PTY agents. */
    terminal: z
      .object({
        argv: z.array(z.string().max(1_024)).max(32).default([]),
        /** Flag used to pass the initial task, e.g. '-i' style switches. */
        taskFlag: z.string().max(64).optional(),
        resumeArgs: z.array(z.string().max(1_024)).max(32).optional(),
        hooks: z
          .object({
            /** Harness-specific hook mechanism, e.g. a settings file name. */
            kind: z.string().max(64),
            events: z.array(z.string().max(64)).max(32).default([])
          })
          .strict()
          .optional()
      })
      .strict()
      .optional(),
    credentialModes: z.array(HarnessCredentialModeSchema).min(1),
    /** Strictest-to-widest order; [0] is the strictest. Unattended fallback is [0]. */
    permissionModes: z.array(HarnessPermissionModeSchema).min(1),
    modelSource: z.enum(['static', 'probe', 'provider']),
    staticModels: z.array(z.string().min(1).max(256)).max(64).default([]),
    /** Links to existing history-sources for "continue external session". */
    historySource: z.enum(['claude-code', 'codex', 'opencode']).optional(),
    /** Static declaration; the runtime may narrow it further per version/login. */
    capabilities: HarnessCapabilitiesSchema,
    /** Present when the harness can run through the loopback model gateway. */
    gateway: HarnessGatewaySchema.optional(),
    builtin: z.boolean()
  })
  .strict()
export type HarnessDefinition = z.infer<typeof HarnessDefinitionSchema>

export const HarnessRouteSchema = z
  .object({
    harnessId: HarnessIdSchema,
    providerId: z.string().min(1).max(128).optional(),
    model: z.string().min(1).max(512),
    credentialMode: HarnessCredentialModeSchema
  })
  .strict()
export type HarnessRoute = z.infer<typeof HarnessRouteSchema>

/** Detection result; metadata only, no credentials or other secrets. */
export const HarnessStatusSchema = z
  .object({
    harnessId: HarnessIdSchema,
    installed: z.enum(['yes', 'no', 'unknown']),
    version: z.string().max(64).optional(),
    versionSupported: z.boolean().optional(),
    login: z.enum(['signed-in', 'signed-out', 'unknown', 'not-required']),
    resolvedCommand: z.string().max(4_096).optional(),
    checkedAt: z.string().datetime(),
    message: z.string().max(512).optional()
  })
  .strict()
export type HarnessStatus = z.infer<typeof HarnessStatusSchema>
