import { harnessGatewayBindingKey, type HarnessGatewayBinding } from '../contracts/harness-gateway-binding.js'
import {
  HarnessDefinitionSchema,
  type HarnessDefinition,
  type HarnessId,
  type HarnessCredentialMode,
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
import type { HarnessEnabledProfile } from '../config/kun-config-harnesses.js'
import {
  GENERIC_ACP_BASE,
  TERMINAL_BASE,
  harnessProviderOverrides,
  type HarnessProviderOverride
} from '../config/kun-config-harness-providers.js'
import { applyLaunchOverride, derivableProviderModule, deriveProviderModule } from './providers/derive.js'
import { builtinProviderModule, setDerivedProviderModules } from './providers/registry.js'
import type { AgentProviderModule } from './providers/provider-module.js'
import type { NativeAgentNetworkSnapshot } from '../contracts/native-agent-network.js'
import type { ExtensionAgentProvider } from './extension-agent-providers.js'

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
 * Read-only catalog of harness definitions: builtin entries patched by
 * their `providers` overrides, then user Agents derived from a builtin ACP
 * engine, generic ACP agents and terminal agents. A user Agent never
 * replaces a builtin id.
 */
export class HarnessCatalog {
  constructor(
    private readonly deps: {
      /** `harnesses.providers`, already folded with legacy fields or not. */
      providers?: () => Readonly<Record<string, HarnessProviderOverride>>
      /** Legacy `harnesses.custom[]`; folds into `providers`. */
      custom?: () => readonly CustomHarnessConfig[]
      /** Legacy `harnesses.terminalAgents[]`; folds into `providers`. */
      terminalAgents?: () => readonly TerminalAgentConfig[]
      /** User-disabled builtin harness ids; they stay visible but unadmittable. */
      disabled?: () => readonly HarnessId[]
      /** External profiles are opt-in; installed software is never consent. */
      enabledProfiles?: () => readonly HarnessEnabledProfile[]
      /**
       * P6-07 hidden transport pins: `{codex: 'acp'}` re-selects a declared
       * variant while the default keeps moving (or stays pinned) — unknown
       * ids/transports are ignored rather than breaking the catalog.
       */
      transportOverrides?: () => Readonly<Record<string, HarnessTransport>>
      /** Pre-GA builtin ids explicitly opted into (harnesses.experimentalIds). */
      experimental?: () => readonly string[]
      nativeAgentNetwork?: () => NativeAgentNetworkSnapshot | undefined
      /** Agents declared by enabled extensions; settings Agents win on id. */
      extensionAgents?: () => readonly ExtensionAgentProvider[]
    } = {}
  ) {}

  list(): HarnessDefinition[] {
    const overrides = harnessProviderOverrides({
      providers: this.deps.providers?.(),
      custom: this.deps.custom?.(),
      terminalAgents: this.deps.terminalAgents?.()
    })
    const transports = this.deps.transportOverrides?.() ?? {}
    const builtins = BUILTIN_HARNESSES.map((def) =>
      applyLaunchOverride(applyTransportOverride(def, transports[def.id]), overrides[def.id]))
    const taken = new Set(builtins.map((d) => d.id))
    const added: HarnessDefinition[] = []
    const derived: AgentProviderModule[] = []
    // Engine-backed Agents first, terminal-only ones after (the pre-P2 order).
    const entries = Object.entries(overrides).sort(([, a], [, b]) =>
      Number(a.extends === TERMINAL_BASE) - Number(b.extends === TERMINAL_BASE))
    for (const [id, override] of entries) {
      if (taken.has(id)) continue
      const built = userAgentDefinition(id, override)
      const parsed = built && HarnessDefinitionSchema.safeParse(built.definition)
      if (!built || !parsed?.success) continue
      taken.add(id)
      added.push(parsed.data)
      if (built.module) derived.push({ ...built.module, definition: parsed.data })
    }
    for (const agent of this.deps.extensionAgents?.() ?? []) {
      if (taken.has(agent.harnessId)) continue
      const built = userAgentDefinition(agent.harnessId, agent.override)
      const parsed = built && HarnessDefinitionSchema.safeParse({ ...built.definition as object,
        extension: { id: agent.extensionId, ...(agent.extensionName ? { name: agent.extensionName.slice(0, 128) } : {}) } })
      if (!built || !parsed?.success) continue
      taken.add(agent.harnessId)
      added.push(parsed.data)
      if (built.module) derived.push({ ...built.module, definition: parsed.data })
    }
    setDerivedProviderModules(derived)
    return [...builtins, ...added].map((definition) =>
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
    if (id === 'kun') return false
    const definition = this.get(id)
    return !definition || definition.transport === 'application' || definition.availability === 'retired' ||
      (this.deps.disabled?.() ?? []).includes(id) ||
      !(this.deps.enabledProfiles?.() ?? []).some((profile) =>
        profile.harnessId === id && definition.credentialModes.includes(profile.credentialMode) &&
        (profile.credentialMode === 'native-login' || Boolean(profile.providerId?.trim()) || Boolean(profile.gatewayBinding)))
  }

  /** Exact opt-ins for startup rechecks and settings; no credential values. */
  enabledProfiles(id: HarnessId): HarnessEnabledProfile[] {
    if (this.isDisabled(id)) return []
    return (this.deps.enabledProfiles?.() ?? []).filter((profile) =>
      profile.harnessId === id && this.isProfileEnabled(profile)).map((profile) => ({ ...profile }))
  }

  /** Picker candidates, without dropping definitions required to render history. */
  listAvailable(): HarnessDefinition[] {
    return this.list().filter((definition) => !this.isDisabled(definition.id))
  }

  /** A native login never grants access to a gateway or a different provider. */
  isProfileEnabled(route: {
    harnessId: HarnessId
    credentialMode: HarnessCredentialMode
    providerId?: string
    gatewayBinding?: HarnessGatewayBinding
  }): boolean {
    if (this.get(route.harnessId)?.transport === 'application') return false
    if (route.harnessId === 'kun') return route.credentialMode === 'provider'
    if (this.isDisabled(route.harnessId)) return false
    if (!this.get(route.harnessId)?.credentialModes.includes(route.credentialMode)) return false
    return (this.deps.enabledProfiles?.() ?? []).some((profile) =>
      profile.harnessId === route.harnessId && profile.credentialMode === route.credentialMode &&
      (route.gatewayBinding || profile.gatewayBinding
        ? Boolean(route.credentialMode === 'kun-gateway' && route.gatewayBinding && profile.gatewayBinding &&
          harnessGatewayBindingKey(route.gatewayBinding) === harnessGatewayBindingKey(profile.gatewayBinding))
        : route.credentialMode === 'native-login'
        ? (profile.providerId?.trim() || 'default') === (route.providerId?.trim() || 'default')
        : (Boolean(route.providerId?.trim()) && profile.providerId?.trim() === route.providerId?.trim())))
  }

}

/** Definition (and derived module) for a user Agent; `undefined` when its base is unusable. */
export function userAgentDefinition(
  id: string,
  override: HarnessProviderOverride
): { definition: unknown; module?: AgentProviderModule } | undefined {
  if (override.extends === TERMINAL_BASE || override.extends === GENERIC_ACP_BASE) {
    if (!override.command) return undefined
    const common = { id, displayName: override.label ?? id, command: override.command, args: override.args?.values ?? [] }
    return {
      definition: override.extends === TERMINAL_BASE
        ? terminalAgentToDefinition({ ...common, ...override.terminal })
        : customToDefinition({ ...common, env: override.env ?? {}, secretEnv: override.secretEnv })
    }
  }
  const base = builtinProviderModule(override.extends)
  if (!derivableProviderModule(base)) return undefined
  const module = deriveProviderModule(base, id, override)
  return { definition: module.definition, module }
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
