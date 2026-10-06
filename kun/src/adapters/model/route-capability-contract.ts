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

function hasImages(request: ModelRequest): boolean {
  return Boolean(request.attachments?.length) || Object.values(request.messageAttachments ?? {})
    .some((attachments) => attachments.images.length > 0)
}
