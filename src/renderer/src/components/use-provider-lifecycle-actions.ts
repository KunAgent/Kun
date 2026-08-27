import type {
  ModelProviderModelProfileV1,
  ModelProviderPresetMode,
  ModelProviderProfileV1
} from '@shared/app-settings'
import {
  DEFAULT_MODEL_PROVIDER_ID,
  OPENCODE_FREE_PROVIDER_ID,
  defaultModelRequestRetrySettings,
  isMultiAccountProviderPreset,
  modelProviderPresetAccountProfile,
  modelProviderPresetProfile,
  modelProviderTokenPlanProfile,
  normalizeModelProviderId,
  resolveModelProviderPresetSource,
  tokenPlanProviderId
} from '@shared/app-settings'
import type {
  CursorSubscriptionModel,
  ModelsDevCatalogResult
} from '@shared/kun-gui-api'
import type {
  ModelProviderPreset
} from '@shared/model-provider-presets'
import {
  useEffect,
  useRef
} from 'react'
import {
  enrichCursorProviderModelProfiles,
  mergeProviderModelIdsCaseInsensitive as mergeProviderModelIds
} from './provider-model-import'
import {
  cursorProviderNeedsMetadataRepair,
  kunProviderSelectionPatch,
  nonEmptyModelId,
  type ProbeState
} from './settings-section-providers-profile'
import {
  deleteSharedModelConnection
} from './settings-section-providers-shared-api'
import {
  clearPendingSharedProviderDeletionForExplicitAdd,
  connectOrReplaceSharedModelConnectionCredential
} from './settings-section-providers-shared-reconcile'
import {
  drainSharedProviderCredentialMutation,
  sharedProviderMutationCoordinator,
  stageSharedProviderCredentialMutation
} from './shared-provider-mutation-coordinator'

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'







function isOpenCodeFreeProvider(provider: ModelProviderProfileV1): boolean {
  return resolveModelProviderPresetSource(provider)?.preset.id === OPENCODE_FREE_PROVIDER_ID
}

export function catalogResultForProviderImport(
  provider: ModelProviderProfileV1,
  catalogResult: ModelsDevCatalogResult
): ModelsDevCatalogResult {
  return isOpenCodeFreeProvider(provider) && catalogResult.status === 'ok'
    ? { ...catalogResult, models: catalogResult.models.filter((model) => model.free === true) }
    : catalogResult
}

export function useProviderLifecycleActions(scope: Record<string, any>): Record<string, any> {
  const { t, form, kun, provider, setSharedConnections, setSharedConnectionsError, pendingSharedProviderDeletions, pendingSharedProviderNames, pendingSharedProviderCatalogs, pendingSharedProviderCredentials, catalogMutationTimers, credentialMutationTimers, mounted, setCredentialDrafts, enqueueSharedMutation, selectedProviderId, setSelectedProviderId, activeTab, setActiveTab, previousProviderSelectionRef, setProbeStates, setPendingImport, cursorMetadataRepairAttempts, setDraftProvider, activeKunProviderId, confirmAction, updateModelProviders } = scope
  const modelProviders = scope.modelProviders as ModelProviderProfileV1[]
  const displayProviders = scope.displayProviders as ModelProviderProfileV1[]
  const draftProvider = scope.draftProvider as ModelProviderProfileV1 | null
  const activeProvider = scope.activeProvider as ModelProviderProfileV1 | undefined
  const patchProviderProfile = scope.patchProviderProfile as (
    item: ModelProviderProfileV1,
    transform: (item: ModelProviderProfileV1) => ModelProviderProfileV1
  ) => void
  const updateModelProviderId = (id: string, value: string): void => {
    if (!draftProvider || id !== draftProvider.id || id === DEFAULT_MODEL_PROVIDER_ID) return
    const nextId = normalizeModelProviderId(value)
    if (!nextId || nextId === id) return
    if (displayProviders.some((item) => item.id === nextId && item.id !== id)) return
    setSelectedProviderId(nextId)
    setDraftProvider({ ...draftProvider, id: nextId })
  }

  const startProviderDraft = (profile: ModelProviderProfileV1): void => {
    previousProviderSelectionRef.current = selectedProviderId
    setDraftProvider(profile)
    setSelectedProviderId(profile.id)
    setActiveTab('connection')
  }

  const commitProviderDraft = async (): Promise<void> => {
    if (!draftProvider) return
    const providerDraft = draftProvider
    const credential = providerDraft.apiKey.trim()
    clearPendingSharedProviderDeletionForExplicitAdd(
      pendingSharedProviderDeletions.current,
      providerDraft.id
    )
    if (credential) {
      const pending = stageSharedProviderCredentialMutation(providerDraft.id, credential)
      try {
        const committed = await drainSharedProviderCredentialMutation(
          providerDraft.id,
          pending.generation,
          (currentCredential) => connectOrReplaceSharedModelConnectionCredential(
            providerDraft,
            currentCredential,
            (providerId) => pendingSharedProviderDeletions.current.has(providerId)
          )
        )
        if (!committed) return
        if (mounted.current) {
          setSharedConnections(committed.value)
          setSharedConnectionsError('')
        }
      } catch (error) {
        if (mounted.current) {
          setSharedConnectionsError(error instanceof Error ? error.message : String(error))
        }
        return
      }
    }
    const secretFreeProvider = { ...providerDraft, apiKey: '' }
    updateModelProviders(
      [...modelProviders, secretFreeProvider],
      credential
        ? kunProviderSelectionPatch({
            providerId: providerDraft.id,
            model: nonEmptyModelId(providerDraft.models[0]) ?? kun.model
          })
        : undefined
    )
    previousProviderSelectionRef.current = null
    setDraftProvider(null)
    setSelectedProviderId(providerDraft.id)
  }

  const cancelProviderDraft = (): void => {
    if (!draftProvider) return
    const previousProviderId = previousProviderSelectionRef.current
    const fallbackProviderId = modelProviders.some((item) => item.id === activeKunProviderId)
      ? activeKunProviderId
      : modelProviders[0]?.id ?? DEFAULT_MODEL_PROVIDER_ID
    setDraftProvider(null)
    setSelectedProviderId(
      previousProviderId && modelProviders.some((item) => item.id === previousProviderId)
        ? previousProviderId
        : fallbackProviderId
    )
    previousProviderSelectionRef.current = null
  }

  const addModelProvider = (): void => {
    const baseId = 'custom-provider'
    let index = modelProviders.length + 1
    let id = `${baseId}-${index}`
    const used = new Set(displayProviders.map((item) => item.id))
    while (used.has(id)) {
      index += 1
      id = `${baseId}-${index}`
    }
    startProviderDraft({
      id,
      name: t('modelProviderNewName', { index }),
      apiKey: '',
      baseUrl: 'https://api.example.com/v1',
      endpointFormat: 'chat_completions',
      retry: defaultModelRequestRetrySettings(),
      models: [],
      modelProfiles: {}
    })
  }

  const addPresetModelProvider = async (
    preset: ModelProviderPreset,
    mode: ModelProviderPresetMode = 'api'
  ): Promise<void> => {
    if (isMultiAccountProviderPreset(preset, mode)) {
      const accountProvider = modelProviderPresetAccountProfile(preset, mode, displayProviders)
      if (accountProvider) startProviderDraft(accountProvider)
      return
    }
    const presetProvider = mode === 'token-plan'
      ? modelProviderTokenPlanProfile(preset)
      : modelProviderPresetProfile(preset)
    if (!presetProvider) return
    const existingProvider = modelProviders.find((item) => item.id === presetProvider.id)
    if (existingProvider) {
      const confirmed = await confirmAction({
        message: t('modelProviderUpdatePresetTitle', { name: presetProvider.name }),
        detail: t('modelProviderUpdatePresetDetail'),
        confirmLabel: t('modelProviderUpdatePresetAction'),
        cancelLabel: t('modelProviderCancel')
      })
      if (!confirmed) {
        setSelectedProviderId(presetProvider.id)
        return
      }
    }
    if (!existingProvider) {
      startProviderDraft(presetProvider)
      return
    }
    const nextProvider: ModelProviderProfileV1 = {
      ...presetProvider,
      name: existingProvider.name.trim() || presetProvider.name,
      apiKey: existingProvider.apiKey,
      models: mergeProviderModelIds(presetProvider.models, existingProvider.models),
      modelProfiles: {
        ...existingProvider.modelProfiles,
        ...presetProvider.modelProfiles
      },
      image: presetProvider.image ?? existingProvider.image,
      speech: presetProvider.speech ?? existingProvider.speech,
      textToSpeech: presetProvider.textToSpeech ?? existingProvider.textToSpeech,
      music: presetProvider.music ?? existingProvider.music,
      video: presetProvider.video ?? existingProvider.video
    }
    const nextProviders = modelProviders.map((item) => item.id === presetProvider.id ? nextProvider : item)
    setSelectedProviderId(nextProvider.id)
    updateModelProviders(
      nextProviders,
      nextProvider.apiKey.trim()
        ? kunProviderSelectionPatch({
            providerId: nextProvider.id,
            model: nonEmptyModelId(nextProvider.models[0]) ?? kun.model
          })
        : undefined
    )
  }

  const removeModelProvider = async (id: string): Promise<void> => {
    // The bundled default providers are always available fallbacks. Keeping
    // both prevents users from losing their no-key model path.
    if (id === DEFAULT_MODEL_PROVIDER_ID || id === OPENCODE_FREE_PROVIDER_ID) return
    const target = modelProviders.find((item) => item.id === id)
    if (!target) return
    const usedByChat = activeKunProviderId === id
    const usedByImage = (kun.imageGeneration?.providerId ?? '').trim() === id
    const usedBySpeech = (kun.speechToText?.providerId ?? '').trim() === id
    const usedByTextToSpeech = (kun.textToSpeech?.providerId ?? '').trim() === id
    const usedByMusic = (kun.musicGeneration?.providerId ?? '').trim() === id
    const usedByVideo = (kun.videoGeneration?.providerId ?? '').trim() === id
    const writeInline = form?.write?.inlineCompletion
    const usedByWrite = Boolean(
      writeInline && !writeInline.inheritProvider && writeInline.providerId === id
    )
    const references = [
      ...(usedByChat ? [t('modelProviderDeleteInUseChat')] : []),
      ...(usedByImage ? [t('modelProviderDeleteInUseImage')] : []),
      ...(usedBySpeech ? [t('modelProviderDeleteInUseSpeech')] : []),
      ...(usedByTextToSpeech ? [t('modelProviderDeleteInUseTextToSpeech')] : []),
      ...(usedByMusic ? [t('modelProviderDeleteInUseMusic')] : []),
      ...(usedByVideo ? [t('modelProviderDeleteInUseVideo')] : []),
      ...(usedByWrite ? [t('modelProviderDeleteInUseWrite')] : [])
    ]
    const confirmed = await confirmAction({
      message: t('modelProviderDeleteConfirmTitle', { name: target.name.trim() || target.id }),
      detail: [t('modelProviderDeleteConfirmDetail'), ...references].join('\n'),
      confirmLabel: t('modelProviderDeleteAction'),
      cancelLabel: t('modelProviderCancel')
    })
    if (!confirmed) return
    const generation = sharedProviderMutationCoordinator.deletionGeneration + 1
    sharedProviderMutationCoordinator.deletionGeneration = generation
    pendingSharedProviderDeletions.current.set(id, { generation, committedRevision: null })
    try {
      const snapshot = await enqueueSharedMutation(() => deleteSharedModelConnection(id))
      const currentDeletion = pendingSharedProviderDeletions.current.get(id)
      if (currentDeletion?.generation !== generation) return
      pendingSharedProviderDeletions.current.set(id, {
        generation,
        committedRevision: snapshot.revision
      })
      pendingSharedProviderNames.current.delete(id)
      pendingSharedProviderCatalogs.current.delete(id)
      pendingSharedProviderCredentials.current.delete(id)
      const catalogTimer = catalogMutationTimers.current.get(id)
      if (catalogTimer) clearTimeout(catalogTimer.timer)
      catalogMutationTimers.current.delete(id)
      const credentialTimer = credentialMutationTimers.current.get(id)
      if (credentialTimer) clearTimeout(credentialTimer.timer)
      credentialMutationTimers.current.delete(id)
      if (mounted.current) {
        setCredentialDrafts((previous: Record<string, string>) => {
          if (!Object.prototype.hasOwnProperty.call(previous, id)) return previous
          const next = { ...previous }
          delete next[id]
          return next
        })
        setSharedConnections(snapshot)
        setSharedConnectionsError('')
      }
    } catch (error) {
      if (pendingSharedProviderDeletions.current.get(id)?.generation === generation) {
        pendingSharedProviderDeletions.current.delete(id)
      }
      if (mounted.current) {
        setSharedConnectionsError(error instanceof Error ? error.message : String(error))
      }
      return
    }
  }

  const fetchModelsDevCatalogFor = async (
    target: ModelProviderProfileV1,
    modelHints?: CursorSubscriptionModel[],
    forceRefresh = true
  ): Promise<ModelsDevCatalogResult> => {
    if (typeof window.kunGui?.fetchModelsDevCatalog !== 'function') {
      return { status: 'error', message: 'models.dev catalog bridge is unavailable.', models: [] }
    }
    try {
      const source = resolveModelProviderPresetSource(target)
      return await window.kunGui.fetchModelsDevCatalog({
        // Multi-account profiles keep a unique runtime id, while catalog
        // matching must use the canonical preset id understood by models.dev.
        providerId: source
          ? source.mode === 'token-plan'
            ? tokenPlanProviderId(source.preset.id)
            : source.preset.id
          : target.id,
        baseUrl: target.baseUrl,
        forceRefresh,
        ...(modelHints?.length
          ? {
              modelHints: modelHints.map((model) => ({
                id: model.id,
                ...(model.aliases?.length ? { aliases: model.aliases } : {})
              }))
            }
          : {})
      })
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        models: []
      }
    }
  }

  const patchProviderProfileRef = useRef(patchProviderProfile)
  patchProviderProfileRef.current = patchProviderProfile
  const fetchModelsDevCatalogForRef = useRef(fetchModelsDevCatalogFor)
  fetchModelsDevCatalogForRef.current = fetchModelsDevCatalogFor

  useEffect(() => {
    if (
      activeTab !== 'models'
      || !activeProvider
      || !cursorProviderNeedsMetadataRepair(activeProvider)
    ) return

    const repairKey = [
      activeProvider.id,
      ...activeProvider.models.map((model) => model.trim().toLowerCase()).filter(Boolean)
    ].join('\u0001')
    if (cursorMetadataRepairAttempts.current.has(repairKey)) return
    cursorMetadataRepairAttempts.current.add(repairKey)

    void fetchModelsDevCatalogForRef.current(
      activeProvider,
      activeProvider.models.map((model) => ({
        id: model,
        displayName: model
      })),
      false
    ).then((catalogResult) => {
      if (catalogResult.status !== 'ok' || catalogResult.models.length === 0) return
      patchProviderProfileRef.current(activeProvider, (item) => {
        const modelProfiles = enrichCursorProviderModelProfiles(
          item,
          item.models,
          catalogResult.models
        )
        return modelProfiles === item.modelProfiles
          ? item
          : { ...item, modelProfiles }
      })
    })
  }, [activeProvider, activeTab])

  const openModelImport = (input: {
    target: ModelProviderProfileV1
    fingerprint: string
    providerModelIds: string[]
    modelAliases?: Record<string, string[]>
    discoveredModelProfiles?: Record<string, ModelProviderModelProfileV1>
    catalogResult: ModelsDevCatalogResult
    providerError?: string
    latencyMs?: number
    authoritative?: boolean
  }): void => {
    const catalogResult = catalogResultForProviderImport(input.target, input.catalogResult)
    const catalogOnlyIds = catalogResult.status === 'ok' && catalogResult.matchMode === 'catalog'
      ? catalogResult.models.map((model) => model.id)
      : []
    const providerModelIds = isOpenCodeFreeProvider(input.target)
      ? input.providerModelIds.filter((modelId) => catalogOnlyIds.some((id) => id.toLowerCase() === modelId.toLowerCase()))
      : input.providerModelIds
    const total = mergeProviderModelIds(providerModelIds, catalogOnlyIds).length
    const hasUsableEntries = providerModelIds.length > 0 || catalogOnlyIds.length > 0
    if (!hasUsableEntries) {
      const catalogMessage = catalogResult.status === 'error'
        ? catalogResult.message
        : catalogResult.status === 'unmapped'
          ? t('providerModelImportCatalogUnmapped')
          : t('modelProviderFetchEmpty')
      const message = [input.providerError, catalogMessage].filter(Boolean).join(' · ')
      setProbeStates((previous: Record<string, ProbeState>) => ({
        ...previous,
        [input.target.id]: {
          fingerprint: input.fingerprint,
          mode: 'fetch',
          status: 'error',
          message: message || t('modelProviderFetchEmpty')
        }
      }))
      return
    }

    setProbeStates((previous: Record<string, ProbeState>) => ({
      ...previous,
      [input.target.id]: {
        fingerprint: input.fingerprint,
        mode: 'fetch',
        status: 'ok',
        latencyMs: input.latencyMs ?? 0,
        total
      }
    }))
    setPendingImport({
      providerId: input.target.id,
      providerModelIds,
      ...(input.modelAliases ? { modelAliases: input.modelAliases } : {}),
      ...(input.discoveredModelProfiles
        ? { discoveredModelProfiles: input.discoveredModelProfiles }
        : {}),
      catalogResult,
      ...(input.providerError ? { providerError: input.providerError } : {}),
      ...(input.authoritative ? { authoritative: true } : {})
    })
  }
  return { updateModelProviderId, commitProviderDraft, cancelProviderDraft, addModelProvider, addPresetModelProvider, removeModelProvider, fetchModelsDevCatalogFor, openModelImport }
}
