import { describe, expect, it } from 'vitest'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { ModelConnectionSnapshot } from '../../contracts/model-connections.js'
import { metadataEvidence } from '../../contracts/model-metadata-evidence.js'
import { describeGatewayModel } from './gateway-models-catalog.js'

const cap = (extra: Partial<ModelCapabilityMetadata> = {}): ModelCapabilityMetadata => ({
  id: 'm', inputModalities: ['text', 'image'], outputModalities: ['text'], supportsToolCalling: true, messageParts: ['text'],
  contextWindowTokens: 128_000, maxInputTokens: 96_000, maxOutputTokens: 32_000, ...extra
})
const describeModels = (caps: ModelCapabilityMetadata[]) => describeGatewayModel({ providers: [] } as unknown as ModelConnectionSnapshot,
  caps.map((_, index) => ({ providerId: 'p', modelId: String(index) })), (id) => caps[Number(id)], { routed: true })

describe('public capability evidence', () => {
  it('omits operational defaults with unknown evidence', () => {
    expect(describeModels([cap({ evidence: metadataEvidence({}, 'adapter') })])).toEqual({})
  })
  it('publishes independent input and output modality facts', () => {
    const c = cap({ evidence: metadataEvidence({ inputModalities: ['text', 'image'] }, 'provider') })
    expect(describeModels([c])).toEqual({ modalities: { input: ['text', 'image'] } })
  })
  it('takes the route intersection and independent minimum capacities', () => {
    expect(describeModels([cap(), cap({ supportsToolCalling: false, inputModalities: ['text'], maxInputTokens: 64_000 })]))
      .toMatchObject({ supports_tools: false, max_input_tokens: 64_000, context_window: 128_000,
        modalities: { input: ['text'], output: ['text'] } })
  })
  it('does not fabricate effort levels for a reasoning boolean', () => {
    expect(describeModels([cap({ supportsReasoning: true })])).toMatchObject({ reasoning: true })
    expect(describeModels([cap({ supportsReasoning: true })]).supported_reasoning_levels).toBeUndefined()
    expect(describeModels([cap({ supportsReasoning: true }), cap()]).reasoning).toBeUndefined()
    expect(describeModels([cap({ supportsReasoning: true }), cap({ supportsReasoning: false })]).reasoning).toBe(false)
  })
})
