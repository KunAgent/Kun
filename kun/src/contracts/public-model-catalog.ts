export type ModelsDevCatalogModality = 'text' | 'audio' | 'image' | 'video' | 'pdf'

export type ModelsDevCatalogModelHint = {
  id: string
  aliases?: string[]
}

export type ModelsDevCatalogMetadataIssue = {
  field: 'contextWindowTokens' | 'maxInputTokens' | 'maxOutputTokens'
  code: 'out_of_range'
  rawValue: number
  maxAllowed: number
}

export type ModelsDevCatalogPricing = {
  /** USD per million input tokens (non-cache). */
  inputUsdPerMillion: number
  /** USD per million output tokens. */
  outputUsdPerMillion: number
  /** Cache-read/write USD per million tokens; omitted falls back to input. */
  cacheReadUsdPerMillion?: number
  cacheWriteUsdPerMillion?: number
}

export type ModelsDevCatalogModel = {
  observedAt?: string
  id: string
  providerKey?: string
  name?: string
  description?: string
  inputModalities: ModelsDevCatalogModality[]
  outputModalities: ModelsDevCatalogModality[]
  reasoning?: boolean
  reasoningOptions?: { supportedEfforts: string[]; defaultEffort?: string }
  matchSpecificity?: 'exact' | 'family' | 'normalized' | 'cross-provider'
  toolCalling?: boolean
  parallelTools?: boolean; streaming?: boolean; structuredOutput?: boolean
  /** True only when models.dev reports both input and output cost as zero. */
  free?: boolean
  pricing?: ModelsDevCatalogPricing
  contextWindowTokens?: number
  maxInputTokens?: number
  maxOutputTokens?: number
  /** Import-only diagnostics for catalog fields omitted by the sanitizer. */
  metadataIssues?: ModelsDevCatalogMetadataIssue[]
}

export type ModelsDevCatalogRequest = {
  providerId: string
  baseUrl: string
  forceRefresh?: boolean
  modelHints?: ModelsDevCatalogModelHint[]
  catalogSources?: string[]
}

export type ModelsDevCatalogMatchMode = 'catalog' | 'enrichment-only'

export type ModelsDevCatalogSource = 'models.dev' | 'kun-agent'

export type ModelsDevCatalogResult =
  | {
      status: 'ok'
      providerKey: string
      providerName: string
      matchMode: ModelsDevCatalogMatchMode
      stale: boolean
      /** Which catalog source produced the model data (for diagnostics/UI). */
      source?: ModelsDevCatalogSource
      models: ModelsDevCatalogModel[]
    }
  | { status: 'unmapped'; models: [] }
  | { status: 'error'; message: string; models: [] }
