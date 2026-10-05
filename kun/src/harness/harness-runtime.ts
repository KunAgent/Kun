import { HarnessUpdates } from './harness-updates.js'
import { harnessUpdateCompatible } from './harness-update-compatibility.js'
import { HarnessesConfigSchema } from '../config/kun-config-harnesses.js'
import { HarnessReadinessService } from './harness-readiness.js'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import type { HarnessDefinition } from '../contracts/harness.js'
import type { ServeProviderConfig } from '../config/kun-config-application.js'
import type { KunServeRuntimeOptions } from '../server/runtime-factory-types.js'
import { HarnessCatalog } from './harness-catalog.js'
import { HarnessDetector, spawnCaptured } from './harness-detector.js'
import { probeHarnessLogin } from './harness-login-probes.js'
import { AcpModelProbe } from './acp-model-probe.js'
import { PiModelProbe } from './pi-model-probe.js'
import { CodexModelProbe } from './codex-model-probe.js'
import { AgentSdkModelProbe } from './agent-sdk-model-probe.js'
import { HarnessTokenService } from './harness-token-service.js'
import type { HarnessSecretRefResolver } from './harness-secret-env.js'

const runtimeRequire = createRequire(import.meta.url)

function bundledClaudeCode(): { version?: string; command?: string } | undefined {
  try {
    const pkgPath = join(dirname(runtimeRequire.resolve('@anthropic-ai/claude-agent-sdk')), 'package.json')
    const version = (runtimeRequire(pkgPath) as { version?: string }).version
    let command: string | undefined
    try { command = runtimeRequire.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/${process.platform === 'win32' ? 'claude.exe' : 'claude'}`) } catch { /* SDK resolves its own platform package for model/account control requests. */ }
    return { version, command }
  } catch {
    return undefined
  }
}

function bundledRuntime(def: HarnessDefinition): { version?: string; command?: string } | undefined {
  if (def.id === 'claude-code') return bundledClaudeCode()
  return undefined
}

export type HarnessRuntimeComposition = {
  catalog: HarnessCatalog
  readiness: HarnessReadinessService
  detector: HarnessDetector
  /** ACP `session/new` model probing for `modelSource: 'probe'` harnesses. */
  acpModels: AcpModelProbe
  /** Agent SDK `supportedModels()` probing for `modelSource: 'probe'` harnesses. */
  agentSdkModels: AgentSdkModelProbe
  /** Codex app-server `model/list` probing (P6-07). */
  codexModels: CodexModelProbe
  piModels: PiModelProbe
  updates: HarnessUpdates
  invalidateModels(id: string): void
  installNetwork?: () => import('../contracts/native-agent-network.js').NativeAgentNetworkPolicy | undefined
  /**
   * Spawn-free read of the freshest probed model list, dispatched by
   * transport; `undefined` means no fresh successful probe is cached.
   */
  probedModels: (definition: HarnessDefinition) => string[] | undefined
  /** Process-local scoped bearer tokens for spawned harnesses (04 §4). */
  tokens: HarnessTokenService
  /**
   * Loopback `kun serve` endpoint for harness gateway env injection. The
   * serve layer fills `baseUrl` after the listener binds; absent means this
   * runtime is not serve-hosted (gateway credential mode fails fast).
   */
  gatewayEndpoint: { baseUrl?: string }
  /**
   * Resolves `launch.secretEnv` credential-store refs (P4-12); undefined when
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
    Partial<Pick<KunServeRuntimeOptions, 'approvalPolicy' | 'sandboxMode' | 'approvalReviewer'>>,
  deps: { revision?: () => number; resolveSecretEnv?: HarnessSecretRefResolver; resolveProviderCredential?: (sourceId: string) => Promise<{ apiKey: string } | null> } = {}
): HarnessRuntimeComposition {
  const catalog = new HarnessCatalog({
    custom: () => options().harnesses?.custom ?? [],
    nativeAgentNetwork: () => options().nativeAgentNetwork,
    terminalAgents: () => options().harnesses?.terminalAgents ?? [],
    enabledProfiles: () => options().harnesses?.enabledProfiles ?? [],
    disabled: () => options().harnesses?.disabledIds ?? [],
    transportOverrides: () => options().harnesses?.transportOverrides ?? {},
    experimental: () => options().harnesses?.experimentalIds ?? []
  })
  const detector = new HarnessDetector({
    definitions: () => catalog.list(),
    overrides: () => {
      const binaryPaths = {
        ...(process.env.KUN_CLAUDE_BINARY ? { 'claude-code': process.env.KUN_CLAUDE_BINARY } : {}),
        ...(process.env.KUN_ANTIGRAVITY_BINARY ? { antigravity: process.env.KUN_ANTIGRAVITY_BINARY } : {}),
        ...options().harnesses?.binaryPaths
      }
      return Object.fromEntries(
        Object.entries(binaryPaths).map(([id, binaryPath]) => [id, { binaryPath }])
      )
    },
    bundled: bundledRuntime,
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
    binaryPath: (id) => options().harnesses?.binaryPaths?.[id],
    resolveSecretEnv: deps.resolveSecretEnv
  })
  const agentSdkModels = new AgentSdkModelProbe({
    binaryPath: (id) =>
      options().harnesses?.binaryPaths?.[id] ?? process.env.KUN_CLAUDE_BINARY
  })
  const codexModels = new CodexModelProbe({
    binaryPath: (id) => options().harnesses?.binaryPaths?.[id],
    resolveSecretEnv: deps.resolveSecretEnv
  })
  const piModels = new PiModelProbe({ binaryPath: (id) => options().harnesses?.binaryPaths?.[id], resolveSecretEnv: deps.resolveSecretEnv })
  const probedModels = (definition: HarnessDefinition): string[] | undefined =>
    definition.transport === 'acp'
      ? acpModels.peek(definition)
      : definition.transport === 'agent-sdk'
        ? agentSdkModels.peek(definition)
        : definition.transport === 'pi-rpc' ? piModels.peek(definition)
        : definition.transport === 'codex-app-server'
          ? codexModels.peek(definition)
          : undefined
  const readiness = new HarnessReadinessService({ options, catalog, detector, revision: deps.revision,
    resolveSecretEnv: deps.resolveSecretEnv, resolveProviderCredential: deps.resolveProviderCredential,
    sdkHandshake: (definition, env, signal) => agentSdkModels.probeReadiness(definition, env, signal) })
  const invalidateModels = (_id: string): void => {
    agentSdkModels.invalidate(); acpModels.invalidate(); codexModels.invalidate(); piModels.invalidate()
  }
  const updates = new HarnessUpdates({
    definition: (id) => catalog.get(id), detect: (id) => detector.status(id, { force: true }),
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
        ...original.harnesses, binaryPaths: { ...original.harnesses?.binaryPaths, [id]: path }
      }) }
      const probe = createHarnessComposition(() => override, deps)
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
    updates, invalidateModels,
    catalog,
    readiness,
    detector,
    acpModels,
    agentSdkModels,
    codexModels,
    piModels,
    installNetwork: () => options().nativeAgentNetwork?.installer,
    probedModels,
    tokens: new HarnessTokenService(),
    gatewayEndpoint: {},
    ...(deps.resolveSecretEnv ? { resolveSecretEnv: deps.resolveSecretEnv } : {})
  }
}
