import { useEffect, useState, type ReactElement } from 'react'
import { Lock, Plus, X } from 'lucide-react'
import type { KunHarnessSecretEnvEntryV1 } from '@shared/app-settings'
import { getProvider } from '../../agent/registry'

type T = (key: string, options?: Record<string, unknown>) => string
type Row = { name: string; value: string }

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/
const inputClass = 'h-9 min-w-0 w-full rounded-xl border border-ds-border bg-ds-card px-3 font-mono text-[12px] text-ds-ink shadow-sm placeholder:text-ds-faint focus:border-accent focus:outline-none aria-[invalid=true]:border-[var(--ds-danger)]'
const rowsOf = (env: Readonly<Record<string, string>>): Row[] => Object.entries(env).map(([name, value]) => ({ name, value }))

/**
 * Environment variables for an Agent's launch: plain ones that save when a
 * field loses focus (only once every name is valid), and sensitive ones that
 * go straight to the credential store and are never shown again.
 */
export function AgentEnvTable({ env, secretEnv, onChange, t, tSettings }: {
  env: Readonly<Record<string, string>>
  secretEnv: readonly KunHarnessSecretEnvEntryV1[]
  onChange: (patch: { env?: Record<string, string>; secretEnv?: KunHarnessSecretEnvEntryV1[] }) => void
  /** common-ns translator. */
  t: T
  /** settings-ns translator, for the shared credential wording. */
  tSettings: T
}): ReactElement {
  const stored = JSON.stringify(env)
  const [rows, setRows] = useState<Row[]>(() => rowsOf(env))
  const [adding, setAdding] = useState(false)
  const [secretName, setSecretName] = useState('')
  const [secretValue, setSecretValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => setRows(rowsOf(JSON.parse(stored) as Record<string, string>)), [stored])

  const names = rows.map((row) => row.name.trim())
  const invalid = (index: number): boolean => {
    const name = names[index] ?? ''
    return name !== '' && (!ENV_NAME.test(name) || names.indexOf(name) !== index || secretEnv.some((entry) => entry.name === name))
  }
  const commit = (next: Row[]): void => {
    const filled = next.filter((row) => row.name.trim() !== '')
    const filledNames = filled.map((row) => row.name.trim())
    if (filledNames.some((name, index) => !ENV_NAME.test(name) || filledNames.indexOf(name) !== index || secretEnv.some((entry) => entry.name === name))) return
    const record = Object.fromEntries(filled.map((row) => [row.name.trim(), row.value]))
    if (JSON.stringify(record) !== stored) onChange({ env: record })
  }
  const update = (index: number, patch: Partial<Row>): void => setRows((current) => current.map((row, at) => at === index ? { ...row, ...patch } : row))
  const remove = (index: number): void => {
    const next = rows.filter((_, at) => at !== index)
    setRows(next)
    commit(next)
  }

  const bindSecret = async (): Promise<void> => {
    const name = secretName.trim()
    if (!ENV_NAME.test(name) || !secretValue || names.includes(name) || secretEnv.some((entry) => entry.name === name)) {
      setError(tSettings('adeSettings.acpFormSecretInvalid'))
      return
    }
    const store = getProvider().storeHarnessSecret
    if (!store) { setError(tSettings('adeSettings.acpFormProbeUnavailable')); return }
    setBusy(true)
    setError('')
    try {
      const secretRef = await store(secretValue)
      onChange({ secretEnv: [...secretEnv, { name, secretRef }] })
      setSecretName(''); setSecretValue(''); setAdding(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const removeSecret = (entry: KunHarnessSecretEnvEntryV1): void => {
    onChange({ secretEnv: secretEnv.filter((candidate) => candidate.name !== entry.name) })
    // Best effort: an orphaned credential is harmless, the setting is already gone.
    void getProvider().deleteHarnessSecret?.(entry.secretRef).catch(() => undefined)
  }

  const iconButton = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/40'
  return <div className="w-full space-y-2" data-agent-env-table>
    {rows.map((row, index) => <div key={index} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_32px] items-center gap-2" data-agent-env-row>
      <input className={inputClass} value={row.name} spellCheck={false} aria-label={t('agentCenter.launch.envName')} aria-invalid={invalid(index) || undefined}
        placeholder="NAME" onChange={(event) => update(index, { name: event.target.value.toUpperCase() })} onBlur={() => commit(rows)} />
      <input className={inputClass} value={row.value} spellCheck={false} aria-label={t('agentCenter.launch.envValue')}
        placeholder={t('agentCenter.launch.envValue')} onChange={(event) => update(index, { value: event.target.value })} onBlur={() => commit(rows)} />
      <button type="button" className={iconButton} aria-label={t('agentCenter.launch.removeVariable', { name: row.name || '…' })} onClick={() => remove(index)}><X aria-hidden size={14} /></button>
    </div>)}
    {secretEnv.map((entry) => <div key={entry.name} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_32px] items-center gap-2" data-agent-secret-row={entry.name}>
      <span className="flex h-9 items-center truncate rounded-xl border border-ds-border-muted bg-ds-subtle px-3 font-mono text-[12px] text-ds-ink">{entry.name}</span>
      <span className="flex h-9 items-center gap-1.5 rounded-xl border border-ds-border-muted bg-ds-subtle px-3 text-[12px] text-ds-muted"><Lock aria-hidden size={12} />{t('agentCenter.launch.stored')}</span>
      <button type="button" className={iconButton} aria-label={t('agentCenter.launch.removeVariable', { name: entry.name })} onClick={() => removeSecret(entry)}><X aria-hidden size={14} /></button>
    </div>)}
    {adding ? <form className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2" onSubmit={(event) => { event.preventDefault(); void bindSecret() }}>
      <input className={inputClass} value={secretName} spellCheck={false} aria-label={t('agentCenter.launch.envName')} placeholder="NAME" autoFocus
        onChange={(event) => setSecretName(event.target.value.toUpperCase())} />
      <input className={inputClass} type="password" value={secretValue} autoComplete="off" aria-label={t('agentCenter.launch.secretValue')}
        placeholder={t('agentCenter.launch.secretValue')} onChange={(event) => setSecretValue(event.target.value)} />
      <span className="flex gap-1.5">
        <button type="submit" disabled={busy || !secretName.trim() || !secretValue} aria-busy={busy}
          className="h-9 rounded-xl bg-control px-3 text-[12px] font-medium text-control-foreground disabled:opacity-45">{t('agentCenter.launch.saveSecret')}</button>
        <button type="button" onClick={() => { setAdding(false); setSecretName(''); setSecretValue(''); setError('') }}
          className="h-9 rounded-xl border border-ds-border-muted px-3 text-[12px] text-ds-muted hover:bg-ds-hover">{t('agentCenter.cancel')}</button>
      </span>
    </form> : null}
    {error ? <p role="alert" className="text-[11px] text-ds-status-danger">{error}</p> : null}
    {rows.some((_, index) => invalid(index)) ? <p role="alert" className="text-[11px] text-ds-status-danger">{tSettings('adeSettings.acpFormEnvInvalid')}</p> : null}
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <button type="button" onClick={() => setRows((current) => [...current, { name: '', value: '' }])} data-agent-env-add
        className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"><Plus aria-hidden size={12} />{t('agentCenter.launch.addVariable')}</button>
      <button type="button" onClick={() => setAdding(true)} disabled={adding} data-agent-secret-add
        className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline disabled:opacity-50"><Plus aria-hidden size={12} />{t('agentCenter.launch.addSecret')}</button>
      <span className="text-[11px] text-ds-faint">{tSettings('adeSettings.acpFormSecretHint')}</span>
    </div>
  </div>
}
