import { createRequire } from 'node:module'
import type { HarnessDefinition } from '../contracts/harness.js'
import type { ServeProviderConfig } from '../config/kun-config-application.js'
import type { KunServeRuntimeOptions } from '../server/runtime-factory-types.js'
import { HarnessCatalog } from './harness-catalog.js'
import { HarnessDetector, spawnCaptured } from './harness-detector.js'
import { probeHarnessLogin } from './harness-login-probes.js'
import { AcpModelProbe } from './acp-model-probe.js'
import { AgentSdkModelProbe } from './agent-sdk-model-probe.js'
import { HarnessTokenService } from './harness-token-service.js'

const runtimeRequire = createRequire(import.meta.url)

function bundledClaudeCode(): { version?: string; command?: string } | undefined {
  try {
    const pkgPath = runtimeRequire.resolve('@anthropic-ai/claude-agent-sdk/package.json')
    const version = (runtimeRequire(pkgPath) as { version?: string }).version
    return { version }
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
  detector: HarnessDetector
  /** ACP `session/new` model probing for `modelSource: 'probe'` harnesses. */
  acpModels: AcpModelProbe
  /** Agent SDK `supportedModels()` probing for `modelSource: 'probe'` harnesses. */
  agentSdkModels: AgentSdkModelProbe
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
}

/**
 * Build the harness catalog + detector bound to the live runtime options.
 * Settings overrides are read lazily on every detection pass so config
 * re-apply does not need to rebuild the detector.
 */
export function createHarnessComposition(
  options: () => Pick<KunServeRuntimeOptions, 'providers' | 'harnesses'>
): HarnessRuntimeComposition {
  const catalog = new HarnessCatalog({
    custom: () => options().harnesses?.custom ?? [],
    disabled: () => options().harnesses?.disabledIds ?? []
  })
  const detector = new HarnessDetector({
    definitions: () => catalog.list(),
    overrides: () => {
      const binaryPaths = options().harnesses?.binaryPaths ?? {}
      return Object.fromEntries(
        Object.entries(binaryPaths).map(([id, binaryPath]) => [id, { binaryPath }])
      )
    },
    bundled: bundledRuntime,
    spawnCaptured,
    probeLogin: (def) =>
      probeHarnessLogin(def, {
        providers: () => (options().providers ?? {}) as Record<string, ServeProviderConfig>
      }),
    nowMs: () => Date.now(),
    nowIso: () => new Date().toISOString()
  })
  const acpModels = new AcpModelProbe({
    binaryPath: (id) => options().harnesses?.binaryPaths?.[id]
  })
  const agentSdkModels = new AgentSdkModelProbe({
    binaryPath: (id) =>
      options().harnesses?.binaryPaths?.[id] ?? process.env.KUN_CLAUDE_BINARY
  })
  const probedModels = (definition: HarnessDefinition): string[] | undefined =>
    definition.transport === 'acp'
      ? acpModels.peek(definition)
      : definition.transport === 'agent-sdk'
        ? agentSdkModels.peek(definition)
        : undefined
  return {
    catalog,
    detector,
    acpModels,
    agentSdkModels,
    probedModels,
    tokens: new HarnessTokenService(),
    gatewayEndpoint: {}
  }
}
