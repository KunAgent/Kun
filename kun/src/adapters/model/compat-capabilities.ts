import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  normalizeModelEndpointFormat,
  type ModelEndpointFormat
} from '../../contracts/model-endpoint-format.js'

export type CompatModelCapabilities = {
  model: string
  endpointFormat: ModelEndpointFormat
  inputModalities: ModelCapabilityMetadata['inputModalities']
  messageParts: ModelCapabilityMetadata['messageParts']
  supportsStreaming: boolean
  supportsVision: boolean
  supportsReasoning: boolean
  supportsCacheUsage: boolean
  supportsToolCalling: boolean
  maxOutputTokens?: number
  reasoning?: ModelCapabilityMetadata['reasoning']
}

export function resolveCompatModelCapabilities(input: {
  model: string
  providerEndpointFormat?: ModelEndpointFormat
  modelCapabilities?: (model: string) => ModelCapabilityMetadata
}): CompatModelCapabilities {
  const metadata = input.modelCapabilities?.(input.model)
  const endpointFormat = normalizeModelEndpointFormat(
    metadata?.endpointFormat ?? input.providerEndpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT
  )
  const inputModalities = metadata?.inputModalities ?? ['text']
  const messageParts = metadata?.messageParts ?? ['text']
  return {
    model: input.model,
    endpointFormat,
    inputModalities,
    messageParts,
    supportsStreaming: true,
    supportsVision: inputModalities.includes('image'),
    supportsReasoning: metadata?.reasoning !== undefined,
    supportsCacheUsage: true,
    supportsToolCalling: metadata?.supportsToolCalling ?? true,
    ...(metadata?.maxOutputTokens ? { maxOutputTokens: metadata.maxOutputTokens } : {}),
    ...(metadata?.reasoning ? { reasoning: metadata.reasoning } : {})
  }
}
