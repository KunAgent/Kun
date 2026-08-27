import type {
  ModelProviderImageCapabilityV1,
  ModelProviderMusicCapabilityV1,
  ModelProviderProfileV1,
  ModelProviderSpeechCapabilityV1,
  ModelProviderTextToSpeechCapabilityV1,
  ModelProviderVideoCapabilityV1
} from '@shared/app-settings'
import { sharedProviderMutationCoordinator } from './shared-provider-mutation-coordinator'
import { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'
import {
  defaultImageCapability, defaultMusicCapability,
  defaultSpeechCapability, defaultTextToSpeechCapability, defaultVideoCapability
} from './settings-section-providers-profile'

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'







export function useProviderProfileMutations(scope: Record<string, any>): Record<string, any> {
  const { showApiKey, setShowApiKey, zh, pendingSharedProviderNames, mounted, setRevealedCredential, setCredentialRevealPendingProviderId, setCredentialRevealError, credentialRevealGeneration, setDraftProvider, activeProviderIdRef, sharedConnectionFor, updateModelProviders, stageSharedProviderCatalog, stageSharedProviderCredential } = scope
  const modelProviders = scope.modelProviders as ModelProviderProfileV1[]
  const displayProviders = scope.displayProviders as ModelProviderProfileV1[]
  const draftProvider = scope.draftProvider as ModelProviderProfileV1 | null
  const activeProvider = scope.activeProvider as ModelProviderProfileV1 | undefined
  const patchProviderProfile = (
    item: ModelProviderProfileV1,
    transform: (item: ModelProviderProfileV1) => ModelProviderProfileV1,
    apiKeyOverride?: string
  ): void => {
    if (draftProvider && item.id === draftProvider.id) {
      setDraftProvider(transform(draftProvider))
      return
    }
    const canonical = modelProviders.find((existing) => existing.id === item.id)
    if (!canonical) return
    const transformed = transform(item)
    stageSharedProviderCatalog(item, transformed)
    updateModelProviders(modelProviders.map((existing) => existing.id === item.id
      ? { ...transformed, apiKey: apiKeyOverride ?? canonical.apiKey }
      : existing))
  }

  const updateModelProvider = (id: string, patch: Partial<ModelProviderProfileV1>): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    let settingsPatch = patch
    const hasCredentialPatch = Object.prototype.hasOwnProperty.call(patch, 'apiKey')
    const nextCredential = patch.apiKey ?? ''
    const explicitlyClearsProtectedCredential = nextCredential === '' &&
      sharedConnectionFor(id)?.configured === true
    if (
      !draftProvider &&
      hasCredentialPatch &&
      (nextCredential !== target.apiKey || explicitlyClearsProtectedCredential)
    ) {
      stageSharedProviderCredential(id, nextCredential)
      const { apiKey: _apiKey, ...withoutCredential } = patch
      settingsPatch = nextCredential === ''
        ? { ...withoutCredential, apiKey: '' }
        : withoutCredential
    }
    const nextProvider = { ...target, ...settingsPatch }
    if (
      !draftProvider &&
      (
        nextProvider.name !== target.name ||
        nextProvider.baseUrl !== target.baseUrl ||
        nextProvider.endpointFormat !== target.endpointFormat
      )
    ) {
      const generation = sharedProviderMutationCoordinator.profileGeneration + 1
      sharedProviderMutationCoordinator.profileGeneration = generation
      pendingSharedProviderNames.current.set(id, {
        generation,
        localName: nextProvider.name,
        canonicalName: nextProvider.name.trim() || id,
        localBaseUrl: nextProvider.baseUrl,
        localEndpointFormat: nextProvider.endpointFormat,
        committedRevision: null
      })
    }
    if (Object.keys(settingsPatch).length > 0) {
      patchProviderProfile(
        target,
        (item) => ({ ...item, ...settingsPatch }),
        hasCredentialPatch && nextCredential === '' ? '' : undefined
      )
    }
  }

  const updateActiveProviderCredential = (value: string): void => {
    if (!activeProvider) return
    setCredentialRevealError('')
    if (showApiKey) {
      setRevealedCredential({ providerId: activeProvider.id, credential: value })
    }
    updateModelProvider(activeProvider.id, { apiKey: value })
  }

  const toggleActiveProviderCredentialVisibility = async (): Promise<void> => {
    if (!activeProvider) return
    const providerId = activeProvider.id
    if (showApiKey) {
      credentialRevealGeneration.current += 1
      setShowApiKey(false)
      setRevealedCredential(null)
      setCredentialRevealError('')
      return
    }

    setCredentialRevealError('')
    if (
      activeProvider.apiKey.length > 0 ||
      !sharedModelConnectionHasUsableCredential(sharedConnectionFor(providerId))
    ) {
      setShowApiKey(true)
      return
    }

    setCredentialRevealPendingProviderId(providerId)
    const generation = ++credentialRevealGeneration.current
    try {
      if (typeof window.kunGui?.revealModelProviderCredential !== 'function') {
        throw new Error('Provider credential reveal is unavailable')
      }
      const result = await window.kunGui.revealModelProviderCredential(providerId)
      if (
        !mounted.current ||
        activeProviderIdRef.current !== providerId ||
        credentialRevealGeneration.current !== generation
      ) return
      setRevealedCredential({ providerId, credential: result.credential })
      setShowApiKey(true)
    } catch {
      if (
        mounted.current &&
        activeProviderIdRef.current === providerId &&
        credentialRevealGeneration.current === generation
      ) {
        setCredentialRevealError(
          zh
            ? '无法显示已保存的凭据。请重试，或输入新值替换它。'
            : 'The saved credential could not be shown. Try again, or enter a new value to replace it.'
        )
      }
    } finally {
      if (
        mounted.current &&
        activeProviderIdRef.current === providerId &&
        credentialRevealGeneration.current === generation
      ) {
        setCredentialRevealPendingProviderId('')
      }
    }
  }

  const updateModelProviderImage = (id: string, patch: Partial<ModelProviderImageCapabilityV1>): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => ({
      ...item,
      image: {
        ...(item.image ?? defaultImageCapability(item.baseUrl)),
        ...patch
      }
    }))
  }

  const removeModelProviderImage = (id: string): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => {
      const { image: _image, ...rest } = item
      void _image
      return rest
    })
  }

  const updateModelProviderSpeech = (id: string, patch: Partial<ModelProviderSpeechCapabilityV1>): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => ({
      ...item,
      speech: {
        ...(item.speech ?? defaultSpeechCapability(item.baseUrl)),
        ...patch
      }
    }))
  }

  const removeModelProviderSpeech = (id: string): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => {
      const { speech: _speech, ...rest } = item
      void _speech
      return rest
    })
  }

  const updateModelProviderTextToSpeech = (id: string, patch: Partial<ModelProviderTextToSpeechCapabilityV1>): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => ({
      ...item,
      textToSpeech: {
        ...(item.textToSpeech ?? defaultTextToSpeechCapability(item.baseUrl)),
        ...patch
      }
    }))
  }

  const removeModelProviderTextToSpeech = (id: string): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => {
      const { textToSpeech: _textToSpeech, ...rest } = item
      void _textToSpeech
      return rest
    })
  }

  const updateModelProviderMusic = (id: string, patch: Partial<ModelProviderMusicCapabilityV1>): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => ({
      ...item,
      music: {
        ...(item.music ?? defaultMusicCapability(item.baseUrl)),
        ...patch
      }
    }))
  }

  const removeModelProviderMusic = (id: string): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => {
      const { music: _music, ...rest } = item
      void _music
      return rest
    })
  }

  const updateModelProviderVideo = (id: string, patch: Partial<ModelProviderVideoCapabilityV1>): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => ({
      ...item,
      video: {
        ...(item.video ?? defaultVideoCapability(item.baseUrl)),
        ...patch
      }
    }))
  }

  const removeModelProviderVideo = (id: string): void => {
    const target = displayProviders.find((item) => item.id === id)
    if (!target) return
    patchProviderProfile(target, (item) => {
      const { video: _video, ...rest } = item
      void _video
      return rest
    })
  }
  return { patchProviderProfile, updateModelProvider, updateActiveProviderCredential, toggleActiveProviderCredentialVisibility, updateModelProviderImage, removeModelProviderImage, updateModelProviderSpeech, removeModelProviderSpeech, updateModelProviderTextToSpeech, removeModelProviderTextToSpeech, updateModelProviderMusic, removeModelProviderMusic, updateModelProviderVideo, removeModelProviderVideo }
}
