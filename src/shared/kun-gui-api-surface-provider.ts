import type {
  ExternalProviderDraft,
  ExternalProviderImportRequest,
  ExternalProviderImportResult,
  ProviderImportLinkCommitResult,
  ProviderImportLinkStageResult,
  ProviderProtocolDetectResult,
  StagedProviderImportLink
} from './kun-gui-api-contracts'

/**
 * Provider-management surface of `window.kunGui`: probing extras, external
 * tool import, custom icons, and `kun://import` deep links. Split from
 * `kun-gui-api-surface.ts` to keep both files under the 700-line gate.
 */
export interface KunGuiProviderApi {
  detectProviderProtocols: (payload: {
    baseUrl: string
    credential?: string
    customHeaders?: Record<string, string>
    verifyModel?: string
    useProxy?: boolean
  }) => Promise<ProviderProtocolDetectResult>
  scanExternalProviders: () => Promise<ExternalProviderDraft[]>
  importExternalProvider: (
    payload: ExternalProviderImportRequest
  ) => Promise<ExternalProviderImportResult>
  importProviderIcon: (
    payload: { mime: string; dataBase64: string }
  ) => Promise<{ ok: true; iconId: string } | { ok: false; message: string }>
  providerIconDataUrl: (
    payload: { iconId: string }
  ) => Promise<{ dataUrl: string | null }>
  stageProviderImportLink: (
    payload: { link: string }
  ) => Promise<ProviderImportLinkStageResult>
  commitProviderImportLink: (
    payload: { token: string }
  ) => Promise<ProviderImportLinkCommitResult>
  onProviderImportLink: (
    handler: (staged: StagedProviderImportLink) => void
  ) => () => void
}
