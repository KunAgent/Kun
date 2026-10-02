import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  KunHarnessSettingsV1,
  KunRuntimeSettingsV1
} from '@shared/app-settings'
import { getProvider } from '../../agent/registry'
import { harnessUnavailableLabelKey, loadHarnesses, useHarnessStore } from '../../store/harness-store'
import { SettingsCard } from '../settings-controls'
import { AgentCenterCard } from './AgentCenterCard'
import { agentCardModel } from './agent-center-actions'
import { exportCustomEntry } from './agent-center-custom-form'
import { AgentCenterAddWizard } from './agent-center-add-wizard'
import { AgentIcon } from '../agent-icon'

export function harnessSettings(kun: KunRuntimeSettingsV1): KunHarnessSettingsV1 {
  return kun.harnesses ?? {
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
  onSetupCommand,
  settingsSurface = false
}: {
  kun: KunRuntimeSettingsV1
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

  useEffect(() => {
    // P4-02: always re-detect on open; waitMs lets an inflight pass settle.
    void loadHarnesses(true, { waitMs: 3_000 })
  }, [])

  useEffect(() => {
    if (!settingsHarnessId) return
    setSelectedId(settingsHarnessId)
    useHarnessStore.setState({ settingsHarnessId: undefined })
  }, [settingsHarnessId])

  const patchHarness = (patch: Partial<KunHarnessSettingsV1>): void => {
    updateKun({ harnesses: { ...settings, ...patch } })
  }

  const probe = async (harnessId: string): Promise<void> => {
    setProbingId(harnessId)
    try {
      await getProvider().probeHarness?.(harnessId)
      await loadHarnesses(true)
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

  const ordered = [...rows].sort((a, b) => {
    const order = settings.agentOrder
    const ai = order.indexOf(a.definition.id)
    const bi = order.indexOf(b.definition.id)
    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi)
    }
    return a.definition.displayName.localeCompare(b.definition.displayName)
  })
  const selectedRow = ordered.find((row) => row.definition.id === selectedId)
    ?? ordered.find((row) => row.definition.id === settings.defaultHarnessId)
    ?? ordered.find((row) => row.definition.id === 'kun')
    ?? ordered[0]
  const platform = typeof window === 'undefined' ? 'darwin' : (window.kunGui?.platform ?? 'darwin')

  return (
    <div data-agent-center>
      <SettingsCard title={t('adeAgentCenter.title')}>
        <div className="flex items-start justify-between gap-3 pb-2">
          <div className="text-[12px] text-ds-faint">{t('adeAgentCenter.desc')}</div>
          <button data-settings-action="primary" data-settings-size="default" type="button" onClick={() => setAddOpen(true)} className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90" data-agent-add-open>
            {t('agentAdd.title')}
          </button>
        </div>
        {rowsError ? (
          <div className="rounded-lg border border-red-200/80 bg-red-50/80 px-3 py-2 text-[12px] text-red-700 dark:border-red-800/40 dark:bg-red-500/10 dark:text-red-300">
            {rowsError}
          </div>
        ) : null}
        {ordered.length === 0 && !rowsLoading ? (
          <div className="px-1 py-3 text-[13px] text-ds-faint">{tSettings('adeSettings.harnessesEmpty')}</div>
        ) : (
          <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(11rem,13rem)_minmax(0,1fr)]">
            <div role="listbox" className="flex min-w-0 flex-col gap-1 border-b border-ds-border-muted pb-3 md:border-b-0 md:border-r md:pb-0 md:pr-3"
              aria-label={tSettings('adeSettings.harnessesTitle')}>
              {ordered.map((row) => {
                const id = row.definition.id
                const model = agentCardModel(row, {
                  enabled: !settings.disabledIds.includes(id),
                  platform,
                  isDefault: settings.defaultHarnessId === id
                })
                const selected = selectedRow?.definition.id === id
                return <button key={id} type="button" role="option" data-agent-list-id={id}
                  data-selected={selected || undefined}
                  aria-selected={selected}
                  onClick={() => setSelectedId(id)}
                  className={`min-w-0 rounded-xl border-l-2 px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                    selected ? 'border-accent bg-accent/10 text-ds-ink' : 'border-transparent text-ds-muted hover:bg-ds-hover'
                  }`}>
                  <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium" title={row.definition.displayName}>
                    <AgentIcon harnessId={id} size={16} className="text-ds-muted" />
                    <span className="truncate">{row.definition.displayName}</span>
                  </span>
                  <span className="block truncate text-[11px] text-ds-faint">
                    {model.reasonCode ? t(harnessUnavailableLabelKey(model.reasonCode)) : tSettings(`adeSettings.agentState_${model.state}`)}
                  </span>
                </button>
              })}
            </div>
            <div className="min-w-0">
              {selectedRow ? [selectedRow].map((row) => {
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
                onToggleEnabled={(enabled) => patchHarness({
                  disabledIds: enabled
                    ? settings.disabledIds.filter((entry) => entry !== id)
                    : [...new Set([...settings.disabledIds, id])]
                })}
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
      </SettingsCard>
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
