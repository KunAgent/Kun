import { HarnessCatalog } from '../../src/harness/harness-catalog.js'
import { HarnessRouter } from '../../src/harness/harness-router.js'
import type { DelegatedTurnRuntime } from '../../src/runtime/delegated-turn-runtime.js'

/** Offline test-only profile opt-ins; production still requires real readiness. */
export function offlineAgentSdkHarness(runtime: DelegatedTurnRuntime, providerIds: Array<string | undefined>) {
  const delegated: DelegatedTurnRuntime = {
    handlesProvider: runtime.handlesProvider.bind(runtime),
    capabilities: runtime.capabilities?.bind(runtime) ?? (() => undefined),
    ...(runtime.capabilitiesV2 ? { capabilitiesV2: runtime.capabilitiesV2.bind(runtime) } : {}),
    runTurn: runtime.runTurn.bind(runtime)
  }
  const { catalog, providerKinds } = offlineAgentProfileConfig(providerIds)
  const router = new HarnessRouter({ enabled: () => true, catalog,
    runtimes: () => ({ 'agent-sdk': delegated }),
    providerKinds,
    defaultModel: () => 'offline-model',
    readiness: { configurationSignature: () => 'offline-fixture', prepareTurn: async () => undefined, releaseTurn: () => undefined }
  })
  return { delegated, router, providerKinds, catalog }
}

export function offlineAgentProfileConfig(providerIds: Array<string | undefined>) {
  const catalog = new HarnessCatalog({ custom: () => [], enabledProfiles: () => providerIds.map((providerId) => ({
    harnessId: 'claude-code', credentialMode: 'native-login', ...(providerId ? { providerId } : {})
  })) })
  const providerKinds = () => ({ defaultKind: providerIds.includes(undefined) ? 'agent-sdk' as const : 'http' as const,
    byId: Object.fromEntries(providerIds.filter((id): id is string => Boolean(id)).map(id => [id, 'agent-sdk' as const])) })
  return { providerKinds, harnessCatalog: catalog, catalog }
}
