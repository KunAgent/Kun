import { useState, type ReactElement } from 'react'
import { Plus } from 'lucide-react'
import type {
  KunHarnessCustomEntryV1,
  KunHarnessSettingsV1
} from '@shared/app-settings'

type T = (key: string, options?: Record<string, unknown>) => string

/**
 * Inline "add custom ACP agent" form (docs/ade/impl/p4 §3.7 first pass —
 * P4-12 adds the test-before-save handshake, `secretEnv` references, and
 * JSON import/export). Persists under agents.kun.harnesses.custom.
 */
export function AgentCenterCustomForm({
  settings,
  updateKun,
  t
}: {
  settings: KunHarnessSettingsV1
  updateKun: (patch: { harnesses?: Partial<KunHarnessSettingsV1> }) => void
  t: T
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
