import type { ModelProviderProfileV1 } from '@shared/app-settings'
import type { ModelsDevCatalogResult } from '@shared/kun-gui-api'

export const pendingPublicCatalog = (): ModelsDevCatalogResult => ({
  status: 'ok', providerKey: '', providerName: '', matchMode: 'enrichment-only', stale: false, models: []
})

type ModelHints = Array<{ id: string; aliases?: string[]; displayName?: string }>
type FetchCatalog = (target: ModelProviderProfileV1, hints?: ModelHints, force?: boolean) => Promise<ModelsDevCatalogResult>

/** One live discovery owns one deferred public lookup; opening never awaits it. */
export function progressiveModelImport(
  fetchCatalog: FetchCatalog,
  openImport: (input: Record<string, unknown>) => void
) {
  let pending: Promise<ModelsDevCatalogResult> | undefined
  return {
    fetchCatalog(target: ModelProviderProfileV1, hints?: ModelHints, force?: boolean): Promise<ModelsDevCatalogResult> {
      pending = fetchCatalog(target, hints, force).catch((error: unknown) => ({
        status: 'error', message: error instanceof Error ? error.message : String(error), models: []
      }))
      return Promise.resolve(pendingPublicCatalog())
    },
    openImport(input: { target: ModelProviderProfileV1; providerModelIds: string[]; catalogResult: ModelsDevCatalogResult; [key: string]: unknown }): void {
      const catalogPromise = pending?.then(async (result) => {
        if (result.status !== 'unmapped' || !input.providerModelIds.length) return result
        return fetchCatalog(input.target, input.providerModelIds.map((id) => ({ id, displayName: id })), false)
      })
      openImport({ ...input, ...(catalogPromise ? { catalogPromise, catalogLoading: true } : {}) })
    }
  }
}

export function completePendingModelCatalog<T extends { providerId: string; importRequestId?: number }>(
  previous: T | null,
  expected: { providerId: string; importRequestId: number; stillCurrent: boolean },
  catalogResult: ModelsDevCatalogResult
): (T & { catalogResult: ModelsDevCatalogResult; catalogLoading: false }) | T | null {
  return previous && expected.stillCurrent && previous.providerId === expected.providerId && previous.importRequestId === expected.importRequestId
    ? { ...previous, catalogResult, catalogLoading: false } : previous
}
