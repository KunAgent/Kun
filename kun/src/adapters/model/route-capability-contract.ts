import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { ModelRequest } from '../../ports/model-client.js'
import { capabilityFieldKnown } from '../../contracts/model-metadata-evidence.js'

/** Unknown on any member remains unknown; a union is never a route guarantee. */
export function routeCapabilityGuarantees(capabilities: readonly (ModelCapabilityMetadata | undefined)[]) {
  const minimum = (field: 'contextWindowTokens' | 'maxOutputTokens') => capabilities.length &&
    capabilities.every((cap) => cap?.[field] !== undefined && capabilityFieldKnown(cap, field))
    ? Math.min(...capabilities.map((cap) => cap![field]!)) : undefined
  return {
    tools: Boolean(capabilities.length && capabilities.every((cap) => cap?.supportsToolCalling && capabilityFieldKnown(cap, 'supportsToolCalling'))),
    vision: Boolean(capabilities.length && capabilities.every((cap) => cap?.inputModalities.includes('image') && capabilityFieldKnown(cap, 'inputModalities'))),
    reasoning: Boolean(capabilities.length && capabilities.every((cap) => cap?.reasoning && capabilityFieldKnown(cap, 'reasoning'))),
    contextWindowTokens: minimum('contextWindowTokens'), maxOutputTokens: minimum('maxOutputTokens')
  }
}

export function capabilitySupportsRequest(capability: ModelCapabilityMetadata | undefined, request: ModelRequest): boolean {
  if (!capability) return !request.tools.length && !hasImages(request) && !request.reasoningEffort
  if (hasImages(request) && (!capability.inputModalities.includes('image') || !capabilityFieldKnown(capability, 'inputModalities'))) return false
  if (request.tools.length && (!capability.supportsToolCalling || !capabilityFieldKnown(capability, 'supportsToolCalling'))) return false
  if (request.reasoningEffort && request.reasoningEffort !== 'off' && (!capability.reasoning || !capabilityFieldKnown(capability, 'reasoning'))) return false
  if (request.reasoningEffort && !['off', 'auto'].includes(request.reasoningEffort) &&
      !capability.reasoning?.supportedEfforts.some((effort) => effort === request.reasoningEffort)) return false
  if (request.parallelToolCalls === true && request.tools.length &&
      (!capability.parallelTools || !capabilityFieldKnown(capability, 'parallelTools'))) return false
  if (request.responseFormat && (!capability.structuredOutput || !capabilityFieldKnown(capability, 'structuredOutput'))) return false
  if (request.maxTokens && capability.maxOutputTokens && request.maxTokens > capability.maxOutputTokens) return false
  const input = JSON.stringify([...request.prefix, ...request.history]).length / 4
  return !capability.contextWindowTokens || input + (request.maxTokens ?? 0) <= capability.contextWindowTokens
}

/**
 * External agents often ask for an output budget as large as their whole
 * window (Kimi Code sends its context size). For gateway traffic that number
 * is a ceiling, not a requirement: each target receives the largest budget it
 * can honor, and only a target with no room left at all is ineligible.
 */
export function fittedMaxTokens(capability: ModelCapabilityMetadata | undefined, request: ModelRequest): number | undefined {
  if (!request.maxTokens || !capability) return request.maxTokens
  const input = Math.ceil(JSON.stringify([...request.prefix, ...request.history]).length / 4)
  const room = capability.contextWindowTokens ? capability.contextWindowTokens - input : Number.POSITIVE_INFINITY
  return Math.max(0, Math.min(request.maxTokens, capability.maxOutputTokens ?? Number.POSITIVE_INFINITY, room))
}

/** Same as capabilitySupportsRequest, with a gateway caller's max_tokens treated as a ceiling. */
export function capabilitySupportsGatewayRequest(capability: ModelCapabilityMetadata | undefined, request: ModelRequest): boolean {
  if (!request.gatewayRouting || !request.maxTokens) return capabilitySupportsRequest(capability, request)
  const fitted = fittedMaxTokens(capability, request)
  return fitted !== undefined && fitted >= 1 && capabilitySupportsRequest(capability, { ...request, maxTokens: fitted })
}

function hasImages(request: ModelRequest): boolean {
  return Boolean(request.attachments?.length) || Object.values(request.messageAttachments ?? {})
    .some((attachments) => attachments.images.length > 0)
}
