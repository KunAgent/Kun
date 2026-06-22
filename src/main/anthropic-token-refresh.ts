import { getModelProviderSettings } from '../shared/app-settings-provider'
import type { AppSettingsPatch, AppSettingsV1, ModelProviderProfileV1 } from '../shared/app-settings-types'
import {
  encodeAnthropicCredentials,
  isAnthropicOAuthCredentials,
  parseAnthropicCredentials,
  refreshAnthropicToken,
  type AnthropicOAuthCredentials
} from './anthropic-auth'

// Anthropic OAuth access tokens expire ~hourly and ROTATE the refresh token on
// every refresh, so the GUI settings store stays the single source of truth.
// We refresh ahead of expiry and re-persist via applyPatch; persisting the new
// credentials restarts the runtime so the active provider picks up the fresh
// Bearer. Refreshing well before expiry leaves slack for that restart.
const REFRESH_LEAD_MS = 15 * 60 * 1000
const CHECK_INTERVAL_MS = 5 * 60 * 1000

export type AnthropicTokenRefresher = {
  start: () => void
  stop: () => void
  /** Run one refresh pass now; resolves true if any credential was rotated. */
  refreshNow: () => Promise<boolean>
}

export type AnthropicTokenRefresherDeps = {
  load: () => Promise<AppSettingsV1>
  applyPatch: (patch: AppSettingsPatch) => Promise<unknown>
  /** Injectable for tests; defaults to the real network refresh. */
  refresh?: (creds: AnthropicOAuthCredentials) => Promise<AnthropicOAuthCredentials | null>
  now?: () => number
  log?: (message: string, extra?: Record<string, unknown>) => void
  leadMs?: number
  intervalMs?: number
}

export function createAnthropicTokenRefresher(deps: AnthropicTokenRefresherDeps): AnthropicTokenRefresher {
  const now = deps.now ?? (() => Date.now())
  const refresh = deps.refresh ?? refreshAnthropicToken
  const leadMs = deps.leadMs ?? REFRESH_LEAD_MS
  const intervalMs = deps.intervalMs ?? CHECK_INTERVAL_MS
  let timer: ReturnType<typeof setInterval> | null = null
  let running = false

  async function refreshProfile(profile: ModelProviderProfileV1): Promise<ModelProviderProfileV1 | null> {
    const raw = (profile.apiKey ?? '').trim()
    if (!isAnthropicOAuthCredentials(raw)) return null
    const creds = parseAnthropicCredentials(raw)
    if (!creds) return null
    if (creds.expiresAt - now() > leadMs) return null
    const refreshed = await refresh(creds)
    if (!refreshed) {
      deps.log?.('anthropic token refresh returned no credentials', { providerId: profile.id })
      return null
    }
    return { ...profile, apiKey: encodeAnthropicCredentials(refreshed) }
  }

  async function refreshNow(): Promise<boolean> {
    // Guard against overlapping passes (the interval can fire while a slow
    // refresh + runtime restart is still in flight).
    if (running) return false
    running = true
    try {
      const settings = await deps.load()
      const providers = getModelProviderSettings(settings).providers
      let changed = false
      const next: ModelProviderProfileV1[] = []
      for (const profile of providers) {
        const updated = await refreshProfile(profile)
        if (updated) {
          changed = true
          next.push(updated)
        } else {
          next.push(profile)
        }
      }
      if (!changed) return false
      await deps.applyPatch({ provider: { providers: next } })
      deps.log?.('refreshed anthropic oauth credentials')
      return true
    } catch (error) {
      deps.log?.('anthropic token refresh failed', {
        message: error instanceof Error ? error.message : String(error)
      })
      return false
    } finally {
      running = false
    }
  }

  return {
    start: () => {
      if (timer) return
      // Immediate pass catches a token that expired while the app was closed.
      void refreshNow()
      timer = setInterval(() => void refreshNow(), intervalMs)
      timer.unref()
    },
    stop: () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
    refreshNow
  }
}
