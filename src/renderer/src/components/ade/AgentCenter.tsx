import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Plus } from 'lucide-react'
import type {
  KunHarnessSettingsV1,
  KunRuntimeSettingsV1
} from '@shared/app-settings'
import { getProvider } from '../../agent/registry'
import { applyHarnessEnablementSettings, harnessIdsWithChangedLaunchSettings, loadHarnesses, useHarnessStore } from '../../store/harness-store'
import { AgentCenterCard } from './AgentCenterCard'
import { AgentCatalogSkeleton } from './AgentCenterParts'
import { AgentCatalogSearch, AgentCatalogRail } from './AgentCenterCatalog'
import { filterAgentCatalog, orderedAgentCatalog } from './agent-center-catalog'
import { exportCustomEntry } from './agent-center-custom-form'
import { AgentCenterAddWizard } from './agent-center-add-wizard'
import { SETTINGS_CHANGED_EVENT } from '../../lib/keyboard-shortcut-settings'

export function harnessSettings(kun: KunRuntimeSettingsV1): KunHarnessSettingsV1 {
  return kun.harnesses ?? {
    enabledProfiles: [],
    disabledIds: [],
    binaryPaths: {},
    custom: [],
    defaults: {},
    defaultHarnessId: 'kun',
    agentOrder: [],
    terminalAgents: []
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

  const ordered = orderedAgentCatalog(rows, settings.agentOrder)
  const visibleRows = filterAgentCatalog(ordered, search)
  const selectedRow = visibleRows.find((row) => row.definition.id === selectedId)
    ?? visibleRows.find((row) => row.definition.id === settings.defaultHarnessId)
    ?? visibleRows.find((row) => row.definition.id === 'kun')
    ?? visibleRows[0]
  const platform = typeof window === 'undefined' ? 'darwin' : (window.kunGui?.platform ?? 'darwin')

  return (
    <div data-agent-center>
      <section className="ds-settings-card overflow-clip rounded-[var(--ds-radius-card)] border border-ds-border bg-ds-card">
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pb-4 pt-[18px]">
          <div className="min-w-0">
            <h2 className="ds-settings-card-title flex items-center gap-2">
              {t('adeAgentCenter.title')}
              {/* Background re-detection keeps the current rows on screen; only a
                  fixed-size spinner signals it so the layout never jumps. */}
              {rowsLoading && rows.length > 0 ? (
                <span role="status" aria-live="polite" title={t('agentIntegrations.loadingCatalog')} data-agent-catalog-refreshing
                  className="inline-flex shrink-0 text-ds-faint">
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                  <span className="sr-only">{t('agentIntegrations.loadingCatalog')}</span>
                </span>
              ) : null}
            </h2>
            <p className="ds-settings-card-description mt-1">{t('agentIntegrations.catalogDescription')}</p>
          </div>
          <button data-settings-action="primary" data-settings-size="default" type="button" onClick={() => setAddOpen(true)}
            className="shrink-0" data-agent-add-open>
            <Plus aria-hidden className="h-4 w-4" strokeWidth={2} />
            {t('agentAdd.title')}
          </button>
        </header>
        <AgentCatalogSearch search={search} onSearch={setSearch} t={t} />
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
        ) : visibleRows.length === 0 && !rowsLoading ? (
          <div className="px-5 py-10 text-center text-[13px] text-ds-faint">{t(ordered.length ? 'agentIntegrations.noMatches' : 'agentIntegrations.emptyCatalog')}</div>
        ) : (
          <div className="grid min-w-0 md:grid-cols-[minmax(12rem,15rem)_minmax(0,1fr)]">
            {/* The tinted column spans the full detail height; the list itself stays pinned while the detail scrolls. */}
            <div className="min-w-0 border-b border-ds-border-muted bg-ds-subtle md:border-b-0 md:border-r">
              <AgentCatalogRail rows={visibleRows} selectedId={selectedRow?.definition.id} settings={settings} platform={platform}
                onSelect={setSelectedId} t={t} tSettings={tSettings} />
            </div>
            <div className="min-w-0 p-5">
              {selectedRow && !addOpen ? [selectedRow].map((row) => {
            const id = row.definition.id
            return (
              <AgentCenterCard
                key={id}
                row={row}
                settings={settings}
                probing={probingId === id}
                platform={platform}
                t={t}
                tSettings={tSettings}
                onPatchHarness={patchHarness}
                beforeEnableCheck={beforeEnableCheck}
                onProbe={() => void probe(id)}
                onSetDefault={() => patchHarness({ defaultHarnessId: id })}
                // P4-13: terminal agents are catalog rows too but live under
                // `terminalAgents[]`, not `custom[]` — only true custom ACP
                // entries get remove/export affordances.
                onRemoveCustom={settings.custom.some((entry) => entry.id === id) ? () =>
                  patchHarness({ custom: settings.custom.filter((entry) => entry.id !== id) })
                  : undefined}
                onExportCustom={(() => {
                  const entry = settings.custom.find((candidate) => candidate.id === id)
                  return entry ? () => void exportCustomEntry(entry) : undefined
                })()}
                onSetBinaryPath={(path) => {
                  const binaryPaths = { ...settings.binaryPaths }
                  if (path.trim()) binaryPaths[id] = path.trim()
                  else delete binaryPaths[id]
                  patchHarness({ binaryPaths })
                }}
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
              }) : null}
            </div>
          </div>
        )}
      </section>
      {addOpen ? (
        <AgentCenterAddWizard
          settingsSurface={settingsSurface}
          rows={rows}
          settings={settings}
          updateKun={updateKun}
          onSetupCommand={onSetupCommand}
          onSelectAgent={setSelectedId}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
    </div>
  )
}
