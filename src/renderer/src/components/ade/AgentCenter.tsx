import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  KunHarnessSettingsV1,
  KunRuntimeSettingsV1
} from '@shared/app-settings'
import { getProvider } from '../../agent/registry'
import { loadHarnesses, useHarnessStore } from '../../store/harness-store'
import { SettingsCard } from '../settings-controls'
import { AgentCenterCard } from './AgentCenterCard'
import { AgentCenterCustomForm } from './agent-center-custom-form'

export function harnessSettings(kun: KunRuntimeSettingsV1): KunHarnessSettingsV1 {
  return kun.harnesses ?? {
    disabledIds: [],
    binaryPaths: {},
    custom: [],
    defaultPermissionMode: {},
    defaultHarnessId: 'kun',
    agentOrder: []
  }
}

/**
 * The Agent Center (docs/ade/impl/p4 §3.2, P4-08): one card per harness with
 * a state-driven primary action — install/sign-in commands are handed to
 * `onSetupCommand` (the Kun-terminal prefill lands in P4-09) or offered as a
 * copyable command until then. Rendered both from the ADE sidebar entry and
 * from Settings → Agents → Agent harness so the two surfaces stay identical.
 */
export function AgentCenter({
  kun,
  updateKun,
  onSetupCommand
}: {
  kun: KunRuntimeSettingsV1
  updateKun: (patch: { harnesses?: Partial<KunHarnessSettingsV1> }) => void
  onSetupCommand?: (harnessId: string, command: string, title: string) => void
}): ReactElement {
  // This surface mixes namespaces: adeAgent*/adeHarness*/adeCredential.*
  // live in `common`, the legacy adeSettings.* strings in `settings`. Both
  // are resolved locally so callers can never feed the wrong `t`.
  const { t } = useTranslation('common')
  const { t: tSettings } = useTranslation('settings')
  const rows = useHarnessStore((state) => state.rows)
  const rowsLoading = useHarnessStore((state) => state.rowsLoading)
  const rowsError = useHarnessStore((state) => state.rowsError)
  const settings = harnessSettings(kun)
  const [probingId, setProbingId] = useState<string | null>(null)

  useEffect(() => {
    // P4-02: always re-detect on open; waitMs lets an inflight pass settle.
    void loadHarnesses(true, { waitMs: 3_000 })
  }, [])

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

  return (
    <div data-agent-center>
      <SettingsCard title={t('adeAgentCenter.title')}>
        <div className="pb-1 text-[12px] text-ds-faint">{t('adeAgentCenter.desc')}</div>
        {rowsError ? (
          <div className="rounded-lg border border-red-200/80 bg-red-50/80 px-3 py-2 text-[12px] text-red-700 dark:border-red-800/40 dark:bg-red-500/10 dark:text-red-300">
            {rowsError}
          </div>
        ) : null}
        {ordered.length === 0 && !rowsLoading ? (
          <div className="px-1 py-3 text-[13px] text-ds-faint">{tSettings('adeSettings.harnessesEmpty')}</div>
        ) : (
          ordered.map((row) => {
            const id = row.definition.id
            return (
              <AgentCenterCard
                key={id}
                row={row}
                settings={settings}
                probing={probingId === id}
                platform={typeof window === 'undefined' ? 'darwin' : (window.kunGui?.platform ?? 'darwin')}
                t={t}
                tSettings={tSettings}
                onToggleEnabled={(enabled) => patchHarness({
                  disabledIds: enabled
                    ? settings.disabledIds.filter((entry) => entry !== id)
                    : [...new Set([...settings.disabledIds, id])]
                })}
                onProbe={() => void probe(id)}
                onSetDefault={() => patchHarness({ defaultHarnessId: id })}
                onRemoveCustom={row.definition.builtin ? undefined : () =>
                  patchHarness({ custom: settings.custom.filter((entry) => entry.id !== id) })}
                onSetBinaryPath={(path) => {
                  const binaryPaths = { ...settings.binaryPaths }
                  if (path.trim()) binaryPaths[id] = path.trim()
                  else delete binaryPaths[id]
                  patchHarness({ binaryPaths })
                }}
                onSetPermissionMode={(modeId) => {
                  const defaultPermissionMode = { ...settings.defaultPermissionMode }
                  if (modeId) defaultPermissionMode[id] = modeId
                  else delete defaultPermissionMode[id]
                  patchHarness({ defaultPermissionMode })
                }}
                onSetupCommand={onSetupCommand}
                onTest={(level) => test(id, level)}
              />
            )
          })
        )}
      </SettingsCard>
      <SettingsCard title={tSettings('adeSettings.acpTitle')}>
        <div className="pb-2 text-[12px] text-ds-faint">{tSettings('adeSettings.acpDesc')}</div>
        <AgentCenterCustomForm settings={settings} updateKun={updateKun} t={tSettings} />
      </SettingsCard>
    </div>
  )
}
