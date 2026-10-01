import { useEffect, useState } from 'react'
import type { AppSettingsV1 } from '@shared/app-settings'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { getModelProviderSettings } from '@shared/app-settings-provider-core'
import type { KunRuntimeSettingsSyncStatusPayload } from '@shared/kun-gui-api'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { SettingsRouteSection } from '../../store/chat-store-types'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { SETTINGS_CHANGED_EVENT } from '../../lib/keyboard-shortcut-settings'
import { useRuntimeSettingsSyncStatus } from '../use-runtime-settings-sync-status'
import {
  harnessRowAvailable,
  harnessRowRunsTurns,
  loadHarnesses,
  useHarnessStore
} from '../../store/harness-store'

/**
 * ADE home readiness (docs/ade/impl/p4 §P4-14): the three gates a fresh
 * manager or one-to-one session needs — a usable model provider for the
 * manager's Kun turns, at least one turn-capable agent ready, and the
 * local Kun gateway toggled on and applied cleanly.
 */
export type AdeReadinessCheckId = 'provider' | 'agents' | 'gateway'

export type AdeReadinessCheck = {
  id: AdeReadinessCheckId
  /** null while the backing data is still loading. */
  ok: boolean | null
  /** Short status detail, e.g. the provider name or the ready-agent count. */
  detail: string
  /** Settings deep link for the fix action. */
  section: SettingsRouteSection
}

const DEFAULT_PROVIDER_ID = 'deepseek'

function providerCheckDetail(settings: AppSettingsV1 | null): { ok: boolean | null; detail: string } {
  if (!settings) return { ok: null, detail: '' }
  const kun = getKunRuntimeSettings(settings)
  const provider = getModelProviderSettings(settings)
  const providers = provider.providers ?? []
  const activeId = kun.providerId?.trim() || DEFAULT_PROVIDER_ID
  const active = providers.find((entry) => entry.id === activeId) ?? providers[0]
  const key = kun.apiKey.trim() || active?.apiKey.trim() || ''
  const model = kun.model.trim()
  return {
    ok: Boolean(key && model),
    detail: active?.name?.trim() || active?.id || ''
  }
}

export function buildAdeReadinessChecks(input: {
  settings: AppSettingsV1 | null
  rows: readonly AdeHarnessRow[]
  rowsLoaded: boolean
  syncStatus: KunRuntimeSettingsSyncStatusPayload | null
}): AdeReadinessCheck[] {
  const provider = providerCheckDetail(input.settings)
  const readyAgents = input.rows.filter(
    (row) => harnessRowRunsTurns(row) && harnessRowAvailable(row)
  ).length
  const gatewaySection = input.syncStatus?.sections?.localModelGateway
  const gatewayEnabled = input.settings
    ? getModelProviderSettings(input.settings).localGateway.enabled
    : null
  return [
    { id: 'provider', ok: provider.ok, detail: provider.detail, section: 'agents' },
    {
      id: 'agents',
      ok: !input.rowsLoaded ? null : readyAgents > 0,
      detail: String(readyAgents),
      section: 'agentsHarnesses'
    },
    {
      id: 'gateway',
      ok: gatewayEnabled === null ? null : gatewayEnabled && !gatewaySection,
      detail: gatewaySection?.code ?? '',
      section: 'providers'
    }
  ]
}

export function useAdeReadiness(): AdeReadinessCheck[] {
  const [settings, setSettings] = useState<AppSettingsV1 | null>(null)
  const rows = useHarnessStore((s) => s.rows)
  const rowsLoaded = useHarnessStore((s) => s.rowsLoadedAt !== undefined)
  const syncStatus = useRuntimeSettingsSyncStatus(true)

  useEffect(() => {
    let cancelled = false
    const apply = (next: AppSettingsV1): void => {
      if (!cancelled) setSettings(next)
    }
    try {
      void rendererRuntimeClient.getSettings().then(apply).catch(() => undefined)
    } catch {
      // Bridge unavailable in tests — the checks stay in their loading state.
    }
    const onSettingsChanged = (event: Event): void => {
      const detail = (event as CustomEvent<AppSettingsV1>).detail
      if (detail) apply(detail)
    }
    if (typeof window !== 'undefined') {
      window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    }
    return () => {
      cancelled = true
      if (typeof window !== 'undefined') {
        window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
      }
    }
  }, [])

  useEffect(() => {
    void loadHarnesses(true, { waitMs: 3_000 })
  }, [])

  return buildAdeReadinessChecks({ settings, rows, rowsLoaded, syncStatus })
}
