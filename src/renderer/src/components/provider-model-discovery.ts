import type {
  ModelProviderModelProfileV1,
  ModelProviderProfileV1
} from '@shared/app-settings'
import { modelProviderRequiresApiKey } from '@shared/app-settings-provider-core'
import type { ModelsDevCatalogResult } from '@shared/kun-gui-api'
import type { Dispatch, SetStateAction } from 'react'
import { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'
import {
  buildProviderModelImportEntries,
  providerModelImportEntryKey,
  providerModelImportResult
} from './provider-model-import'
import type { ProviderModelImportResult } from './provider-model-import-dialog'
import {
  providerConnectionFingerprint,
  type ProbeState
} from './settings-section-providers-profile'
import {
  requestSharedModelConnectionProbe,
  shouldUseSharedModelConnectionProbe,
  type SharedModelConnection
} from './settings-section-providers-shared-api'
import { flushProviderMutations } from './provider-mutation-flush'
import { applyProviderModelImport } from './use-provider-probe-operations'

const QUICK_ADD_MODEL_LIMIT = 24

export type ProviderModelDiscovery = {
  added: number
  firstChatModel?: string
  /** Provider profile merged with the imported models — caller persists it. */
  mergedProvider?: ModelProviderProfileV1
}

/**
 * Non-interactive model discovery for quick-add (plan B3): probe the provider
 * for its model list, enrich it with the models.dev catalog, then import the
 * top chat models without opening the picker dialog. The imported count plus
 * the first chat model come back so the caller can write the Kun selection.
 */
export async function discoverProviderModels(
  target: ModelProviderProfileV1,
  deps: {
    t: (key: string, options?: Record<string, unknown>) => string
    providerProxy?: { enabled: boolean; url: string }
    sharedConnectionFor: (providerId: string) => SharedModelConnection | undefined
    fetchModelsDevCatalogFor: (
      target: ModelProviderProfileV1,
      modelHints?: { id: string; displayName?: string }[],
      forceRefresh?: boolean
    ) => Promise<ModelsDevCatalogResult>
    importPickedModels: (
      target: ModelProviderProfileV1,
      picked: ProviderModelImportResult,
      authoritative?: boolean,
      modelAliases?: Readonly<Record<string, readonly string[]>>,
      discoveredModelProfiles?: Readonly<Record<string, ModelProviderModelProfileV1>>
    ) => Promise<number>
    setProbeStates: Dispatch<SetStateAction<Record<string, ProbeState>>>
  }
): Promise<ProviderModelDiscovery> {
  const { t, providerProxy, sharedConnectionFor, fetchModelsDevCatalogFor, importPickedModels, setProbeStates } = deps
  // The committed profile is always secret-free, so the probe-state
  // fingerprint must be computed without the draft key — otherwise the
  // detail view never treats this result as fresh for the added provider.
  const fingerprint = providerConnectionFingerprint(
    { ...target, apiKey: '' },
    providerProxy
  )
  setProbeStates((previous) => ({
    ...previous,
    [target.id]: { fingerprint, mode: 'fetch', status: 'busy' }
  }))
  const startedAt = performance.now()
  try {
    let modelIds: string[] = []
    let discoveredModelProfiles: Record<string, ModelProviderModelProfileV1> = {}
    if (shouldUseSharedModelConnectionProbe(target, sharedConnectionFor(target.id))) {
      // The probe observes committed Registry credentials; wait for the staged
      // credential mutation from the quick-add submit to drain first.
      const barrier = await flushProviderMutations({
        providerIds: [target.id],
        mutationKinds: ['credential', 'catalog']
      })
      if (!barrier.ok) {
        throw barrier.timedOut
          ? new Error(`Provider credential sync timed out: ${target.id}`)
          : barrier.error instanceof Error
            ? barrier.error
            : String(barrier.error)
      }
      modelIds = await requestSharedModelConnectionProbe(target.id)
    } else {
      const sharedCredentialReady = sharedModelConnectionHasUsableCredential(
        sharedConnectionFor(target.id)
      )
      if (modelProviderRequiresApiKey(target) && !target.apiKey.trim() && !sharedCredentialReady) {
        throw new Error(t('modelProviderPresetMissingKeyForProbe'))
      }
      if (typeof window.kunGui?.probeModelProvider !== 'function') {
        throw new Error('Model provider probe bridge is unavailable')
      }
      const result = await window.kunGui.probeModelProvider({
        providerId: target.id,
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
        endpointFormat: target.endpointFormat,
        ...(target.endpoints ? { endpoints: target.endpoints } : {}),
        useProxy: target.useProxy
      })
      if (!result.ok) throw new Error(result.message)
      modelIds = [...result.modelIds]
      discoveredModelProfiles = result.modelProfiles ?? {}
    }
    let catalogResult = await fetchModelsDevCatalogFor(target)
    // Unmapped custom/relay providers get a second pass with the discovered
    // model ids so family rules can attach catalog metadata.
    if (catalogResult.status === 'unmapped' && modelIds.length > 0) {
      catalogResult = await fetchModelsDevCatalogFor(
        target,
        modelIds.map((id) => ({ id, displayName: id })),
        false
      )
    }
    const entries = buildProviderModelImportEntries(target, modelIds, catalogResult)
    const chatEntries = entries.filter(
      (entry) => entry.kind === 'chat' && entry.sources.includes('provider-api')
    )
    if (chatEntries.length === 0) {
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: {
          fingerprint,
          mode: 'fetch',
          status: 'error',
          message: t('modelProviderFetchEmpty')
        }
      }))
      return { added: 0 }
    }
    const picked = chatEntries.slice(0, QUICK_ADD_MODEL_LIMIT)
    const selected = new Set(
      picked.map((entry) => providerModelImportEntryKey(entry.kind, entry.modelId))
    )
    const result = providerModelImportResult(entries, selected)
    const added = await importPickedModels(
      target,
      result,
      false,
      {},
      discoveredModelProfiles
    )
    setProbeStates((previous) => ({
      ...previous,
      [target.id]: {
        fingerprint,
        mode: 'fetch',
        status: 'ok',
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        total: added
      }
    }))
    return {
      added,
      firstChatModel: picked[0]?.modelId,
      mergedProvider: applyProviderModelImport(target, result, false, {}, discoveredModelProfiles)
    }
  } catch (error) {
    setProbeStates((previous) => ({
      ...previous,
      [target.id]: {
        fingerprint,
        mode: 'fetch',
        status: 'error',
        message: error instanceof Error ? error.message : String(error)
      }
    }))
    return { added: 0 }
  }
}
