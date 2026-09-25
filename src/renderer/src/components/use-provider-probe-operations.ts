import type {
  ModelProviderModelProfileV1,
  ModelProviderProfileV1
} from '@shared/app-settings'
import { modelProviderRequiresApiKey } from '@shared/app-settings-provider-core'
import type {
  AntigravitySubscriptionModelCatalog,
  ModelProviderProbeResult
} from '@shared/kun-gui-api'
import {
  type Dispatch,
  type SetStateAction
} from 'react'
import { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'
import {
  enrichCursorProviderModelProfiles,
  enrichProviderModelProfiles,
  mergeProviderModelIdsCaseInsensitive as mergeProviderModelIds
} from './provider-model-import'
import type { ProviderModelImportResult } from './provider-model-import-dialog'
import {
  CURSOR_SUBSCRIPTION_DISCOVERY_CHANNEL,
  addedModelCount,
  antigravityProviderCatalogPatch,
  cursorSubscriptionDiscoveryErrorMessage, defaultImageCapability, defaultMusicCapability,
  defaultSpeechCapability, defaultTextToSpeechCapability, defaultVideoCapability,
  isAgentSdkProvider,
  isCursorSubscriptionProvider,
  isGeminiCliApiSubscriptionProvider, isGeminiSubscriptionProvider,
  presetImageCapability, presetMusicCapability,
  presetSpeechCapability, presetTextToSpeechCapability, presetVideoCapability,
  providerConnectionFingerprint,
  type ProbeState
} from './settings-section-providers-profile'
import {
  MAX_SHARED_MODEL_CONNECTION_MODELS,
  requestSharedModelConnectionProbe,
  shouldUseSharedModelConnectionProbe
} from './settings-section-providers-shared-api'
import { flushProviderMutations } from './provider-mutation-flush'

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'







export function useProviderProbeOperations(scope: Record<string, any>): Record<string, any> {
  const { t, sharedConnectionFor, fetchModelsDevCatalogFor, openModelImport, flushSharedProviderCatalog, providerProxy } = scope
  const setProbeStates = scope.setProbeStates as Dispatch<SetStateAction<Record<string, ProbeState>>>
  const setCursorAccounts = scope.setCursorAccounts as Dispatch<SetStateAction<Record<string, {
    fingerprint: string
    label: string
    apiKeyName: string
  }>>>
  const patchProviderProfile = scope.patchProviderProfile as (
    item: ModelProviderProfileV1,
    transform: (item: ModelProviderProfileV1) => ModelProviderProfileV1
  ) => void
  const runProbe = async (target: ModelProviderProfileV1, mode: 'test' | 'fetch'): Promise<void> => {
    const fingerprint = providerConnectionFingerprint(target, providerProxy)
    if (isCursorSubscriptionProvider(target)) {
      const cursorCredentialReady =
        Boolean(target.apiKey.trim()) ||
        sharedModelConnectionHasUsableCredential(sharedConnectionFor(target.id))
      if (!cursorCredentialReady) {
        setProbeStates((previous) => ({
          ...previous,
          [target.id]: {
            fingerprint,
            mode,
            status: 'error',
            message: t('modelProviderPresetMissingKeyForProbe')
          }
        }))
        return
      }
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: { fingerprint, mode, status: 'busy' }
      }))
      try {
        const discover = window.kunGui?.cursorSubscriptionDiscover
        if (typeof discover !== 'function') {
          throw new Error(`No bridge registered for '${CURSOR_SUBSCRIPTION_DISCOVERY_CHANNEL}'`)
        }
        // apiKey may be redacted in the renderer; Main resolves Registry secrets via providerId.
        const discovery = await discover(target.apiKey.trim() || undefined, target.id)
        const accountName = [
          discovery.account.userFirstName,
          discovery.account.userLastName
        ].filter(Boolean).join(' ')
        setCursorAccounts((previous) => ({
          ...previous,
          [target.id]: {
            fingerprint,
            label: discovery.account.userEmail || accountName || discovery.account.apiKeyName,
            apiKeyName: discovery.account.apiKeyName
          }
        }))
        if (mode === 'fetch') {
          const modelIds = discovery.models.map((model) => model.id)
          const modelAliases = Object.fromEntries(
            discovery.models
              .filter((model) => model.aliases?.length)
              .map((model) => [model.id, [...(model.aliases ?? [])]])
          )
          openModelImport({
            target,
            fingerprint,
            providerModelIds: modelIds,
            modelAliases,
            catalogResult: await fetchModelsDevCatalogFor(target, discovery.models),
            providerError: modelIds.length === 0
              ? t('providerModelImportProviderReturnedEmpty')
              : undefined,
            latencyMs: 0,
            authoritative: true
          })
          return
        }
        setProbeStates((previous) => ({
          ...previous,
          [target.id]: {
            fingerprint,
            mode,
            status: 'ok',
            latencyMs: 0,
            total: discovery.models.length
          }
        }))
      } catch (error) {
        setProbeStates((previous) => ({
          ...previous,
          [target.id]: {
            fingerprint,
            mode,
            status: 'error',
            message: cursorSubscriptionDiscoveryErrorMessage(
              error,
              t('cursorSubscriptionRestartRequired')
            )
          }
        }))
      }
      return
    }
    // The official Antigravity CLI owns subscription auth and model discovery.
    if (isGeminiSubscriptionProvider(target)) {
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: { fingerprint, mode, status: 'busy' }
      }))
      const [providerResult, catalogResult] = await Promise.all([
        window.kunGui.geminiSubscriptionModels()
          .then((catalog) => ({
            catalog,
            error: undefined as string | undefined
          }))
          .catch((error: unknown) => ({
            catalog: { models: [] } satisfies AntigravitySubscriptionModelCatalog,
            error: error instanceof Error ? error.message : String(error)
          })),
        fetchModelsDevCatalogFor(target)
      ])
      const providerPatch = antigravityProviderCatalogPatch(
        providerResult.catalog,
        target.modelProfiles
      )
      if (mode === 'fetch') {
        openModelImport({
          target,
          fingerprint,
          providerModelIds: providerPatch.models,
          discoveredModelProfiles: providerPatch.modelProfiles,
          catalogResult,
          providerError: providerResult.error,
          latencyMs: 0,
          authoritative: true
        })
        return
      }
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: providerResult.error
          ? { fingerprint, mode, status: 'error', message: providerResult.error }
          : { fingerprint, mode, status: 'ok', latencyMs: 0, total: providerPatch.models.length }
      }))
      return
    }
    if (isGeminiCliApiSubscriptionProvider(target)) {
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: { fingerprint, mode, status: 'busy' }
      }))
      const [statusResult, modelResult, catalogResult] = await Promise.all([
        window.kunGui.geminiCliSubscriptionStatus()
          .catch(() => ({ installed: false, authenticated: false })),
        window.kunGui.geminiCliSubscriptionModels()
          .then((modelIds) => ({ modelIds, error: undefined as string | undefined }))
          .catch((error: unknown) => ({
            modelIds: [] as string[],
            error: error instanceof Error ? error.message : String(error)
          })),
        fetchModelsDevCatalogFor(target)
      ])
      const authError = statusResult.authenticated
        ? undefined
        : t('geminiCliApiLoginHint')
      if (mode === 'fetch') {
        openModelImport({
          target,
          fingerprint,
          providerModelIds: modelResult.modelIds,
          catalogResult,
          providerError: modelResult.error ?? authError,
          latencyMs: 0,
          authoritative: true
        })
        return
      }
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: statusResult.authenticated
          ? {
              fingerprint,
              mode,
              status: 'ok',
              latencyMs: 0,
              total: modelResult.modelIds.length
            }
          : {
              fingerprint,
              mode,
              status: 'error',
              message: authError
            }
      }))
      return
    }
    // Subscription (agent-sdk) providers have no HTTP /models endpoint. Model
    // enumeration remains a catalog operation, while Test makes a bounded real
    // request through the official Claude transport so a non-empty/revoked token
    // can never produce a false success state.
    if (isAgentSdkProvider(target)) {
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: { fingerprint, mode, status: 'busy' }
      }))
      if (mode === 'fetch') {
        const [providerResult, catalogResult] = await Promise.all([
          window.kunGui.claudeSubscriptionModels(target.apiKey.trim() || undefined, target.id)
            .then((modelIds) => ({ modelIds, error: undefined as string | undefined }))
            .catch((error: unknown) => ({
              modelIds: [] as string[],
              error: error instanceof Error ? error.message : String(error)
            })),
          fetchModelsDevCatalogFor(target)
        ])
        openModelImport({
          target,
          fingerprint,
          providerModelIds: [...providerResult.modelIds],
          catalogResult,
          providerError: providerResult.error
            ?? (providerResult.modelIds.length === 0 ? t('claudeSubProbeNotReady') : undefined),
          latencyMs: 0
        })
        return
      }
      const result = await window.kunGui.claudeSubscriptionProbe(
        target.apiKey.trim() || undefined,
        target.id
      ).catch((error: unknown) => ({
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }))
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: result.ok
          ? {
              fingerprint,
              mode,
              status: 'ok',
              latencyMs: result.latencyMs,
              total: target.models.length
            }
          : {
              fingerprint,
              mode,
              status: 'error',
              message: result.message === 'invalid-token-format'
                ? t('claudeSubTokenInvalid')
                : result.message === 'probe-timeout'
                  ? t('claudeSubProbeTimeout')
                  : result.message === 'claude-cli-not-found'
                    ? t('claudeSubLoginFailedCli')
                    : result.message || t('claudeSubProbeNotReady')
            }
      }))
      return
    }
    const sharedConnection = sharedConnectionFor(target.id)
    if (shouldUseSharedModelConnectionProbe(target, sharedConnection)) {
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: { fingerprint, mode, status: 'busy' }
      }))
      const startedAt = performance.now()
      try {
        // Probe must observe committed Registry credentials. A staged
        // credential/catalog mutation that has not drained yet would make the
        // main process probe with the previous key and report a false auth
        // failure, so wait for this provider's mutations first.
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
        const models = await requestSharedModelConnectionProbe(target.id)
        if (mode === 'fetch') {
          let catalogResult = await fetchModelsDevCatalogFor(target)
          // Unmapped custom/relay providers still get completion-only
          // metadata via model-family rules keyed off the discovered ids.
          if (catalogResult.status === 'unmapped' && models.length > 0) {
            catalogResult = await fetchModelsDevCatalogFor(
              target,
              models.map((id) => ({ id, displayName: id })),
              false
            )
          }
          openModelImport({
            target,
            fingerprint,
            providerModelIds: models,
            catalogResult,
            latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
            authoritative: true
          })
          return
        }
        setProbeStates((previous) => ({
          ...previous,
          [target.id]: {
            fingerprint,
            mode,
            status: 'ok',
            latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
            total: models.length
          }
        }))
      } catch (error) {
        setProbeStates((previous) => ({
          ...previous,
          [target.id]: {
            fingerprint,
            mode,
            status: 'error',
            message: error instanceof Error ? error.message : String(error)
          }
        }))
      }
      return
    }
    if (modelProviderRequiresApiKey(target) && !target.apiKey.trim()) {
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: {
          fingerprint,
          mode,
          status: 'error',
          message: t('modelProviderPresetMissingKeyForProbe')
        }
      }))
      return
    }
    if (typeof window.kunGui?.probeModelProvider !== 'function') return
    setProbeStates((previous) => ({
      ...previous,
      [target.id]: { fingerprint, mode, status: 'busy' }
    }))

    const probe = async (): Promise<ModelProviderProbeResult> => {
      try {
        return await window.kunGui.probeModelProvider({
          providerId: target.id,
          baseUrl: target.baseUrl,
          apiKey: target.apiKey,
          endpointFormat: target.endpointFormat,
          ...(target.endpoints ? { endpoints: target.endpoints } : {}),
          useProxy: target.useProxy
        })
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    }

    if (mode === 'fetch') {
      const [result, firstCatalogResult] = await Promise.all([
        probe(),
        fetchModelsDevCatalogFor(target)
      ])
      let catalogResult = firstCatalogResult
      // Unmapped custom/relay providers get a second pass with the
      // discovered model ids so family rules can attach catalog metadata.
      if (result.ok && catalogResult.status === 'unmapped' && result.modelIds.length > 0) {
        catalogResult = await fetchModelsDevCatalogFor(
          target,
          result.modelIds.map((id) => ({ id, displayName: id })),
          false
        )
      }
      if (!result.ok && result.suggestedProxyUrl) {
        setProbeStates((previous) => ({
          ...previous,
          [target.id]: {
            fingerprint,
            mode,
            status: 'error',
            message: result.message,
            suggestedProxyUrl: result.suggestedProxyUrl
          }
        }))
        return
      }
      openModelImport({
        target,
        fingerprint,
        providerModelIds: result.ok ? [...result.modelIds] : [],
        discoveredModelProfiles: result.ok ? result.modelProfiles : undefined,
        catalogResult,
        providerError: result.ok
          ? (result.modelIds.length === 0 ? t('providerModelImportProviderReturnedEmpty') : undefined)
          : result.message,
        latencyMs: result.ok ? result.latencyMs : 0
      })
      return
    }

    const result = await probe()
    if (!result.ok) {
      setProbeStates((previous) => ({
        ...previous,
        [target.id]: {
          fingerprint,
          mode,
          status: 'error',
          message: result.message,
          suggestedProxyUrl: result.suggestedProxyUrl
        }
      }))
      return
    }
    setProbeStates((previous) => ({
      ...previous,
      [target.id]: {
        fingerprint,
        mode,
        status: 'ok',
        latencyMs: result.latencyMs,
        total: result.modelIds.length
      }
    }))
  }

  const importPickedModels = async (
    target: ModelProviderProfileV1,
    picked: ProviderModelImportResult,
    authoritative = false,
    modelAliases: Readonly<Record<string, readonly string[]>> = {},
    discoveredModelProfiles: Readonly<Record<string, ModelProviderModelProfileV1>> = {}
  ): Promise<number> => {
    const merged = applyProviderModelImport(target, picked, authoritative, modelAliases, discoveredModelProfiles)
    if (
      sharedConnectionFor(target.id) &&
      merged.models.length > MAX_SHARED_MODEL_CONNECTION_MODELS
    ) {
      throw new Error(t('providerModelImportSharedLimit', {
        count: merged.models.length,
        max: MAX_SHARED_MODEL_CONNECTION_MODELS
      }))
    }
    const added =
      addedModelCount(target.models, merged.models)
      + addedModelCount(target.image?.models ?? [], merged.image?.models ?? [])
      + addedModelCount(target.speech?.models ?? [], merged.speech?.models ?? [])
      + addedModelCount(target.textToSpeech?.models ?? [], merged.textToSpeech?.models ?? [])
      + addedModelCount(target.music?.models ?? [], merged.music?.models ?? [])
      + addedModelCount(target.video?.models ?? [], merged.video?.models ?? [])
    if (authoritative || added > 0 || merged.modelProfiles !== target.modelProfiles) {
      patchProviderProfile(target, () => merged)
    }
    if (sharedConnectionFor(target.id)) await flushSharedProviderCatalog(target.id)
    setProbeStates((prev) => {
      const previous = prev[target.id]
      if (!previous) return prev
      return {
        ...prev,
        [target.id]: { ...previous, total: added }
      }
    })
    return added
  }

  return { runProbe, importPickedModels }
}

/** Merge an import selection into a provider profile without touching state. */
export function applyProviderModelImport(
  target: ModelProviderProfileV1,
  picked: ProviderModelImportResult,
  authoritative = false,
  modelAliases: Readonly<Record<string, readonly string[]>> = {},
  discoveredModelProfiles: Readonly<Record<string, ModelProviderModelProfileV1>> = {}
): ModelProviderProfileV1 {
  const nextChatModels = authoritative
    ? [...picked.chat]
    : mergeProviderModelIds(target.models, picked.chat)
  const nextImageModels = target.image
    ? mergeProviderModelIds(target.image.models, picked.image)
    : picked.image
  const nextSpeechModels = target.speech
    ? mergeProviderModelIds(target.speech.models, picked.speech)
    : picked.speech
  const nextTextToSpeechModels = target.textToSpeech
    ? mergeProviderModelIds(target.textToSpeech.models, picked.tts)
    : picked.tts
  const nextMusicModels = target.music
    ? mergeProviderModelIds(target.music.models, picked.music)
    : picked.music
  const nextVideoModels = target.video
    ? mergeProviderModelIds(target.video.models, picked.video)
    : picked.video
  const enrichedModelProfiles = isCursorSubscriptionProvider(target)
    ? enrichCursorProviderModelProfiles(
        target,
        nextChatModels,
        picked.catalogModels,
        modelAliases
      )
    : enrichProviderModelProfiles(
        target,
        nextChatModels,
        picked.catalogModels,
        modelAliases
      )
  const nextModelProfiles = Object.keys(discoveredModelProfiles).length > 0
    ? Object.fromEntries(nextChatModels.flatMap((modelId) => {
        const profile = mergeDiscoveredModelProfile(
          enrichedModelProfiles[modelId],
          discoveredModelProfiles[modelId]
        )
        return profile ? [[modelId, profile]] : []
      }))
    : enrichedModelProfiles
  return {
    ...target,
    models: nextChatModels,
    modelProfiles: nextModelProfiles,
    ...(nextImageModels.length > 0
      ? { image: { ...(target.image ?? presetImageCapability(target) ?? defaultImageCapability(target.baseUrl)), models: nextImageModels } }
      : {}),
    ...(nextSpeechModels.length > 0
      ? { speech: { ...(target.speech ?? presetSpeechCapability(target) ?? defaultSpeechCapability(target.baseUrl)), models: nextSpeechModels } }
      : {}),
    ...(nextTextToSpeechModels.length > 0
      ? { textToSpeech: { ...(target.textToSpeech ?? presetTextToSpeechCapability(target) ?? defaultTextToSpeechCapability(target.baseUrl)), models: nextTextToSpeechModels } }
      : {}),
    ...(nextMusicModels.length > 0
      ? { music: { ...(target.music ?? presetMusicCapability(target) ?? defaultMusicCapability(target.baseUrl)), models: nextMusicModels } }
      : {}),
    ...(nextVideoModels.length > 0
      ? { video: { ...(target.video ?? presetVideoCapability(target) ?? defaultVideoCapability(target.baseUrl)), models: nextVideoModels } }
      : {})
  }
}

/**
 * A successful live catalog import is authoritative for the models it returns:
 * its service-tier declaration replaces the stored one — including an empty
 * array — and an absent declaration clears a stale stored value instead of
 * surviving through object spread.
 */
export function mergeDiscoveredModelProfile(
  enriched: ModelProviderModelProfileV1 | undefined,
  discovered: ModelProviderModelProfileV1 | undefined
): ModelProviderModelProfileV1 | undefined {
  if (!discovered) return enriched
  const merged: ModelProviderModelProfileV1 = { ...enriched, ...discovered }
  if (discovered.serviceTiers) merged.serviceTiers = [...discovered.serviceTiers]
  else delete merged.serviceTiers
  return merged
}
