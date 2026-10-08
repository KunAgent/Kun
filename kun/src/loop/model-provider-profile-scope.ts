import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import { MODEL_METADATA_FIELDS, metadataEvidence } from '../contracts/model-metadata-evidence.js'
import type { ProviderModelCapabilityInput } from './model-context-profile-types.js'

/** Bare model names are not proof that a relay or another product has the same limits. */
export function providerOwnsBuiltInModel(input: ProviderModelCapabilityInput): boolean {
  if (Object.values(input.endpoints ?? {}).some((baseUrl) => baseUrl && !providerOwnsBuiltInModel({ ...input, baseUrl, endpoints: undefined }))) return false
  const model = input.model?.trim().toLowerCase() ?? ''
  if (model.includes('/')) return false
  let endpoint: URL
  try { endpoint = new URL(input.baseUrl ?? '') } catch { return false }
  if (!['https:', 'http:'].includes(endpoint.protocol)) return false
  const host = endpoint.hostname.toLowerCase()
  if (model.startsWith('deepseek-')) return host === 'api.deepseek.com'
  if (model.startsWith('glm-')) return host === 'open.bigmodel.cn' || host === 'api.z.ai'
  if (model.startsWith('gpt-')) return host === 'api.openai.com' ||
    (host === 'chatgpt.com' && /^\/backend-api\/codex(?:\/|$)/u.test(endpoint.pathname))
  return false
}

/** Keep explicit settings and current observations; remove unproven built-in adapter facts. */
export function scopeBuiltInModelCapability(input: ProviderModelCapabilityInput,
  capability: ModelCapabilityMetadata, hasBuiltInProfile: boolean): ModelCapabilityMetadata {
  if (!hasBuiltInProfile || providerOwnsBuiltInModel(input)) return capability
  const kept: Record<string, unknown> = {}
  const evidence = metadataEvidence({}, 'adapter')
  for (const field of MODEL_METADATA_FIELDS) {
    const fact = capability.evidence?.[field]
    if (fact && fact.status !== 'unknown' && fact.source !== 'adapter' &&
        !(fact.source === 'catalog' && fact.match && fact.match !== 'exact')) {
      kept[field] = capability[field]
      evidence[field] = fact
    }
  }
  return { id: capability.id, inputModalities: ['text'], outputModalities: ['text'], messageParts: ['text'],
    supportsToolCalling: true, contextWindowTokens: 32_000, ...kept, evidence } as ModelCapabilityMetadata
}
