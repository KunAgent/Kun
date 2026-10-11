import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Cable, Plus, RefreshCw } from 'lucide-react'
import type {
  KunHarnessSettingsV1,
  KunRuntimeSettingsV1
} from '@shared/app-settings'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { getProvider } from '../../agent/registry'
import { applyHarnessEnablementSettings, harnessIdsWithChangedLaunchSettings, loadHarnesses, useHarnessStore } from '../../store/harness-store'
import { useChatStore } from '../../store/chat-store'
import { SettingsIconTile } from '../settings-icon-tile'
import { settingsButtonClass } from '../settings-button'
import { AgentDetail } from './AgentDetail'
import { AgentCatalogSkeleton } from './AgentCenterParts'
import { AgentCenterRail } from './AgentCenterRail'
import { AgentSettingsSelect } from './AgentSettingsSelect'
import { groupAgentCatalog, reorderAgents, type AgentListEntry } from './agent-center-catalog'
import { agentLineText, agentPresentationFor } from './agent-center-presentation'
import { AgentIcon } from '../agent-icon'
import { setAgentViewing, useAgentActivityStore } from './agent-center-activity-store'
import { useAgentInstallWatch } from './use-agent-install-watch'
import { useAgentUpdateRunner } from '../../store/harness-update-runner'
import { hasHarnessUpdate, useHarnessUpdateStore } from '../../store/harness-update-store'
import type { AgentTabId } from './AgentDetail'
import { exportCustomEntry } from './agent-center-custom-form'
import { AgentAddDialog } from './AgentAddDialog'
import { SETTINGS_CHANGED_EVENT } from '../../lib/keyboard-shortcut-settings'
import { isUserAgent, userAgentEntry, withAgentCommandPath, withAgentLaunchPatch, withoutUserAgent } from '@shared/harness-provider-settings'

export function harnessSettings(kun: KunRuntimeSettingsV1): KunHarnessSettingsV1 {
  return kun.harnesses ?? {
    enabledProfiles: [],
    disabledIds: [],
    providers: {},
    defaults: {},
    defaultHarnessId: 'kun',
    agentOrder: []
  }
}

/**
 * The Agent Center: one card per harness with
 * a state-driven primary action. Install jobs stay in the card; interactive
 * sign-in can use `onSetupCommand` for terminal prefill. Rendered both from the ADE sidebar entry and
 * from Settings → Agents → Agent harness so the two surfaces stay identical.
 */
export function AgentCenter({
  kun,
  updateKun,
  beforeEnableCheck,
  onSetupCommand,
  settingsSurface = false
}: {
  kun: KunRuntimeSettingsV1
  beforeEnableCheck?: () => Promise<boolean>
  updateKun: (patch: { harnesses?: Partial<KunHarnessSettingsV1> }) => void
  onSetupCommand?: (harnessId: string, command: string, title: string) => void
  settingsSurface?: boolean
}): ReactElement {
  // This surface mixes namespaces: adeAgent*/adeHarness*/adeCredential.*
  // live in `common`, the legacy adeSettings.* strings in `settings`. Both
  // are resolved locally so callers can never feed the wrong `t`.
  const { t } = useTranslation('common')
  const { t: tSettings } = useTranslation('settings')
  const rows = useHarnessStore((state) => state.rows)
  const rowsLoading = useHarnessStore((state) => state.rowsLoading)
  const rowsError = useHarnessStore((state) => state.rowsError)
  const settingsHarnessId = useHarnessStore((state) => state.settingsHarnessId)
  const settingsHarnessTab = useHarnessStore((state) => state.settingsHarnessTab)
  const settings = harnessSettings(kun)
  const [probingId, setProbingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [tabRequest, setTabRequest] = useState<{ id: string; tab: AgentTabId; at: number } | null>(null)
  const models = useHarnessStore((state) => state.models)
  const activity = useAgentActivityStore()
  const updates = useAgentUpdateRunner((state) => state.items)
  const updateEntries = useHarnessUpdateStore((state) => state.entries)
  useAgentInstallWatch()
  const [probeError, setProbeError] = useState('')

  useEffect(() => {
    // always re-detect on open; waitMs lets an inflight pass settle.
    void loadHarnesses(true, { waitMs: 3_000 })
    if (typeof window === 'undefined') return
    const refresh = (): void => { void loadHarnesses(true) }
    window.addEventListener(SETTINGS_CHANGED_EVENT, refresh)
    const stop = window.kunGui?.onRuntimeSettingsSyncStatus?.((status) => { if (status.state === 'synced') refresh() })
    return () => { window.removeEventListener(SETTINGS_CHANGED_EVENT, refresh); stop?.() }
  }, [])

  useEffect(() => {
    if (!settingsHarnessId) return
    setSelectedId(settingsHarnessId)
    setSearch('')
    if (settingsHarnessTab) setTabRequest({ id: settingsHarnessId, tab: settingsHarnessTab, at: Date.now() })
    useHarnessStore.setState({ settingsHarnessId: undefined, settingsHarnessTab: undefined })
  }, [settingsHarnessId, settingsHarnessTab])

  const patchHarness = (patch: Partial<KunHarnessSettingsV1>): void => {
    const next = { ...settings, ...patch }
    applyHarnessEnablementSettings(next, harnessIdsWithChangedLaunchSettings(settings, next))
    updateKun({ harnesses: { ...settings, ...patch } })
  }

  const probe = async (harnessId: string): Promise<void> => {
    setProbingId(harnessId)
    setProbeError('')
    try {
      await getProvider().probeHarness?.(harnessId)
      await loadHarnesses(true)
    } catch (error) {
      setProbeError(error instanceof Error ? error.message : String(error))
    } finally {
      setProbingId(null)
    }
  }

  // `POST /v1/harnesses/:id/test` — a finished test may have moved
  // the cached status (e.g. a completed login), so the list reloads after.
  const test = async (harnessId: string, level: 'handshake' | 'trial') => {
    const testHarness = getProvider().testHarness
    if (!testHarness) throw new Error('harness test is not available')
    const result = await testHarness(harnessId, { level })
    await loadHarnesses(true)
    return result
  }

  const platform = typeof window === 'undefined' ? 'darwin' : (window.kunGui?.platform ?? 'darwin')
  const entries = useMemo((): AgentListEntry[] => rows.map((row) => {
    const id = row.definition.id
    const info = updateEntries[id]?.info
    return { row, presentation: agentPresentationFor(row, settings, { platform, modelCount: models[id]?.models.length,
      checking: Boolean(activity.checking[id]), changed: Boolean(activity.changed[id]), install: activity.install[id],
      update: updates[id], updateVersion: hasHarnessUpdate(id) ? info?.latestVersion ?? info?.candidate?.version : undefined }) }
  }), [rows, settings, platform, models, activity.checking, activity.changed, activity.install, updates, updateEntries])
  const groups = groupAgentCatalog(entries, settings.agentOrder, { search, expanded, selectedId: selectedId ?? undefined })
  const visibleEntries = groups.flatMap((group) => group.entries)
  // The narrow-window picker has no search or fold, so it lists every Agent in list order.
  const compactEntries = groupAgentCatalog(entries, settings.agentOrder, { search: '', expanded: true }).flatMap((group) => group.entries)
  const selectedRow = (visibleEntries.find((entry) => entry.row.definition.id === selectedId)
    ?? visibleEntries.find((entry) => entry.row.definition.id === settings.defaultHarnessId)
    ?? visibleEntries[0])?.row
  const connected = entries.filter((entry) => entry.presentation.group === 'connected' && entry.row.definition.id !== 'kun')
  const attention = connected.filter((entry) => ['needsRecheck', 'signedOut', 'connectFailed', 'versionLow', 'adapterMissing'].includes(entry.presentation.state)).length
  const defaultOptions = [
    { value: 'kun', label: rows.find((row) => row.definition.id === 'kun')?.definition.displayName ?? 'Kun' },
    ...connected.map((entry) => ({ value: entry.row.definition.id, label: entry.row.definition.displayName }))
  ]
  if (!defaultOptions.some((option) => option.value === settings.defaultHarnessId)) {
    const stale = rows.find((row) => row.definition.id === settings.defaultHarnessId)
    defaultOptions.push({ value: settings.defaultHarnessId, label: stale?.definition.displayName ?? settings.defaultHarnessId })
  }
  const connectedIds = groups.find((group) => group.id === 'connected')?.entries.map((entry) => entry.row.definition.id) ?? []
  const shownId = addOpen ? undefined : selectedRow?.definition.id
  // A check keeps running when another Agent is picked: its page stays mounted, hidden, until the check ends.
  const mountedIds = [...new Set([...(shownId ? [shownId] : []), ...Object.keys(activity.checking)])]
    .filter((id) => rows.some((row) => row.definition.id === id))
  useEffect(() => { setAgentViewing(shownId) }, [shownId])
  useEffect(() => () => setAgentViewing(undefined), [])
  const updating = Object.values(updates).filter((update) => update.phase !== 'completed' && update.phase !== 'failed').length

  const detail = (row: AdeHarnessRow): ReactElement => {
    const id = row.definition.id
    return <AgentDetail
      row={row}
      settings={settings}
      probing={probingId === id}
      platform={platform}
      t={t}
      tSettings={tSettings}
      requestedTab={tabRequest?.id === id ? tabRequest : undefined}
      baseName={row.definition.derivedFrom ? rows.find((candidate) => candidate.definition.id === row.definition.derivedFrom)?.definition.displayName : undefined}
      onPatchHarness={patchHarness}
      beforeEnableCheck={beforeEnableCheck}
      onProbe={() => void probe(id)}
      // User Agents (derived, generic ACP or terminal) can be removed;
      // only ACP ones export as a portable definition.
      onRemoveUser={isUserAgent(settings.providers, id) ? () => {
        // Drop every reference to the Agent and release the credentials it kept.
        const removal = withoutUserAgent(settings, id)
        patchHarness(removal.settings)
        for (const secretRef of removal.secretRefs) {
          void getProvider().deleteHarnessSecret?.(secretRef).catch(() => undefined)
        }
      } : undefined}
      onExportUser={(() => {
        const entry = userAgentEntry(settings.providers, id)
        return entry ? () => void exportCustomEntry(entry) : undefined
      })()}
      onSetBinaryPath={(path) => patchHarness({ providers: withAgentCommandPath(settings.providers, id, path) })}
      onSetLaunchPatch={(patch) => patchHarness({ providers: withAgentLaunchPatch(settings.providers, id, patch) })}
      onSetPermissionMode={(modeId) => {
        // permission defaults live under defaults[id].
        const defaults = { ...settings.defaults }
        if (modeId) {
          defaults[id] = { ...defaults[id], permissionMode: modeId }
        } else if (defaults[id]) {
          const { permissionMode: _dropped, ...rest } = defaults[id]
          if (Object.keys(rest).length) defaults[id] = rest
          else delete defaults[id]
        }
        patchHarness({ defaults })
      }}
      onSetupCommand={onSetupCommand}
      onTest={(level) => test(id, level)}
    />
  }

  return (
    <div data-agent-center>
      <section className="ds-settings-card ds-provider-workspace flex flex-col overflow-hidden rounded-xl border border-ds-border bg-ds-card">
        <header className="flex min-h-[64px] flex-wrap items-center gap-x-3 gap-y-2 border-b border-ds-border-muted px-5 py-3" data-agent-center-header>
          <SettingsIconTile icon={Cable} tone="blue" className="ds-provider-workspace-tile" />
          <div className="min-w-0 flex-1 basis-56">
            <h2 className="truncate text-[15px] font-semibold leading-5 text-ds-ink">{t('agentCenter.title')}</h2>
            <p className="mt-0.5 truncate text-[12px] leading-[17px] text-ds-muted" title={t('agentCenter.description')}>
              <span data-agent-center-summary>
                {t('agentCenter.summary.connected', { count: connected.length })}
                {attention > 0 ? ` · ${t('agentCenter.summary.attention', { count: attention })}` : ''}
                {updating > 0 ? ` · ${t('agentCenter.summary.updating', { count: updating })}` : ''}
              </span>
              <span className="text-ds-faint"> · {t('agentCenter.tagline')}</span>
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <span className="whitespace-nowrap text-[12.5px] text-ds-muted">{t('agentCenter.defaultAgent')}</span>
            <div className="w-40" data-agent-default-select>
              <AgentSettingsSelect label={t('agentCenter.defaultAgentLabel')} value={settings.defaultHarnessId}
                options={defaultOptions} onChange={(value) => patchHarness({ defaultHarnessId: value })} />
            </div>
            <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-ds-border-muted sm:block" />
            <button type="button" onClick={() => void loadHarnesses(true)} disabled={rowsLoading}
              aria-label={t('agentCenter.refreshAll')} title={t('agentCenter.refreshAll')} data-agent-catalog-refresh
              aria-busy={rowsLoading && rows.length > 0 ? true : undefined}
              className={settingsButtonClass({ size: 'icon' })}>
              <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${rowsLoading && rows.length > 0 ? 'animate-spin' : ''}`} strokeWidth={2} />
            </button>
            <button type="button" onClick={() => setAddOpen(true)} data-agent-add-open
              className={settingsButtonClass({ className: 'shrink-0 whitespace-nowrap' })}>
              <Plus aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
              {t('agentCenter.addAgent')}
            </button>
          </div>
        </header>
        {rowsError || probeError ? (
          <div role="alert" className="mx-5 mt-3 rounded-lg border border-[color-mix(in_srgb,var(--ds-danger)_30%,transparent)] bg-ds-danger-soft px-3 py-2 text-[12px] text-ds-ink">
            <p>{t('agentIntegrations.catalogError')}</p>
            <p className="mt-1 break-words text-[11px] text-ds-muted">{rowsError || probeError}</p>
            <button type="button" onClick={() => { setProbeError(''); void loadHarnesses(true) }} disabled={rowsLoading}
              className="mt-1 rounded px-1 py-1 text-accent underline focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">{t('adeAgentAction.retry')}</button>
          </div>
        ) : null}
        {rowsLoading && rows.length === 0 ? (
          <AgentCatalogSkeleton label={t('agentIntegrations.loadingCatalog')} />
        ) : visibleEntries.length === 0 && !rowsLoading && !search ? (
          <div className="px-5 py-10 text-center text-[13px] text-ds-faint">{t('agentIntegrations.emptyCatalog')}</div>
        ) : (
          <div className="grid min-h-0 min-w-0 flex-1 lg:grid-cols-[272px_minmax(0,1fr)]">
            {/* Narrow windows trade the list for one picker above the detail. */}
            <div className="border-b border-ds-border-muted px-4 py-3 lg:hidden" data-agent-compact-picker>
              <AgentSettingsSelect label={t('agentCenter.title')} value={selectedRow?.definition.id ?? ''}
                onChange={setSelectedId}
                options={compactEntries.map(({ row, presentation }) => ({ value: row.definition.id,
                  label: `${row.definition.displayName} · ${agentLineText(t, presentation.activity?.line ?? presentation.listLine)}`,
                  icon: <AgentIcon harnessId={row.definition.id} size={15} /> }))} />
            </div>
            <div className="hidden min-h-0 min-w-0 border-ds-border-muted bg-[color-mix(in_srgb,var(--ds-surface-subtle)_55%,var(--ds-surface-card))] lg:flex lg:flex-col lg:border-r">
              <AgentCenterRail groups={groups} selectedId={selectedRow?.definition.id} defaultId={settings.defaultHarnessId}
                search={search} expanded={expanded} onSearch={setSearch} onToggleExpanded={() => setExpanded((value) => !value)}
                onSelect={setSelectedId}
                onMove={(id, index) => patchHarness({ agentOrder: reorderAgents(settings.agentOrder, connectedIds, id, index) })}
                onFindExtensions={() => useChatStore.getState().openSettings('extensions')} t={t} />
            </div>
            <div className="min-w-0 px-5 py-5 lg:px-8 lg:py-6">
              {mountedIds.map((id) => {
                const row = rows.find((candidate) => candidate.definition.id === id)!
                return <div key={id} hidden={id !== shownId} data-agent-detail-slot={id}>{detail(row)}</div>
              })}
              {!shownId && !addOpen && visibleEntries.length === 0 ? (
                <p className="py-10 text-center text-[13px] text-ds-faint">{t('agentIntegrations.noMatches')}</p>
              ) : null}
            </div>
          </div>
        )}
      </section>
      {addOpen ? (
        <AgentAddDialog
          settingsSurface={settingsSurface}
          settings={settings}
          updateKun={updateKun}
          onSelectAgent={setSelectedId}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
    </div>
  )
}
