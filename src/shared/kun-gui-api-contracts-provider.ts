import type { ModelEndpointFormat } from './app-settings'

/**
 * Provider IPC contracts: external-tool import drafts, `kun://import` staged
 * links, and protocol-detection results. Split from `kun-gui-api-contracts.ts`
 * to keep both files under the 700-line gate.
 */
export type ExternalProviderSourceId = 'cc-switch' | 'claude-code' | 'codex' | 'opencode'

export type ExternalProviderDraft = {
  source: ExternalProviderSourceId
  /** Opaque locator the main process re-reads on commit. */
  ref: string
  name: string
  suggestedId: string
  baseUrl: string
  endpointFormat: ModelEndpointFormat
  models: string[]
  hasKey: boolean
  keyHint?: string
  needsKey: boolean
  status: 'new' | 'exists' | 'conflict-renamed' | 'mergeable'
  mergeTargetId?: string
  presetId?: string
  skipped?: string
}

export type ExternalProviderImportRequest = {
  source: ExternalProviderSourceId
  ref: string
  name?: string
}

export type ExternalProviderImportResult =
  | { ok: true; providerId: string }
  | { ok: false; message: string }

/**
 * Sanitized `kun://import` draft staged in the main process. The API key
 * itself never crosses to the renderer; `token` resolves it on commit.
 */
export type ProviderImportLinkDraftView = {
  presetId?: string
  name?: string
  chatBaseUrl?: string
  anthropicBaseUrl?: string
  responsesBaseUrl?: string
  models: string[]
  hasKey: boolean
  keyHint?: string
}

export type StagedProviderImportLink = {
  token: string
  draft: ProviderImportLinkDraftView
  warnings: string[]
}

export type ProviderImportLinkStageResult =
  | { ok: true; staged: StagedProviderImportLink }
  | { ok: false; message: string }

export type ProviderImportLinkCommitResult =
  | { ok: true; providerId: string }
  | { ok: false; message: string }

export type ProviderDetectedProtocol = {
  format: ModelEndpointFormat
  ok: boolean
  /** Model catalog answered with this format's auth family. */
  listed: boolean
  /** A real minimal inference request completed on this format. */
  verified: boolean
  latencyMs: number
  models?: string[]
  message?: string
}

export type ProviderProtocolDetectResult = {
  baseUrl: string
  formats: ProviderDetectedProtocol[]
  recommended?: ModelEndpointFormat
}
