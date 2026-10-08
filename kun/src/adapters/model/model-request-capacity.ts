import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import { capabilityFieldKnown } from '../../contracts/model-metadata-evidence.js'
import { estimateModelRequestInputTokens } from '../../loop/model-request-estimator.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'

/** Validate the complete request without trimming caller history or assuming unknown limits. */
export function modelRequestCapacityFailure(request: ModelRequest,
  capability: ModelCapabilityMetadata | undefined): Extract<ModelStreamChunk, { kind: 'error' }> | undefined {
  if (!capability) return undefined
  if (capabilityFieldKnown(capability, 'inputModalities') && capability.inputModalities.length === 0) return {
    kind: 'error', code: 'model_input_capability_unsupported',
    message: 'The configured input modalities have no overlap with this model capability. Restore automatic input settings or choose a compatible model.',
    failure: { category: 'request', reason: 'request', httpStatus: 400, failoverAllowed: false }
  }
  if (request.tools.length && capabilityFieldKnown(capability, 'supportsToolCalling') && !capability.supportsToolCalling) return {
    kind: 'error', code: 'model_tools_unsupported', message: 'This model explicitly does not support tool calling. Choose a tool-capable model or send a request without tools.',
    failure: { category: 'request', reason: 'request', httpStatus: 400, failoverAllowed: false }
  }
  const input = estimateModelRequestInputTokens(request)
  const maxInput = capabilityFieldKnown(capability, 'maxInputTokens') ? capability.maxInputTokens : undefined
  const context = capabilityFieldKnown(capability, 'contextWindowTokens') ? capability.contextWindowTokens : undefined
  if (maxInput !== undefined && input > maxInput) return {
    kind: 'error', code: 'model_input_limit_exceeded',
    message: `Estimated input (${input} tokens) exceeds this model's maximum input (${maxInput} tokens). Shorten the input, tools, or attachments.`,
    failure: { category: 'request', reason: 'request', httpStatus: 400, failoverAllowed: false }
  }
  if (context !== undefined && input >= context) return {
    kind: 'error', code: 'model_context_limit_exceeded',
    message: `Estimated input (${input} tokens) leaves no output room in this model's ${context}-token context. Shorten the request.`,
    failure: { category: 'request', reason: 'request', httpStatus: 400, failoverAllowed: false }
  }
  return undefined
}

/** An output request is a ceiling; never enlarge it or spend the model's input-only allowance on output. */
export function fitModelRequestOutput(request: ModelRequest, capability: ModelCapabilityMetadata | undefined,
  fallback?: number): number | undefined {
  const requested = request.maxTokens ?? capability?.maxOutputTokens ?? fallback
  if (requested === undefined) return undefined
  const context = capability && capabilityFieldKnown(capability, 'contextWindowTokens') ? capability.contextWindowTokens : undefined
  const available = context === undefined ? Infinity : Math.max(1, context - estimateModelRequestInputTokens(request))
  return Math.max(1, Math.floor(Math.min(requested, capability?.maxOutputTokens ?? Infinity, available)))
}
