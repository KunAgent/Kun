import type { ModelCapabilityMetadata } from '../../contracts/capabilities-core.js'
import { capabilityFieldKnown } from '../../contracts/model-metadata-evidence.js'
import type { ModelConnectionSnapshot } from '../../contracts/model-connections.js'

/**
 * Public `/v1/models` metadata. Agents read reasoning levels, windows and
 * modalities from here instead of shipping their own lists. Only facts the
 * registry knows are published: an unknown window is omitted, never guessed.
 * A routed alias publishes what every member guarantees (the intersection of
 * reasoning levels, the smallest window, image input only when all take it).
 */
export type GatewayModelDescription = {
  display_name?: string
  reasoning?: boolean
  supported_reasoning_levels?: { effort: string }[]
  default_reasoning_level?: string
  context_window?: number
  max_output_tokens?: number
  modalities?: { input: string[]; output: string[] }
  supports_tools?: boolean
  native_endpoints?: string[]
}

const EFFORT_ORDER = ['off', 'low', 'medium', 'high', 'max', 'auto']
const ENDPOINT_PATHS = { chat_completions: '/v1/chat/completions', responses: '/v1/responses', messages: '/v1/messages' } as const

type Member = { providerId: string; modelId: string }
type Capabilities = (modelId: string, providerId?: string) => ModelCapabilityMetadata | undefined

function known(capability: ModelCapabilityMetadata, field: 'contextWindowTokens' | 'maxOutputTokens' | 'reasoning' | 'inputModalities'): boolean {
  return capabilityFieldKnown(capability as unknown as Record<string, unknown>, field as never)
}

function nativeEndpoints(snapshot: ModelConnectionSnapshot, member: Member, capability?: ModelCapabilityMetadata): string[] {
  const provider = snapshot.providers.find((entry) => entry.id === member.providerId)
  if (!provider) return []
  const formats = new Set<string>()
  const primary = capability?.endpointFormat ?? provider.endpointFormat
  if (primary !== 'custom_endpoint') formats.add(primary)
  for (const [format, url] of Object.entries(provider.endpoints ?? {})) if (url) formats.add(format)
  return [...formats].filter((format): format is keyof typeof ENDPOINT_PATHS => format in ENDPOINT_PATHS)
    .map((format) => ENDPOINT_PATHS[format]).sort()
}

export function describeGatewayModel(snapshot: ModelConnectionSnapshot, members: readonly Member[],
  capabilitiesFor: Capabilities | undefined, options: { displayName?: string; routed: boolean }): GatewayModelDescription {
  const out: GatewayModelDescription = {}
  if (options.displayName) out.display_name = options.displayName
  const capabilities = members.map((member) => capabilitiesFor?.(member.modelId, member.providerId))
  if (!members.length || capabilities.some((entry) => !entry)) return out
  const all = capabilities as ModelCapabilityMetadata[]
  out.supports_tools = all.every((entry) => entry.supportsToolCalling)
  if (all.every((entry) => known(entry, 'reasoning'))) {
    const reasoning = all.map((entry) => entry.reasoning)
    if (reasoning.every((entry) => !entry)) out.reasoning = false
    else if (reasoning.every(Boolean)) {
      const shared = EFFORT_ORDER.filter((effort) => reasoning.every((entry) => entry!.supportedEfforts.includes(effort as never)))
      out.reasoning = shared.some((effort) => effort !== 'off')
      if (shared.length) out.supported_reasoning_levels = shared.map((effort) => ({ effort }))
      const defaults = new Set(reasoning.map((entry) => entry!.defaultEffort))
      if (defaults.size === 1 && shared.includes([...defaults][0]!)) out.default_reasoning_level = [...defaults][0]
    }
  }
  if (all.every((entry) => known(entry, 'contextWindowTokens'))) out.context_window = Math.min(...all.map((entry) => entry.contextWindowTokens!))
  if (all.every((entry) => known(entry, 'maxOutputTokens'))) out.max_output_tokens = Math.min(...all.map((entry) => entry.maxOutputTokens!))
  if (all.every((entry) => known(entry, 'inputModalities'))) {
    const input = ['text', 'image'].filter((modality) => all.every((entry) => entry.inputModalities.includes(modality as never)))
    const output = ['text', 'image'].filter((modality) => all.every((entry) => entry.outputModalities.includes(modality as never)))
    out.modalities = { input, output }
  }
  // A routed alias may translate on any member, so it advertises no native passthrough.
  if (!options.routed) {
    const endpoints = nativeEndpoints(snapshot, members[0]!, all[0])
    if (endpoints.length) out.native_endpoints = endpoints
  }
  return out
}

export function gatewayModelsText(models: readonly { id: string }[]): string {
  return models.map((model) => model.id).join('\n') + (models.length ? '\n' : '')
}
