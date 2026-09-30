import {
  HarnessDefinitionSchema,
  type HarnessDefinition,
  type HarnessId,
  type HarnessTransport
} from '../contracts/harness.js'
import {
  allUnsupportedStatuses,
  type HarnessCapabilities
} from '../contracts/harness-capabilities.js'
import {
  ACP_DEFAULT_CAPABILITIES,
  BUILTIN_HARNESSES,
  CLAUDE_SETTINGS_HOOK_EVENTS
} from './builtin-harnesses.js'
import { bindNativeAgentNetwork } from './native-agent-network.js'
import type { NativeAgentNetworkSnapshot } from '../contracts/native-agent-network.js'

export type CustomHarnessConfig = {
  id: string
  displayName: string
  command: string
  args: string[]
  env: Record<string, string>
  /** Credential-store refs resolved into env at spawn (P4-12). */
  secretEnv?: readonly { name: string; secretRef: string }[]
}

/**
 * `harnesses.terminalAgents[]` config entry (p4 §3.8, P4-13): an interactive
 * CLI that runs inside a Kun terminal tab, not a delegated turn runtime.
 */
export type TerminalAgentConfig = {
  id: string
  displayName: string
  command: string
  args: readonly string[]
  taskFlag?: string
  resumeArgs?: readonly string[]
  hooks?: 'none' | 'claude-settings'
}

const CUSTOM_TRANSPORT = 'acp'
const TERMINAL_TRANSPORT = 'terminal'

/**
 * Swap a builtin definition onto one of its declared `variants` when a
 * transport override names it. Unknown transports (no matching variant) fall
 * through untouched so a stale pin can never break the catalog.
 */
function applyTransportOverride(
  def: HarnessDefinition,
  override: HarnessTransport | undefined
): HarnessDefinition {
  if (!override || override === def.transport) return def
  const variant = def.variants?.[override]
  if (!variant) return def
  return {
    ...def,
    transport: override,
    launch: variant.launch,
    ...(variant.detect ? { detect: variant.detect } : {}),
    ...(variant.capabilities ? { capabilities: variant.capabilities } : {}),
    ...(variant.setup ? { setup: variant.setup } : {}),
    ...(variant.poolScope ? { poolScope: variant.poolScope } : {})
  }
}

/**
 * Terminal agents host no turns: every capability is unavailable so
 * `manager-worker` admission and `harness_list` mark them terminal-only.
 */
const TERMINAL_AGENT_CAPABILITIES: HarnessCapabilities = {
  statuses: allUnsupportedStatuses('upstream', {
    message: 'terminal-only agent; runs inside a Kun terminal tab'
  }),
  facts: { sandbox: 'none', usageReporting: 'none', compactionOwner: 'harness' }
}

/**
 * Read-only catalog of harness definitions: builtin entries merged with
 * user-defined ACP harnesses and terminal agents from config. Definitions
 * colliding with an earlier id are dropped (builtin > custom > terminal).
 */
export class HarnessCatalog {
  constructor(
    private readonly deps: {
      custom: () => readonly CustomHarnessConfig[]
      terminalAgents?: () => readonly TerminalAgentConfig[]
      /** User-disabled builtin harness ids; they stay visible but unadmittable. */
      disabled?: () => readonly HarnessId[]
      /**
       * P6-07 hidden transport pins: `{codex: 'acp'}` re-selects a declared
       * variant while the default keeps moving (or stays pinned) — unknown
       * ids/transports are ignored rather than breaking the catalog.
       */
      transportOverrides?: () => Readonly<Record<string, HarnessTransport>>
      /** Pre-GA builtin ids explicitly opted into (harnesses.experimentalIds). */
      experimental?: () => readonly string[]
      nativeAgentNetwork?: () => NativeAgentNetworkSnapshot | undefined
    } = {
      custom: () => []
    }
  ) {}

  list(): HarnessDefinition[] {
    const customs: HarnessDefinition[] = []
    const taken = new Set(BUILTIN_HARNESSES.map((d) => d.id))
    for (const entry of this.deps.custom()) {
      const parsed = HarnessDefinitionSchema.safeParse(customToDefinition(entry))
      if (parsed.success && !taken.has(parsed.data.id)) {
        taken.add(parsed.data.id)
        customs.push(parsed.data)
      }
    }
    for (const entry of this.deps.terminalAgents?.() ?? []) {
      const parsed = HarnessDefinitionSchema.safeParse(terminalAgentToDefinition(entry))
      if (parsed.success && !taken.has(parsed.data.id)) {
        taken.add(parsed.data.id)
        customs.push(parsed.data)
      }
    }
    const overrides = this.deps.transportOverrides?.() ?? {}
    const experimental = new Set(this.deps.experimental?.() ?? [])
    const builtins = BUILTIN_HARNESSES.map((def) =>
      applyTransportOverride(def, overrides[def.id])
    ).filter((def) => !def.prerelease || experimental.has(def.id))
    return [...builtins, ...customs].map((definition) =>
      bindNativeAgentNetwork(definition, this.deps.nativeAgentNetwork?.()))
  }

  get(id: string): HarnessDefinition | undefined {
    return this.list().find((d) => d.id === id)
  }

  /**
   * Whether the user disabled this builtin harness. The native Kun loop is the
   * host runtime itself and can never be disabled through settings.
   */
  isDisabled(id: HarnessId): boolean {
    return id !== 'kun' && (this.deps.disabled?.() ?? []).includes(id)
  }
}

/** Build the catalog definition for a `harnesses.custom[]` entry (P4-12: also used by probe-definition). */
export function customToDefinition(entry: CustomHarnessConfig): unknown {
  return {
    id: entry.id as HarnessId,
    displayName: entry.displayName,
    transport: CUSTOM_TRANSPORT,
    detect: {
      command: entry.command,
      aliases: [],
      versionArgs: ['--version']
    },
    launch: {
      command: entry.command,
      args: entry.args,
      env: entry.env,
      secretEnv: entry.secretEnv ?? []
    },
    credentialModes: ['native-login'],
    permissionModes: [
      { id: 'default', label: 'Ask', kunPermissionMode: 'ask-for-approval' },
      { id: 'auto', label: 'Auto', kunPermissionMode: 'full-access' }
    ],
    modelSource: 'probe',
    staticModels: [],
    capabilities: ACP_DEFAULT_CAPABILITIES,
    builtin: false
  }
}

/**
 * Build the catalog definition for a `harnesses.terminalAgents[]` entry.
 * `detect.command` lets the detector prove existence; `terminal.argv` drives
 * the PTY launch; a `claude-settings` opt-in turns managed hooks on.
 */
export function terminalAgentToDefinition(entry: TerminalAgentConfig): unknown {
  return {
    id: entry.id as HarnessId,
    displayName: entry.displayName,
    transport: TERMINAL_TRANSPORT,
    detect: {
      command: entry.command,
      aliases: [],
      versionArgs: ['--version']
    },
    terminal: {
      argv: [...entry.args],
      ...(entry.taskFlag ? { taskFlag: entry.taskFlag } : {}),
      ...(entry.resumeArgs?.length ? { resumeArgs: [...entry.resumeArgs] } : {}),
      ...(entry.hooks === 'claude-settings'
        ? {
            hooks: {
              kind: 'claude-settings',
              events: [...CLAUDE_SETTINGS_HOOK_EVENTS]
            }
          }
        : {})
    },
    // No turn runtime consumes these; the schema still requires one entry.
    credentialModes: ['native-login'],
    permissionModes: [
      { id: 'default', label: 'Ask', kunPermissionMode: 'ask-for-approval' }
    ],
    modelSource: 'static',
    staticModels: [],
    capabilities: TERMINAL_AGENT_CAPABILITIES,
    builtin: false
  }
}
