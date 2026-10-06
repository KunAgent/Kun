import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { ModelCatalogPricing } from '../../contracts/capabilities-core.js'
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
  pricing?: ModelCatalogPricing
  serviceTiers?: ModelCapabilityMetadata['serviceTiers']
  responsesMode?: ModelCapabilityMetadata['responsesMode']
  /** Resolved upstream model name, when it differs from Kun's id. */
  wireModelId?: string
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
    ...(metadata?.reasoning ? { reasoning: metadata.reasoning } : {}),
    ...(metadata?.pricing ? { pricing: metadata.pricing } : {}),
    ...(metadata?.serviceTiers ? { serviceTiers: metadata.serviceTiers } : {}),
    ...(metadata?.responsesMode ? { responsesMode: metadata.responsesMode } : {}),
    ...(metadata?.wireModelId ? { wireModelId: resolveWireModelId(metadata.wireModelId, input.model) } : {})
  }
}

/** `*` in an upstream name stands for the model's own id. */
export function resolveWireModelId(template: string, model: string): string {
  return template.includes('*') ? template.split('*').join(model) : template
}
