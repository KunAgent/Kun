import type { ModelMetadataEvidence } from '../contracts/model-metadata-evidence.js'
import type { ModelCatalogPricing, ModelInputModality, ModelMessagePartSupport, ModelReasoningCapabilityMetadata } from '../contracts/capabilities.js'
import type { ModelEndpointFormat } from '../contracts/model-endpoint-format.js'

export type ModelContextThresholds = {
  softThreshold: number
  hardThreshold: number
}

export type ModelContextCompactionProfileConfig = {
  softRatio?: number
  hardRatio?: number
  softThreshold?: number
  hardThreshold?: number
}

export type ModelContextProfile = ModelContextThresholds & {
  canonicalModel: string
  modelIds: readonly string[]
  contextWindowTokens: number
  maxInputTokens?: number
  maxOutputTokens?: number
  supportsReasoning?: boolean
  inputModalities: readonly ModelInputModality[]
  outputModalities: readonly ModelInputModality[]
  supportsToolCalling: boolean
  parallelTools?: boolean; streaming?: boolean; structuredOutput?: boolean
  evidence?: ModelMetadataEvidence
  messageParts: readonly ModelMessagePartSupport[]
  reasoning?: ModelReasoningCapabilityMetadata
  pricing?: ModelCatalogPricing
  serviceTiers?: readonly ('priority' | 'flex')[]
  endpointFormat?: ModelEndpointFormat
  responsesMode?: 'lite'
}

export type ModelContextProfileConfig = {
  aliases?: readonly string[]
  contextWindowTokens?: number
  maxInputTokens?: number
  maxOutputTokens?: number
  supportsReasoning?: boolean
  contextCompaction?: ModelContextCompactionProfileConfig
  /** @deprecated Use contextCompaction.softRatio. */
  softRatio?: number
  /** @deprecated Use contextCompaction.hardRatio. */
  hardRatio?: number
  /** @deprecated Use contextCompaction.softThreshold. */
  softThreshold?: number
  /** @deprecated Use contextCompaction.hardThreshold. */
  hardThreshold?: number
  inputModalities?: readonly ModelInputModality[]
  outputModalities?: readonly ModelInputModality[]
  supportsToolCalling?: boolean
  parallelTools?: boolean; streaming?: boolean; structuredOutput?: boolean
  evidence?: ModelMetadataEvidence
  messageParts?: readonly ModelMessagePartSupport[]
  reasoning?: ModelReasoningCapabilityMetadata
  pricing?: ModelCatalogPricing
  serviceTiers?: readonly ('priority' | 'flex')[]
  endpointFormat?: ModelEndpointFormat
  responsesMode?: 'lite'
}

export type ModelConfig = {
  profiles?: Record<string, ModelContextProfileConfig>
}

export type ContextCompactionConfig = {
  defaultSoftThreshold?: number
  defaultHardThreshold?: number
  summaryMode?: 'heuristic' | 'model'
  /**
   * Parent switch for model-initiated compression. Alone it advertises
   * compact_context plus budget notices; combined with windowModeEnabled it
   * selects the window strategy. Missing means summary mode.
   */
  modelInitiatedCompactionEnabled?: boolean
  /**
   * Opt-in window-mode context strategy. Effective only when
   * modelInitiatedCompactionEnabled is also true. Then enabled turns advertise
   * the history/notes/new_context tools and budget notices instead of the
   * summary compaction path. Missing means summary mode.
   */
  windowModeEnabled?: boolean
  summaryTimeoutMs?: number
  summaryMaxTokens?: number
  summaryInputMaxBytes?: number
  /** Optional model override for compaction summary (empty = follow main model). */
  summaryModel?: string
  /** Provider id paired with summaryModel. */
  summaryProviderId?: string
  /**
   * Target post-compaction input ratio relative to the model context window
   * (0 < ratio < 1). The verbatim tail is trimmed to complete turns that fit
   * this budget so consecutive compactions actually reclaim capacity.
   */
  targetInputRatio?: number
  /** Absolute post-compaction input target in tokens; overrides the ratio when set. */
  targetInputTokens?: number
  /**
   * @deprecated Model-specific context windows and compaction thresholds belong
   * in top-level models.profiles. This field is still read for compatibility.
   */
  modelProfiles?: Record<string, ModelContextProfileConfig>
}

export type ModelProfileConfigSource = {
  models?: ModelConfig
  contextCompaction?: ContextCompactionConfig
}

export type ProviderModelCapabilityInput = {
  providerId?: string
  presetSource?: string
  baseUrl?: string
  endpointFormat?: ModelEndpointFormat
  endpoints?: Partial<Record<'chat_completions' | 'responses' | 'messages', string>>
  kind?:
    | 'http'
    | 'agent-sdk'
    | 'antigravity-cli'
    | 'cursor-sdk'
    | 'gemini-cli-api'
    | 'gemini-code-assist'
  model?: string
}
