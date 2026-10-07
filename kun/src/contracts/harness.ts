import { HarnessGatewayBindingSchema } from './harness-gateway-binding.js'
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
  'codex-app-server',
  'pi-rpc',
  'terminal',
  'application'
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

/**
 * Install/login hints shown by the Agent Center (docs/ade/impl/p4 §3.3).
 * Commands come from each harness's official documentation and are only ever
 * prefilled into a Kun terminal — the user presses Enter, Kun never executes.
 */
export const HarnessSetupSchema = z
  .object({
    install: z
      .array(
        z
          .object({
            platform: z.enum(['darwin', 'linux', 'win32', 'any']),
            command: z.string().min(1).max(512),
            note: z.string().max(256).optional()
          })
          .strict()
      )
      .max(8)
      .optional(),
    login: z
      .object({
        command: z.string().min(1).max(256),
        args: z.array(z.string().max(256)).max(16).default([]),
        note: z.string().max(256).optional()
      })
      .strict()
      .optional(),
    docsUrl: z.string().url().max(512).optional(),
    /** Adapter package when the CLI itself cannot serve the transport (codex-acp). */
    adapter: z
      .object({
        command: z.string().min(1).max(256),
        install: z.string().min(1).max(512)
      })
      .strict()
      .optional()
  })
  .strict()
export type HarnessSetup = z.infer<typeof HarnessSetupSchema>

const HarnessDetectSchema = z
  .object({
    command: z.string().min(1).max(256),
    aliases: z.array(z.string().min(1).max(256)).max(8).default([]),
    versionArgs: z.array(z.string().max(64)).max(4).default(['--version']),
    versionPattern: z.string().max(256).optional(),
    identityPattern: z.string().max(256).optional(),
    rejectApplicationLauncher: z.boolean().optional(),
    versionPackage: z.string().min(1).max(128).optional(),
    minVersion: z.string().max(32).optional(),
    exactVersion: z.string().max(64).optional(),
    /**
     * When the primary command is absent, this fallback binary is
     * resolved; if it IS present the harness is not "not installed" —
     * it is an installed tool missing its adapter, and `message`
     * carries the install guidance (P3-11, e.g. codex -> codex-acp).
     */
    adapterHint: z
      .object({
        command: z.string().min(1).max(256),
        message: z.string().max(256)
      })
      .strict()
      .optional()
  })
  .strict()

const HarnessLaunchSchema = z
  .object({
    command: z.string().min(1).max(256),
    args: z.array(z.string().max(1_024)).max(32).default([]),
    /** Non-sensitive variables only; credentials are injected via credentialMode. */
    env: z
      .record(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), z.string().max(1_024))
      .default({}),
    /**
     * Secret variables resolved from the credential store at spawn
     * (docs/ade/impl/p4 §3.7, P4-12). Refs are opaque ids — the store
     * value itself never enters config, logs, or wire payloads.
     */
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
      .optional()
  })
  .strict()

const IntegrationLocationSchema = z.object({
  platform: z.enum(['darwin', 'linux', 'win32', 'any']),
  root: z.enum(['home', 'config', 'app-data', 'local-app-data', 'program-files', 'applications']),
  path: z.string().min(1).max(256).refine((path) => !path.startsWith('/') && !path.startsWith('\\') && !path.includes('\0') && !/^[a-z]:/i.test(path) &&
    !path.split(/[\\/]/).includes('..'), 'Integration paths must stay within their declared root')
}).strict()

export const HarnessApplicationSchema = z.object({
  kind: z.enum(['desktop', 'editor', 'extension']),
  locations: z.array(IntegrationLocationSchema).max(16).default([]),
  configLocations: z.array(IntegrationLocationSchema).max(16).default([]),
  /** Exact product identity where a launcher name is shared by distinct builds. */
  productName: z.string().max(128).optional(),
  configurationDocsUrl: z.string().url().max(512).optional()
}).strict()
export type HarnessApplication = z.infer<typeof HarnessApplicationSchema>

export const HarnessDefinitionSchema = z
  .object({
    id: HarnessIdSchema,
    displayName: z.string().min(1).max(64),
    transport: HarnessTransportSchema,
    /** Local detection; native-loop has none. */
    detect: HarnessDetectSchema.optional(),
    /** Launch command for acp / terminal transports; SDK transports decide internally. */
    launch: HarnessLaunchSchema.optional(),
    application: HarnessApplicationSchema.optional(),
    configurationLocations: z.array(IntegrationLocationSchema).max(16).optional(),
    /** Curated CLI policy; missing selectors never authorize guessing a native mode. */
    acpPermission: z.object({
      modeAliases: z.record(z.string().max(64), z.array(z.string().min(1).max(64)).max(8)).optional(),
      configOptionId: z.string().min(1).max(64).optional(),
      requireMode: z.boolean().optional()
    }).strict().optional(),
    /**
     * Alternate transport bindings (P6-07): when `harnesses.transportOverrides`
     * selects one of these transports, the catalog emits the definition with
     * that transport plus the variant's launch/detect/capabilities.
     */
    variants: z
      .partialRecord(
        HarnessTransportSchema,
        z
          .object({
            launch: HarnessLaunchSchema,
            detect: HarnessDetectSchema.optional(),
            capabilities: HarnessCapabilitiesSchema.optional(),
            /** Transport-specific setup guidance (for example an ACP adapter). */
            setup: HarnessSetupSchema.optional(),
            /** Overrides definition-level poolScope when this variant applies. */
            poolScope: z.enum(['credential', 'workspace', 'thread']).optional()
          })
          .strict()
      )
      .optional(),
    /**
     * Process-pool scope for session transports (P6-09). `credential` (default)
     * shares one spawned process per harness+credential; `workspace` keys the
     * pool by workspace too — required when the process binds its cwd at spawn
     * (pi rpc) and cannot re-target per session.
     */
    poolScope: z.enum(['credential', 'workspace', 'thread']).optional(),
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
    /**
     * The harness exposes user-switchable native Agents (OpenCode primary
     * agents) as ACP session modes. The composer lists them and a turn's
     * `harnessAgentId` selects one instead of the permission-mapped mode.
     */
    nativeAgents: z.literal('session-modes').optional(),
    staticModels: z.array(z.string().min(1).max(256)).max(64).default([]),
    /** Links to existing history-sources for "continue external session". */
    historySource: z.enum(['claude-code', 'codex', 'opencode']).optional(),
    /**
     * Pre-GA marker (P6-09): the catalog drops prerelease builtins unless the
     * hidden `harnesses.experimentalIds` config names them.
     */
    prerelease: z.boolean().optional(),
    /** Static declaration; the runtime may narrow it further per version/login. */
    capabilities: HarnessCapabilitiesSchema,
    /** Present when the harness can run through the loopback model gateway. */
    gateway: HarnessGatewaySchema.optional(),
    setup: HarnessSetupSchema.optional(),
    availability: z.enum(['active', 'preview', 'retired']).optional(),
    builtin: z.boolean()
  })
  .strict()
export type HarnessDefinition = z.infer<typeof HarnessDefinitionSchema>

export const HarnessRouteSchema = z
  .object({
    harnessId: HarnessIdSchema,
    providerId: z.string().min(1).max(128).optional(),
    model: z.string().min(1).max(512),
    credentialMode: HarnessCredentialModeSchema,
    gatewayBinding: HarnessGatewayBindingSchema.optional()
  })
  .strict()
export type HarnessRoute = z.infer<typeof HarnessRouteSchema>

/**
 * Stable machine-readable reason a harness is unavailable (P4-05). The
 * detector sets it when it has extra context (e.g. `adapter_missing` vs
 * `not_installed`); consumers may also derive it from the status fields.
 */
export const HarnessReasonCodeSchema = z.enum([
  'disabled',
  'not_installed',
  'adapter_missing',
  'version_too_low',
  'handshake_failed',
  'handshake_timeout',
  'signed_out'
])
export type HarnessReasonCode = z.infer<typeof HarnessReasonCodeSchema>

/** Detection result; metadata only, no credentials or other secrets. */
export const HarnessStatusSchema = z
  .object({
    harnessId: HarnessIdSchema,
    installed: z.enum(['yes', 'no', 'unknown']),
    version: z.string().max(64).optional(),
    versionSupported: z.boolean().optional(),
    /**
     * ACP initialize handshake after the version probe (P3-11): the binary
     * exists but may still crash, time out, or speak a wrong protocol.
     * Only set for harnesses the handshake probe covers (transport `acp`).
     */
    ready: z.enum(['yes', 'no', 'unknown']).optional(),
    login: z.enum(['signed-in', 'signed-out', 'unknown', 'not-required']),
    resolvedCommand: z.string().max(4_096).optional(),
    applicationPath: z.string().max(4_096).optional(),
    configurationPaths: z.array(z.string().max(4_096)).max(16).optional(),
    checkedAt: z.string().datetime(),
    /**
     * True while a detection pass is inflight for this harness (P4-02):
     * clients should show a spinner and poll instead of treating a
     * provisional `unknown` verdict as final.
     */
    detecting: z.boolean().optional(),
    networkSource: z.enum(['environment', 'system', 'direct', 'explicit-required']).optional(),
    networkFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    reasonCode: HarnessReasonCodeSchema.optional(),
    message: z.string().max(512).optional()
  })
  .strict()
export type HarnessStatus = z.infer<typeof HarnessStatusSchema>

/**
 * Derive the stable unavailability reason from status fields (P4-05).
 * Precedence follows the detection chain: a bad version is reported before a
 * handshake failure, which precedes a sign-in problem. `adapter_missing`
 * cannot be derived (it needs the fallback-binary check) — the detector sets
 * it explicitly on `installed: 'no'` statuses.
 */
export function harnessStatusReasonCode(
  status: Pick<HarnessStatus, 'installed' | 'versionSupported' | 'ready' | 'login'>
): HarnessReasonCode | undefined {
  if (status.installed === 'no') return 'not_installed'
  if (status.installed !== 'yes') return undefined
  if (status.versionSupported === false) return 'version_too_low'
  if (status.ready === 'no') return 'handshake_failed'
  // `signed_out` outranks the advisory `handshake_timeout` (P4-03 keeps an
  // inconclusive probe selectable): when both hold, signing in is the
  // actionable fix.
  if (status.login === 'signed-out') return 'signed_out'
  if (status.ready === 'unknown') return 'handshake_timeout'
  return undefined
}
