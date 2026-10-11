import type { HarnessGatewayBinding, HarnessGatewayAliasGrant } from '../contracts/harness-gateway-binding.js'
import { HarnessUpdates } from './harness-updates.js'
import { harnessUpdateCompatible } from './harness-update-compatibility.js'
import { harnessIntegrationInfo, resolveHarnessIntegrationTarget } from './harness-integration.js'
import type { HarnessIntegrationInfo, HarnessIntegrationOpenRequest, HarnessIntegrationTarget } from '../contracts/harness-integration.js'
import { HarnessesConfigSchema } from '../config/kun-config-harnesses.js'
import { harnessCommandOverride, harnessProviderOverrides } from '../config/kun-config-harness-providers.js'
import { HarnessReadinessService } from './harness-readiness.js'
import type { HarnessDefinition } from '../contracts/harness.js'
import { PROVIDER_MODULES, providerModule } from './providers/registry.js'
import type { ServeProviderConfig } from '../config/kun-config-application.js'
import type { KunServeRuntimeOptions } from '../server/runtime-factory-types.js'
import { HarnessCatalog } from './harness-catalog.js'
import { HarnessDetector, spawnCaptured } from './harness-detector.js'
import { probeHarnessLogin } from './harness-login-probes.js'
import { AcpModelProbe } from './acp-model-probe.js'
import { PiModelProbe } from './pi-model-probe.js'
import { AntigravityModelProbe } from './antigravity-model-probe.js'
import { CodexModelProbe } from './codex-model-probe.js'
import { AgentSdkModelProbe } from './agent-sdk-model-probe.js'
import { HarnessTokenService } from './harness-token-service.js'
import type { HarnessSecretRefResolver } from './harness-secret-env.js'
import { ExtensionAgentProviderSource } from './extension-agent-providers.js'

/** Executable override from the engine's environment variable (e.g. a dev build). */
function binaryEnvOverride(id: string): string | undefined {
  const key = providerModule(id)?.binaryEnv
  return key ? process.env[key] : undefined
}

export type HarnessRuntimeComposition = {
  catalog: HarnessCatalog
  readiness: HarnessReadinessService
  detector: HarnessDetector
  /** ACP `session/new` model probing for `modelSource: 'probe'` harnesses. */
  acpModels: AcpModelProbe
  /** Agent SDK `supportedModels()` probing for `modelSource: 'probe'` harnesses. */
  agentSdkModels: AgentSdkModelProbe
  /** Codex app-server `model/list` probing. */
  codexModels: CodexModelProbe
  piModels: PiModelProbe
  /** `agy models` for the Antigravity CLI transport. */
  antigravityModels: AntigravityModelProbe
  updates: HarnessUpdates
  integration(id: string): Promise<HarnessIntegrationInfo | undefined>
  resolveIntegration(request: HarnessIntegrationOpenRequest): Promise<HarnessIntegrationTarget | undefined>
  invalidateModels(id: string): void
  installNetwork?: () => import('../contracts/native-agent-network.js').NativeAgentNetworkPolicy | undefined
  /**
   * Spawn-free read of the freshest probed model list, dispatched by
   * transport; `undefined` means no fresh successful probe is cached.
   */
  probedModels: (definition: HarnessDefinition) => string[] | undefined
  /** Process-local scoped bearer tokens for spawned harnesses. */
  tokens: HarnessTokenService
  /** Agents declared by enabled extensions; the runtime sets the loader. */
  extensionAgents: ExtensionAgentProviderSource
  /**
   * Loopback `kun serve` endpoint for harness gateway env injection. The
   * serve layer fills `baseUrl` after the listener binds; absent means this
   * runtime is not serve-hosted (gateway credential mode fails fast).
   */
  gatewayEndpoint: { baseUrl?: string }
  /**
   * Resolves `launch.secretEnv` credential-store refs; undefined when
   * the runtime has no credential store. Exposed for `probe-definition`.
   */
  resolveSecretEnv?: HarnessSecretRefResolver
}

/**
 * Build the harness catalog + detector bound to the live runtime options.
 * Settings overrides are read lazily on every detection pass so config
 * re-apply does not need to rebuild the detector.
 */
export function createHarnessComposition(
  options: () => Pick<KunServeRuntimeOptions, 'providers' | 'harnesses' | 'dataDir' | 'nativeAgentNetwork' | 'apiKey' | 'baseUrl' | 'model' | 'credentialSourceId'> &
    Partial<Pick<KunServeRuntimeOptions, 'approvalPolicy' | 'sandboxMode' | 'approvalReviewer' | 'routePools'>>,
  deps: { resolveGatewayAliases?: (binding: HarnessGatewayBinding) => Promise<HarnessGatewayAliasGrant[]>; revision?: () => number; resolveSecretEnv?: HarnessSecretRefResolver; resolveProviderCredential?: (sourceId: string) => Promise<{ apiKey: string } | null>
    /** Persist display readiness proofs here (the live Runtime only, never a probe composition). */
    readinessProofStorePath?: string } = {}
): HarnessRuntimeComposition {
  const extensionAgents = new ExtensionAgentProviderSource()
  const catalog = new HarnessCatalog({
    providers: () => harnessProviderOverrides(options().harnesses),
    extensionAgents: () => extensionAgents.list(),
    nativeAgentNetwork: () => options().nativeAgentNetwork,
    enabledProfiles: () => options().harnesses?.enabledProfiles ?? [],
    disabled: () => options().harnesses?.disabledIds ?? [],
    transportOverrides: () => options().harnesses?.transportOverrides ?? {},
    experimental: () => options().harnesses?.experimentalIds ?? []
  })
  const detector = new HarnessDetector({
    definitions: () => catalog.list(),
    overrides: () => {
      const binaryPaths = {
        ...Object.fromEntries(PROVIDER_MODULES.flatMap((module) => {
          const path = binaryEnvOverride(module.definition.id)
          return path ? [[module.definition.id, path]] : []
        })),
        ...Object.fromEntries(Object.entries(harnessProviderOverrides(options().harnesses))
          .flatMap(([id, override]) => override.command ? [[id, override.command]] : []))
      }
      return Object.fromEntries(
        Object.entries(binaryPaths).map(([id, binaryPath]) => [id, { binaryPath }])
      )
    },
    bundled: (def) => providerModule(def.id)?.bundled?.(),
    spawnCaptured,
    // Discovery is metadata-only. Explicit Check & enable owns protocol startup,
    // so merely opening Agent settings cannot bootstrap a disabled agent.
    probeLogin: (def, command, probeOptions) =>
      probeHarnessLogin(def, {
        providers: () => (options().providers ?? {}) as Record<string, ServeProviderConfig>,
        spawnCaptured, signal: probeOptions?.signal
      }, command),
    nowMs: () => Date.now(),
    nowIso: () => new Date().toISOString()
  })
  const acpModels = new AcpModelProbe({
    binaryPath: (id) => harnessCommandOverride(options().harnesses, id),
    resolveSecretEnv: deps.resolveSecretEnv
  })
  const agentSdkModels = new AgentSdkModelProbe({
    // An engine with its own SDK executable choice (Claude Code falls back to
    // the user's installation) starts what the detector reported.
    binaryPath: (id) => {
      const override = harnessCommandOverride(options().harnesses, id)
      const engine = providerModule(id)
      return engine?.sdkExecutable ? engine.sdkExecutable(override) : override ?? binaryEnvOverride(id)
    }
  })
  const codexModels = new CodexModelProbe({
    binaryPath: (id) => harnessCommandOverride(options().harnesses, id),
    resolveSecretEnv: deps.resolveSecretEnv
  })
  const piModels = new PiModelProbe({ binaryPath: (id) => harnessCommandOverride(options().harnesses, id), resolveSecretEnv: deps.resolveSecretEnv })
  const antigravityModels = new AntigravityModelProbe({ binaryPath: (id) => harnessCommandOverride(options().harnesses, id) ?? binaryEnvOverride(id) })
  const probedModels = (definition: HarnessDefinition): string[] | undefined =>
    definition.transport === 'acp'
      ? acpModels.peek(definition)
      : definition.transport === 'agent-sdk'
        ? agentSdkModels.peek(definition)
        : definition.transport === 'pi-rpc' ? piModels.peek(definition)
        : definition.transport === 'antigravity-cli' ? antigravityModels.peek(definition)
        : definition.transport === 'codex-app-server'
          ? codexModels.peek(definition)
          : undefined
  const readiness = new HarnessReadinessService({ options, catalog, detector, revision: deps.revision,
    resolveSecretEnv: deps.resolveSecretEnv, resolveProviderCredential: deps.resolveProviderCredential,
    resolveGatewayAliases: deps.resolveGatewayAliases,
    sdkHandshake: (definition, env, signal) => agentSdkModels.probeReadiness(definition, env, signal),
    ...(deps.readinessProofStorePath ? { proofStorePath: deps.readinessProofStorePath } : {}),
    onCatalog: (definition, catalog) => {
      if (definition.transport === 'acp') acpModels.seed(definition, catalog)
      else if (definition.transport === 'antigravity-cli') antigravityModels.seed(definition, catalog)
    } })
  // Refreshing one Agent must not discard another Agent's catalog.
  const invalidateModels = (id: string): void => {
    const transport = catalog.get(id)?.transport
    if (!transport) { agentSdkModels.invalidate(); acpModels.invalidate(); codexModels.invalidate(); piModels.invalidate(); antigravityModels.invalidate(); return }
    if (transport === 'acp') acpModels.invalidate(id)
    else if (transport === 'agent-sdk') agentSdkModels.invalidate()
    else if (transport === 'codex-app-server') codexModels.invalidate()
    else if (transport === 'pi-rpc') piModels.invalidate()
    else if (transport === 'antigravity-cli') antigravityModels.invalidate()
  }
  const updates = new HarnessUpdates({
    definition: (id) => catalog.get(id), detect: (id) => detector.status(id, { force: true }),
    currentStatus: (id) => {
      const status = detector.cachedStatus(id)
      return status && !status.detecting && status.installed === 'yes' && status.resolvedCommand ? status : undefined
    },
    beginMaintenance: (id) => readiness.beginMaintenance(id), inUse: (id) => readiness.inUse(id),
    invalidate: (id) => { invalidateModels(id); readiness.invalidateHarness(id) },
    afterActivate: async (id) => {
      const definition = catalog.get(id), profile = catalog.enabledProfiles(id)[0]
      if (!definition || !profile) return
      const result = await readiness.test(definition, { level: 'handshake', ...profile,
        ...(profile.credentialMode === 'native-login' ? { model: 'default' } : {}), timeoutMs: 60_000 })
      if (!harnessUpdateCompatible(result)) throw new Error(result.readiness?.detail || result.readiness?.checks.find((check) => !check.ok)?.detail || 'Updated Agent could not be verified on the active configuration')
    },
    network: () => options().nativeAgentNetwork?.installer,
    verify: async (id, path, signal) => {
      const original = options()
      const override = { ...original, harnesses: HarnessesConfigSchema.parse({
        ...original.harnesses, providers: { ...original.harnesses?.providers, [id]: { ...original.harnesses?.providers?.[id], command: path } }
      }) }
      const probe = createHarnessComposition(() => override, { ...deps, readinessProofStorePath: undefined })
      const definition = probe.catalog.get(id)
      if (!definition) throw new Error('Agent definition is unavailable')
      const status = await probe.detector.status(id, { force: true, signal })
      if (!status.version || status.versionSupported === false) throw new Error('Agent version is incompatible with this Kun build')
      const profile = original.harnesses?.enabledProfiles?.find((entry) => entry.harnessId === id) ?? { credentialMode: definition.credentialModes[0] }
      const result = await probe.readiness.test(definition, { level: 'handshake', ...profile,
        ...(profile.credentialMode === 'native-login' ? { model: 'default' } : {}), timeoutMs: 60_000 }, signal)
      if (!harnessUpdateCompatible(result)) throw new Error(result.readiness?.detail || 'Agent compatibility verification failed; the current selection was kept')
      return { version: status.version, models: result.handshake?.models ?? [] }
    }
  })
  return {
    integration: async (id) => {
      const definition = catalog.get(id)
      return definition ? harnessIntegrationInfo(definition, { binaryPath: harnessCommandOverride(options().harnesses, id) }) : undefined
    },
    resolveIntegration: async (request) => {
      const definition = catalog.get(request.harnessId)
      return definition ? resolveHarnessIntegrationTarget(definition, request, { binaryPath: harnessCommandOverride(options().harnesses, request.harnessId) }) : undefined
    },
    updates, invalidateModels,
    catalog,
    readiness,
    detector,
    acpModels,
    agentSdkModels,
    codexModels,
    piModels,
    antigravityModels,
    installNetwork: () => options().nativeAgentNetwork?.installer,
    probedModels,
    tokens: new HarnessTokenService(),
    extensionAgents,
    gatewayEndpoint: {},
    ...(deps.resolveSecretEnv ? { resolveSecretEnv: deps.resolveSecretEnv } : {})
  }
}
