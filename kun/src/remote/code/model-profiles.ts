import { REASONING_EFFORTS, validateModelProfiles, type RemoteModelProfile } from '@kun/remote-protocol'
import type { HarnessDefinition } from '../../contracts/harness.js'
import type { HarnessModelInfo } from '../../contracts/harness-models.js'
import type { TurnReasoningEffort } from '../../contracts/turn-reasoning.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'

/** Reasoning levels per listed model of one route; a model without levels has no entry. */
export type ModelProfiles = Record<string, RemoteModelProfile>

/** Keeps only the wire's six levels, in host order; native-only names (`minimal`, `xhigh`) are dropped. */
export function modelProfile(efforts: readonly string[] | undefined, defaultEffort?: string): RemoteModelProfile | undefined {
  const allowed = REASONING_EFFORTS.filter((effort) => efforts?.includes(effort))
  if (!allowed.length) return undefined
  const fallback = allowed.find((effort) => effort === defaultEffort)
  return { efforts: allowed, ...(fallback ? { defaultEffort: fallback } : {}) }
}

export function routeProfiles(models: string[], profileOf: (model: string) => RemoteModelProfile | undefined) {
  const entries = models.flatMap((model) => {
    const profile = profileOf(model)
    return profile ? [[model, profile] as const] : []
  })
  return entries.length ? { profiles: Object.fromEntries(entries) as ModelProfiles } : {}
}

/** Spawn-free cached native facts from the same probe `probedModels` reads. */
export function probedModelInfo(runtime: ServerRuntime, definition: HarnessDefinition): HarnessModelInfo[] | undefined {
  const harnesses = runtime.harnesses
  switch (definition.transport) {
    case 'acp': return harnesses?.acpModels?.peekInfo(definition)
    case 'agent-sdk': return harnesses?.agentSdkModels?.peekInfo(definition)
    case 'codex-app-server': return harnesses?.codexModels?.peekInfo(definition)
    case 'antigravity-cli': return harnesses?.antigravityModels?.peekInfo(definition)
    default: return undefined
  }
}

/** Self-check before a route leaves the host; a malformed description is withheld, never sent. */
export function checkedProfiles<T extends { models: string[]; label: string; profiles?: ModelProfiles }>(route: T): T {
  if (!route.profiles) return route
  try { return validateModelProfiles(route) } catch {
    const { profiles: _profiles, ...rest } = route
    return rest as T
  }
}

/** An absent effort always passes; a present one must be listed for this exact route and model. */
export function allowsEffort(route: { profiles?: ModelProfiles }, model: string, effort: TurnReasoningEffort | undefined) {
  if (effort === undefined) return true
  const profile = route.profiles && Object.hasOwn(route.profiles, model) ? route.profiles[model] : undefined
  return Boolean(profile?.efforts.includes(effort))
}
