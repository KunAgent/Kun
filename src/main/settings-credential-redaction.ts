import {
  getKunRuntimeSettings,
  type AppSettingsPatch,
  type AppSettingsV1
} from '../shared/app-settings'

/**
 * Renderer settings projections intentionally redact all API secrets to `''`.
 * Empty fields must not be treated as "user cleared the API key" during
 * `settings:set`, or protected credential bindings would be wiped.
 */
export function preserveRedactedProviderCredentials(
  prev: AppSettingsV1,
  partial: AppSettingsPatch
): AppSettingsPatch {
  let next = partial
  const previousProviders = Array.isArray(prev.provider?.providers) ? prev.provider.providers : []
  const previousTopLevelApiKey =
    typeof prev.provider?.apiKey === 'string' ? prev.provider.apiKey : ''
  const previousById = new Map(
    previousProviders.map((provider) => [provider.id, provider])
  )

  if (Array.isArray(partial.provider?.providers)) {
    const providers = partial.provider.providers.map((provider) => {
      if (!provider || typeof provider.id !== 'string') return provider
      const previous = previousById.get(provider.id)
      if (!previous?.apiKey.trim()) return provider
      if (typeof provider.apiKey !== 'string') return provider
      if (provider.apiKey.trim()) return provider
      return { ...provider, apiKey: previous.apiKey }
    })
    const topLevelApiKey =
      typeof partial.provider.apiKey === 'string' &&
      !partial.provider.apiKey.trim() &&
      previousTopLevelApiKey.trim()
        ? previousTopLevelApiKey
        : partial.provider.apiKey
    next = {
      ...next,
      provider: {
        ...partial.provider,
        ...(topLevelApiKey !== undefined ? { apiKey: topLevelApiKey } : {}),
        providers
      }
    }
  } else if (
    typeof partial.provider?.apiKey === 'string' &&
    !partial.provider.apiKey.trim() &&
    previousTopLevelApiKey.trim()
  ) {
    next = {
      ...next,
      provider: {
        ...partial.provider,
        apiKey: previousTopLevelApiKey
      }
    }
  }

  const previousKun = getKunRuntimeSettings(prev)
  const incomingKun = next.agents?.kun
  if (incomingKun) {
    const media = ['imageGeneration', 'speechToText', 'textToSpeech', 'musicGeneration', 'videoGeneration'] as const
    const preservedMedia = Object.fromEntries(media.map((service) => {
      const incoming = incomingKun[service]
      const previous = previousKun[service]
      const incomingApiKey = typeof incoming?.apiKey === 'string' ? incoming.apiKey : ''
      return [service, incoming && !incomingApiKey.trim() && previous.apiKey.trim()
        ? { ...incoming, apiKey: previous.apiKey }
        : incoming]
    }))
    const apiKey = typeof incomingKun.apiKey === 'string' &&
      !incomingKun.apiKey.trim() && previousKun.apiKey.trim()
      ? previousKun.apiKey
      : incomingKun.apiKey
    next = {
      ...next,
      agents: {
        ...next.agents,
        kun: { ...incomingKun, ...(apiKey !== undefined ? { apiKey } : {}), ...preservedMedia }
      }
    }
  }

  return next
}
