import { DEFAULT_KUN_CAPABILITIES_CONFIG } from '../contracts/capabilities.js'
import { mergeBuiltinSubagentProfiles } from '../delegation/builtin-profiles.js'
import { AgentRoster, type AgentRosterLearnedProfile } from '../delegation/agent-roster.js'
import type { AgentRosterEngineAccess } from '../delegation/agent-roster-lanes.js'
import type { HarnessRuntimeMap } from '../harness/harness-router.js'
import { createCapabilitiesForRoute } from './runtime-composition-manager.js'
import { activeModelConnectionProviderId } from './runtime-factory-model.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'

/**
 * The runtime's agent roster. It reads live options on every call, so the
 * same instance stays correct across config apply and needs no re-listing.
 */
export function createRuntimeAgentRoster(input: {
  options: () => KunServeRuntimeOptions
  harnesses: Pick<AgentRosterEngineAccess, 'catalog' | 'detector' | 'probedModels'> & {
    catalog: Parameters<typeof createCapabilitiesForRoute>[0]
  }
  harnessRuntimeMap: HarnessRuntimeMap
  learned?: (workspace: string) => Promise<readonly AgentRosterLearnedProfile[]>
}): AgentRoster {
  const { options } = input
  return new AgentRoster({
    profiles: () => mergeBuiltinSubagentProfiles(
      (options().capabilities ?? DEFAULT_KUN_CAPABILITIES_CONFIG).subagents
    ).profiles,
    honorEngineBinding: () => options().capabilities?.subagents.honorEngineBinding !== false,
    defaultParent: () => ({
      model: options().model,
      providerId: activeModelConnectionProviderId(options())
    }),
    engines: {
      catalog: input.harnesses.catalog,
      detector: input.harnesses.detector,
      capabilitiesForRoute: createCapabilitiesForRoute(input.harnesses.catalog, input.harnessRuntimeMap),
      ...(input.harnesses.probedModels
        ? { probedModels: (definition) => input.harnesses.probedModels?.(definition) }
        : {}),
      configuredModel: (_harnessId, providerId) => providerId
        ? options().providers?.[providerId]?.selectedModel ?? options().providers?.[providerId]?.models?.[0]
        : undefined,
      gatewayAliasModel: (binding) =>
        options().routePools?.find((pool) => pool.id === binding.main.routeId && pool.enabled)?.modelId
    },
    ...(input.learned ? { learned: input.learned } : {})
  })
}
