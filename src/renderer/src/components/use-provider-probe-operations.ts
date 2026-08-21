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

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'







export function useProviderProbeOperations(scope: Record<string, any>): Record<string, any> {
  const { t, sharedConnectionFor, fetchModelsDevCatalogFor, openModelImport, flushSharedProviderCatalog } = scope
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
    const fingerprint = providerConnectionFingerprint(target)
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
        const models = await requestSharedModelConnectionProbe(target.id)
        if (mode === 'fetch') {
          openModelImport({
            target,
            fingerprint,
            providerModelIds: models,
            catalogResult: await fetchModelsDevCatalogFor(target),
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
          baseUrl: target.baseUrl,
          apiKey: target.apiKey,
          endpointFormat: target.endpointFormat
        })
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    }

    if (mode === 'fetch') {
      const [result, catalogResult] = await Promise.all([
        probe(),
        fetchModelsDevCatalogFor(target)
      ])
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
    const nextChatModels = authoritative
      ? [...picked.chat]
      : mergeProviderModelIds(target.models, picked.chat)
    if (
      sharedConnectionFor(target.id) &&
      nextChatModels.length > MAX_SHARED_MODEL_CONNECTION_MODELS
    ) {
      throw new Error(t('providerModelImportSharedLimit', {
        count: nextChatModels.length,
        max: MAX_SHARED_MODEL_CONNECTION_MODELS
      }))
    }
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
          const discoveredProfile = discoveredModelProfiles[modelId]
          const enrichedProfile = enrichedModelProfiles[modelId]
          const profile = discoveredProfile
            ? { ...enrichedProfile, ...discoveredProfile }
            : enrichedProfile
          return profile ? [[modelId, profile]] : []
        }))
      : enrichedModelProfiles
    const added =
      addedModelCount(target.models, nextChatModels)
      + addedModelCount(target.image?.models ?? [], nextImageModels)
      + addedModelCount(target.speech?.models ?? [], nextSpeechModels)
      + addedModelCount(target.textToSpeech?.models ?? [], nextTextToSpeechModels)
      + addedModelCount(target.music?.models ?? [], nextMusicModels)
      + addedModelCount(target.video?.models ?? [], nextVideoModels)
    if (authoritative || added > 0 || nextModelProfiles !== target.modelProfiles) {
      patchProviderProfile(target, (item) => ({
        ...item,
        models: nextChatModels,
        modelProfiles: nextModelProfiles,
        ...(nextImageModels.length > 0
          ? { image: { ...(item.image ?? presetImageCapability(item) ?? defaultImageCapability(item.baseUrl)), models: nextImageModels } }
          : {}),
        ...(nextSpeechModels.length > 0
          ? { speech: { ...(item.speech ?? presetSpeechCapability(item) ?? defaultSpeechCapability(item.baseUrl)), models: nextSpeechModels } }
          : {}),
        ...(nextTextToSpeechModels.length > 0
          ? { textToSpeech: { ...(item.textToSpeech ?? presetTextToSpeechCapability(item) ?? defaultTextToSpeechCapability(item.baseUrl)), models: nextTextToSpeechModels } }
          : {}),
        ...(nextMusicModels.length > 0
          ? { music: { ...(item.music ?? presetMusicCapability(item) ?? defaultMusicCapability(item.baseUrl)), models: nextMusicModels } }
          : {}),
        ...(nextVideoModels.length > 0
          ? { video: { ...(item.video ?? presetVideoCapability(item) ?? defaultVideoCapability(item.baseUrl)), models: nextVideoModels } }
          : {})
      }))
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
