import { useEffect, useState, type ReactElement } from 'react'
import { ChevronDown, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type {
  KunHarnessCustomEntryV1,
  KunHarnessSettingsV1,
  KunRuntimeSettingsV1
} from '@shared/app-settings'
import { getProvider } from '../agent/registry'
import { loadHarnesses, useHarnessStore } from '../store/harness-store'
import { SettingRow, SettingsCard, Toggle } from './settings-controls'

type HarnessesView = {
  t: (key: string, options?: Record<string, unknown>) => string
  kun: KunRuntimeSettingsV1
  updateKun: (patch: {
    harnesses?: Partial<KunHarnessSettingsV1>
  }) => void
  activePanel: string
}

function harnessSettings(kun: KunRuntimeSettingsV1): KunHarnessSettingsV1 {
  return kun.harnesses ?? {
    disabledIds: [],
    binaryPaths: {},
    custom: [],
    defaultPermissionMode: {},
    defaultHarnessId: 'kun',
    agentOrder: []
  }
}

function loginStateKey(status: AdeHarnessRow['status']): string {
  if (status.installed === 'no') return 'adeSettings.harnessLoginMissing'
  switch (status.login) {
    case 'signed-in':
      return 'adeSettings.harnessLoginSignedIn'
    case 'signed-out':
      return 'adeSettings.harnessLoginSignedOut'
    case 'not-required':
      return 'adeSettings.harnessLoginNotRequired'
    default:
      return 'adeSettings.harnessLoginUnknown'
  }
}

function HarnessRow({
  row,
  settings,
  updateKun,
  t
}: {
  row: AdeHarnessRow
  settings: KunHarnessSettingsV1
  updateKun: HarnessesView['updateKun']
  t: HarnessesView['t']
}): ReactElement {
  const { definition, status } = row
  const isKun = definition.id === 'kun'
  const enabled = !settings.disabledIds.includes(definition.id)
  const custom = !definition.builtin
  const [probing, setProbing] = useState(false)

  const patchHarness = (patch: Partial<KunHarnessSettingsV1>): void => {
    updateKun({ harnesses: { ...settings, ...patch } })
  }
  const setEnabled = (next: boolean): void => {
    patchHarness({
      disabledIds: next
        ? settings.disabledIds.filter((id) => id !== definition.id)
        : [...new Set([...settings.disabledIds, definition.id])]
    })
  }
  const setBinaryPath = (path: string): void => {
    const binaryPaths = { ...settings.binaryPaths }
    if (path.trim()) binaryPaths[definition.id] = path.trim()
    else delete binaryPaths[definition.id]
    patchHarness({ binaryPaths })
  }
  const setPermissionMode = (modeId: string): void => {
    const defaultPermissionMode = { ...settings.defaultPermissionMode }
    if (modeId) defaultPermissionMode[definition.id] = modeId
    else delete defaultPermissionMode[definition.id]
    patchHarness({ defaultPermissionMode })
  }
  const probe = async (): Promise<void> => {
    setProbing(true)
    try {
      await getProvider().probeHarness?.(definition.id)
      await loadHarnesses(true)
    } finally {
      setProbing(false)
    }
  }
  const removeCustom = (): void => {
    patchHarness({ custom: settings.custom.filter((e) => e.id !== definition.id) })
  }

  return (
    <details className="group border-b border-ds-border-muted last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-1 py-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
            <span className="truncate">{definition.displayName}</span>
            {status.version ? (
              <span className="shrink-0 rounded-md bg-ds-main/70 px-1.5 py-0.5 font-mono text-[11px] text-ds-muted">
                {status.version}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-ds-faint">
            {t(loginStateKey(status))}
            {status.message ? ` · ${status.message}` : ''}
          </div>
        </div>
        {!isKun ? (
          <Toggle
            checked={enabled}
            ariaLabel={`${definition.displayName} ${t('adeSettings.harnessEnabled')}`}
            onChange={setEnabled}
          />
        ) : null}
        <ChevronDown className="h-4 w-4 shrink-0 text-ds-faint transition group-open:rotate-180" strokeWidth={1.8} />
      </summary>
      <div className="space-y-3 px-1 pb-4 pt-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void probe()}
            disabled={probing || !getProvider().probeHarness}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border-muted px-2.5 py-1.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${probing ? 'animate-spin' : ''}`} strokeWidth={1.8} />
            {t('adeSettings.harnessRedetect')}
          </button>
          {custom ? (
            <button
              type="button"
              onClick={removeCustom}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-red-600 transition hover:bg-red-500/10"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('adeSettings.harnessRemoveCustom')}
            </button>
          ) : null}
        </div>
        <SettingRow
          title={t('adeSettings.harnessCommandPath')}
          description={status.resolvedCommand || t('adeSettings.harnessCommandPathDesc')}
          control={
            <input
              className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[12px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none"
              value={settings.binaryPaths[definition.id] ?? ''}
              placeholder={status.resolvedCommand ?? definition.id}
              spellCheck={false}
              onChange={(event) => setBinaryPath(event.target.value)}
            />
          }
        />
        {definition.permissionModes.length ? (
          <SettingRow
            title={t('adeSettings.harnessPermissionMode')}
            description={t('adeSettings.harnessPermissionModeDesc')}
            control={
              <select
                className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none"
                value={settings.defaultPermissionMode[definition.id] ?? ''}
                onChange={(event) => setPermissionMode(event.target.value)}
              >
                <option value="">{t('adeSettings.harnessPermissionModeDefault')}</option>
                {definition.permissionModes.map((mode) => (
                  <option key={mode.id} value={mode.id}>
                    {mode.label}
                  </option>
                ))}
              </select>
            }
          />
        ) : null}
      </div>
    </details>
  )
}

function CustomHarnessForm({
  settings,
  updateKun,
  t
}: {
  settings: KunHarnessSettingsV1
  updateKun: HarnessesView['updateKun']
  t: HarnessesView['t']
}): ReactElement {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [env, setEnv] = useState('')
  const [error, setError] = useState('')

  const add = (): void => {
    const displayName = name.trim()
    const cmd = command.trim()
    if (!displayName || !cmd) {
      setError(t('adeSettings.acpFormRequired'))
      return
    }
    const envRecord: Record<string, string> = {}
    for (const line of env.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) {
        setError(t('adeSettings.acpFormEnvInvalid'))
        return
      }
      envRecord[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
    }
    const id = `custom-${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'}`
    if (settings.custom.some((e) => e.id === id)) {
      setError(t('adeSettings.acpFormDuplicate'))
      return
    }
    const entry: KunHarnessCustomEntryV1 = {
      id,
      displayName,
      command: cmd,
      args: args.trim() ? args.trim().split(/\s+/) : [],
      env: envRecord
    }
    updateKun({ harnesses: { ...settings, custom: [...settings.custom, entry] } })
    setName('')
    setCommand('')
    setArgs('')
    setEnv('')
    setError('')
  }

  const inputClass =
    'w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none'

  return (
    <div className="space-y-2.5">
      <input className={inputClass} value={name} spellCheck={false}
        placeholder={t('adeSettings.acpFormName')}
        onChange={(e) => setName(e.target.value)} />
      <input className={`${inputClass} font-mono text-[12px]`} value={command} spellCheck={false}
        placeholder={t('adeSettings.acpFormCommand')}
        onChange={(e) => setCommand(e.target.value)} />
      <input className={`${inputClass} font-mono text-[12px]`} value={args} spellCheck={false}
        placeholder={t('adeSettings.acpFormArgs')}
        onChange={(e) => setArgs(e.target.value)} />
      <div>
        <textarea className={`${inputClass} resize-none font-mono text-[12px]`} value={env}
          rows={2} spellCheck={false}
          placeholder={t('adeSettings.acpFormEnv')}
          onChange={(e) => setEnv(e.target.value)} />
        <div className="mt-1 text-[11px] text-ds-faint">{t('adeSettings.acpFormEnvNoSecrets')}</div>
      </div>
      {error ? <div className="text-[12px] text-red-600 dark:text-red-400">{error}</div> : null}
      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border-muted px-3 py-1.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
        {t('adeSettings.acpFormAdd')}
      </button>
    </div>
  )
}

/**
 * Settings → Agents → Harnesses (P1-24, docs/ade/12 §7.2): detection status,
 * enablement, per-harness command path + default permission tier, and the
 * custom ACP agent form. Rows come from GET /v1/harnesses; custom entries
 * persist under agents.kun.harnesses.custom.
 */
export function AgentsHarnessesSettingsPanel({ view }: { view: Record<string, any> }): ReactElement {
  const { t, kun, updateKun, activePanel } = view as HarnessesView
  const rows = useHarnessStore((state) => state.rows)
  const rowsLoading = useHarnessStore((state) => state.rowsLoading)
  const rowsError = useHarnessStore((state) => state.rowsError)
  const settings = harnessSettings(kun)

  useEffect(() => {
    void loadHarnesses()
  }, [])

  return (
    <div
      id="agents-settings-panel-harnesses"
      role="tabpanel"
      aria-labelledby="agents-settings-tab-harnesses"
      className={activePanel === 'harnesses' ? '' : 'hidden'}
    >
      <SettingsCard title={t('adeSettings.harnessesTitle')}>
        <div className="pb-1 text-[12px] text-ds-faint">{t('adeSettings.harnessesDesc')}</div>
        {rowsError ? (
          <div className="rounded-lg border border-red-200/80 bg-red-50/80 px-3 py-2 text-[12px] text-red-700 dark:border-red-800/40 dark:bg-red-500/10 dark:text-red-300">
            {rowsError}
          </div>
        ) : null}
        {rows.length === 0 && !rowsLoading ? (
          <div className="px-1 py-3 text-[13px] text-ds-faint">{t('adeSettings.harnessesEmpty')}</div>
        ) : (
          rows.map((row) => (
            <HarnessRow
              key={row.definition.id}
              row={row}
              settings={settings}
              updateKun={updateKun}
              t={t}
            />
          ))
        )}
      </SettingsCard>
      <SettingsCard title={t('adeSettings.acpTitle')}>
        <div className="pb-2 text-[12px] text-ds-faint">{t('adeSettings.acpDesc')}</div>
        <CustomHarnessForm settings={settings} updateKun={updateKun} t={t} />
      </SettingsCard>
    </div>
  )
}
