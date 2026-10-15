import { KUN_MODEL_CONNECTIONS_PATH } from '@shared/kun-endpoints'
import { SETTINGS_CHANGED_EVENT } from '../lib/keyboard-shortcut-settings'
import { rendererRuntimeClient } from './runtime-client'

export type SharedDefaultModelSelection = {
  registryAvailable: boolean
  providerId?: string
  accountId?: string
  model?: string
  providers?: Array<{
    id: string
    accountId?: string
    configured: boolean
    models: string[]
  }>
}

/** A warm read is refreshed after this long while the user is still typing. */
const PREFETCH_REFRESH_MS = 5_000
/** And never trusted once it is older than this. */
const PREFETCH_MAX_AGE_MS = 15_000

let prefetched: { at: number; promise: Promise<SharedDefaultModelSelection> } | null = null
let invalidationInstalled = false

async function fetchSharedDefaultModelSelection(): Promise<SharedDefaultModelSelection> {
  const response = await rendererRuntimeClient.runtimeRequest(KUN_MODEL_CONNECTIONS_PATH, 'GET')
  if (!response.ok) return { registryAvailable: false }
  try {
    const value = JSON.parse(response.body) as {
      defaultProviderId?: unknown
      defaultAccountId?: unknown
      defaultModel?: unknown
      providers?: unknown
    }
    return {
      registryAvailable: true,
      ...(typeof value.defaultProviderId === 'string' && value.defaultProviderId.trim()
        ? { providerId: value.defaultProviderId.trim() }
        : {}),
      ...(typeof value.defaultAccountId === 'string' && value.defaultAccountId.trim()
        ? { accountId: value.defaultAccountId.trim() }
        : {}),
      ...(typeof value.defaultModel === 'string' && value.defaultModel.trim()
        ? { model: value.defaultModel.trim() }
        : {}),
      providers: Array.isArray(value.providers)
        ? value.providers.flatMap((entry) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
            const profile = entry as Record<string, unknown>
            if (typeof profile.id !== 'string' || !profile.id.trim()) return []
            return [{
              id: profile.id.trim(),
              ...(typeof profile.accountId === 'string' && profile.accountId.trim()
                ? { accountId: profile.accountId.trim() }
                : {}),
              configured: profile.configured === true,
              models: Array.isArray(profile.models)
                ? profile.models.filter((model): model is string =>
                    typeof model === 'string' && Boolean(model.trim()))
                : []
            }]
          })
        : []
    }
  } catch {
    return { registryAvailable: false }
  }
}

/**
 * Start reading the shared model connections ahead of a new-task send, so the
 * create-thread step does not wait a runtime round trip after Enter. Called
 * while the user types on the Code home; a settings change drops the read.
 */
export function prefetchSharedDefaultModelSelection(): void {
  if (typeof window === 'undefined') return
  if (!invalidationInstalled) {
    invalidationInstalled = true
    window.addEventListener(SETTINGS_CHANGED_EVENT, () => { prefetched = null })
  }
  if (prefetched && Date.now() - prefetched.at < PREFETCH_REFRESH_MS) return
  // A failed warm read is simply not used; the send then reads for itself.
  const promise = fetchSharedDefaultModelSelection().catch(() => ({ registryAvailable: false }))
  prefetched = { at: Date.now(), promise }
}

/** Shared default route for a new thread; consumes a fresh prefetch once. */
export async function sharedDefaultModelSelection(): Promise<SharedDefaultModelSelection> {
  const warm = prefetched
  prefetched = null
  if (warm && Date.now() - warm.at < PREFETCH_MAX_AGE_MS) {
    const selection = await warm.promise
    if (selection.registryAvailable) return selection
  }
  return fetchSharedDefaultModelSelection()
}
