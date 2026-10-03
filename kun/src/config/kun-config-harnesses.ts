import { z } from 'zod'
import {
  HarnessCredentialModeSchema,
  HarnessIdSchema,
  HarnessTransportSchema
} from '../contracts/harness.js'

/** User-defined external harness entry (ACP/terminal transports launch it). */
export const HarnessCustomEntrySchema = z
  .object({
    id: HarnessIdSchema,
    displayName: z.string().min(1).max(64),
    command: z.string().min(1).max(4_096),
    args: z.array(z.string().max(1_024)).max(32).default([]),
    /** Non-sensitive variables only; credentials are injected via credentialMode. */
    env: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), z.string().max(1_024)).default({}),
    /**
     * Secret variables bound by credential-store reference (p4 §3.7, P4-12).
     * Only the opaque ref is persisted; the value resolves at spawn time.
     */
    secretEnv: z
      .array(z.object({
        name: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
        secretRef: z.string().min(1).max(256)
      }).strict())
      .max(32)
      .default([])
  })
  .strict()
export type HarnessCustomEntry = z.infer<typeof HarnessCustomEntrySchema>

/**
 * Per-harness default selection (p4 §3.6): applied when a composer pick,
 * one-to-one creation, or a `worker_create` pin does not specify the field.
 */
export const HarnessDefaultsEntrySchema = z
  .object({
    credentialMode: HarnessCredentialModeSchema.optional(),
    /** Provider connection id; meaningful for `provider`/`kun-gateway`. */
    providerId: z.string().min(1).max(128).optional(),
    model: z.string().min(1).max(512).optional(),
    /** A permissionModes[].id on the harness definition. */
    permissionMode: z.string().min(1).max(64).optional(),
    isolation: z.enum(['local', 'worktree']).optional()
  }).strict()
export type HarnessDefaultsEntry = z.infer<typeof HarnessDefaultsEntrySchema>

/**
 * Terminal-only agent (p4 §3.8, P4-13): an interactive CLI the desktop
 * launches inside a Kun terminal tab. It joins the catalog as
 * `transport: 'terminal'` and can never host a delegated turn.
 */
export const HarnessTerminalAgentSchema = z
  .object({
    id: HarnessIdSchema,
    displayName: z.string().min(1).max(64),
    command: z.string().min(1).max(4_096),
    args: z.array(z.string().max(1_024)).max(32).default([]),
    taskFlag: z.string().min(1).max(64).optional(),
    resumeArgs: z.array(z.string().max(1_024)).max(32).optional(),
    hooks: z.enum(['none', 'claude-settings']).optional()
  }).strict()
export type HarnessTerminalAgent = z.infer<typeof HarnessTerminalAgentSchema>

export const HarnessEnabledProfileSchema = z.object({
  harnessId: HarnessIdSchema,
  credentialMode: HarnessCredentialModeSchema,
  providerId: z.string().trim().min(1).max(128).optional()
}).strict()
export type HarnessEnabledProfile = z.infer<typeof HarnessEnabledProfileSchema>

/** `harnesses` config section: per-harness enable/override settings. */
export const HarnessesConfigSchema = z
  .object({
    /** External engines require explicit opt-in for the exact credential profile. */
    enabledProfiles: z.array(HarnessEnabledProfileSchema).max(128).default([]),
    /** Builtin harnesses the user turned off; they stay out of pickers. */
    disabledIds: z.array(HarnessIdSchema).max(64).default([]),
    /** Per-harness binary path overrides (settings override > bundled > PATH). */
    binaryPaths: z.record(HarnessIdSchema, z.string().min(1).max(4_096)).default({}),
    /**
     * Hidden per-harness transport pin (P6-07): maps a builtin harness id to
     * one of its declared `variants` — e.g. `{codex: 'acp'}` keeps the ACP
     * adapter while codex defaults to `codex-app-server`. Not user-facing;
     * unknown ids/transports are ignored by the catalog.
     */
    transportOverrides: z
      .record(HarnessIdSchema, HarnessTransportSchema)
      .default({}),
    /**
     * Hidden pre-GA opt-ins (P6-09): builtin harnesses declared `prerelease`
     * stay out of the catalog unless their id is listed here. Removed once
     * the P6-12 acceptance matrix lands.
     */
    experimentalIds: z.array(HarnessIdSchema).max(64).default([]),
    /** User-defined ACP harnesses; ids colliding with builtins are dropped. */
    custom: z.array(HarnessCustomEntrySchema).max(32).default([]),
    /**
     * Legacy pre-P4-11 map; superseded by `defaults[*].permissionMode`.
     * Still accepted so hand-written config files keep working.
     */
    defaultPermissionMode: z.record(HarnessIdSchema, z.string().min(1).max(64)).default({}),
    /** Per-harness defaults for credential/provider/model/permission/isolation. */
    defaults: z.record(HarnessIdSchema, HarnessDefaultsEntrySchema).default({}),
    /** Default harness for new one-to-one ADE conversations. */
    defaultHarnessId: HarnessIdSchema.default('kun'),
    /** Ordered user preference for the ADE worker selector (10 §3.2). */
    agentOrder: z.array(HarnessIdSchema).max(16).default([]),
    /** Terminal-only agents (p4 §3.8); join the catalog as `transport: 'terminal'`. */
    terminalAgents: z.array(HarnessTerminalAgentSchema).max(32).default([])
  })
  .strict()
export type HarnessesConfig = z.infer<typeof HarnessesConfigSchema>
