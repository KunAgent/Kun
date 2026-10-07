import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Cable, Plus, RefreshCw } from 'lucide-react'
import type {
  KunHarnessSettingsV1,
  KunRuntimeSettingsV1
} from '@shared/app-settings'
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
import { useAgentActivityStore } from './agent-center-activity-store'
import { useAgentInstallWatch } from './use-agent-install-watch'
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
 * The Agent Center (docs/ade/impl/p4 §3.2, P4-08): one card per harness with
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
  const settings = harnessSettings(kun)
  const [probingId, setProbingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(false)
  const models = useHarnessStore((state) => state.models)
  const activity = useAgentActivityStore()
  useAgentInstallWatch()
  const [probeError, setProbeError] = useState('')

  useEffect(() => {
    // P4-02: always re-detect on open; waitMs lets an inflight pass settle.
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
    useHarnessStore.setState({ settingsHarnessId: undefined })
  }, [settingsHarnessId])

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

  // P4-10: `POST /v1/harnesses/:id/test` — a finished test may have moved
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
    return { row, presentation: agentPresentationFor(row, settings, { platform, modelCount: models[id]?.models.length,
      checking: Boolean(activity.checking[id]), changed: Boolean(activity.changed[id]), install: activity.install[id] }) }
  }), [rows, settings, platform, models, activity.checking, activity.changed, activity.install])
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

  return (
    <div data-agent-center>
      <section className="ds-settings-card ds-provider-workspace overflow-hidden rounded-xl border border-ds-border bg-ds-card">
        <header className="grid min-h-[76px] border-b border-ds-border-muted lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="flex min-w-0 items-center gap-3 border-b border-ds-border-muted px-4 py-3 lg:border-b-0 lg:border-r">
            <SettingsIconTile icon={Cable} tone="blue" className="ds-provider-workspace-tile" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[16px] font-semibold text-ds-ink">{t('agentCenter.title')}</h2>
              <p className="mt-0.5 truncate text-[11.5px] text-ds-faint" data-agent-center-summary>
                {t('agentCenter.summary.connected', { count: connected.length })}
                {attention > 0 ? ` · ${t('agentCenter.summary.attention', { count: attention })}` : ''}
              </p>
            </div>
            <button type="button" onClick={() => setAddOpen(true)} data-agent-add-open
              className={settingsButtonClass({ size: 'compact', className: 'shrink-0 whitespace-nowrap' })}>
              <Plus aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
              {t('agentCenter.add')}
            </button>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
            <p className="min-w-0 max-w-xl px-1 text-[12px] leading-5 text-ds-muted">{t('agentCenter.description')}</p>
            <div className="flex shrink-0 items-center gap-2.5">
              <span className="text-[12px] text-ds-muted">{t('agentCenter.defaultAgent')}</span>
              <div className="w-44" data-agent-default-select>
                <AgentSettingsSelect label={t('agentCenter.defaultAgentLabel')} value={settings.defaultHarnessId}
                  options={defaultOptions} onChange={(value) => patchHarness({ defaultHarnessId: value })} />
              </div>
              <button type="button" onClick={() => void loadHarnesses(true)} disabled={rowsLoading}
                aria-label={t('agentCenter.refreshAll')} title={t('agentCenter.refreshAll')} data-agent-catalog-refresh
                aria-busy={rowsLoading && rows.length > 0 ? true : undefined}
                className={settingsButtonClass({ variant: 'ghost', size: 'icon' })}>
                <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${rowsLoading && rows.length > 0 ? 'animate-spin' : ''}`} strokeWidth={2} />
              </button>
            </div>
          </div>
        </header>
        {rowsError || probeError ? (
          <div role="alert" className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-800/40 dark:bg-red-500/10 dark:text-red-300">
            <p>{t('agentIntegrations.catalogError')}</p>
            <p className="mt-1 break-words text-[11px]">{rowsError || probeError}</p>
            <button type="button" onClick={() => { setProbeError(''); void loadHarnesses(true) }} disabled={rowsLoading}
              className="mt-1 rounded px-1 py-1 underline focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">{t('adeAgentAction.retry')}</button>
          </div>
        ) : null}
        {rowsLoading && rows.length === 0 ? (
          <AgentCatalogSkeleton label={t('agentIntegrations.loadingCatalog')} />
        ) : visibleEntries.length === 0 && !rowsLoading && !search ? (
          <div className="px-5 py-10 text-center text-[13px] text-ds-faint">{t('agentIntegrations.emptyCatalog')}</div>
        ) : (
          <div className="grid min-w-0 lg:grid-cols-[300px_minmax(0,1fr)]">
            {/* Narrow windows trade the list for one picker above the detail. */}
            <div className="border-b border-ds-border-muted px-4 py-3 lg:hidden" data-agent-compact-picker>
              <AgentSettingsSelect label={t('agentCenter.title')} value={selectedRow?.definition.id ?? ''}
                onChange={setSelectedId}
                options={compactEntries.map(({ row, presentation }) => ({ value: row.definition.id,
                  label: `${row.definition.displayName} · ${agentLineText(t, presentation.listLine)}`,
                  icon: <AgentIcon harnessId={row.definition.id} size={15} /> }))} />
            </div>
            <div className="hidden min-h-0 min-w-0 lg:flex lg:flex-col">
            <AgentCenterRail groups={groups} selectedId={selectedRow?.definition.id} defaultId={settings.defaultHarnessId}
              search={search} expanded={expanded} onSearch={setSearch} onToggleExpanded={() => setExpanded((value) => !value)}
              onSelect={setSelectedId}
              onMove={(id, index) => patchHarness({ agentOrder: reorderAgents(settings.agentOrder, connectedIds, id, index) })}
              onFindExtensions={() => useChatStore.getState().openSettings('extensions')} t={t} />
            </div>
            <div className="min-w-0 p-5">
              {selectedRow && !addOpen ? (() => {
                const row = selectedRow
                const id = row.definition.id
                return (
                  <AgentDetail
                    key={id}
                    row={row}
                    settings={settings}
                    probing={probingId === id}
                    platform={platform}
                    t={t}
                    tSettings={tSettings}
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
                      // P4-11: permission defaults live under defaults[id].
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
                )
              })() : visibleEntries.length === 0 ? (
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
