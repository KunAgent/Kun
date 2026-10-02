import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { KunHarnessSettingsV1, KunTerminalAgentEntryV1 } from '@shared/app-settings'
import { useHarnessStore } from '../../store/harness-store'

const DRAFT_KEY = 'kun-agent-terminal-draft-v1'

type Draft = { name?: string; command?: string; args?: string; taskFlag?: string }

function readDraft(): Draft {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) ?? '{}') as Draft }
  catch { return {} }
}

export function terminalAgentId(name: string): string {
  return `terminal-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'}`.slice(0, 48)
}

/** Terminal agents are saved as terminal-only; this form never claims ACP readiness. */
export function AgentCenterTerminalForm({
  settings,
  updateKun,
  onSaved,
  t
}: {
  settings: KunHarnessSettingsV1
  updateKun: (patch: { harnesses?: Partial<KunHarnessSettingsV1> }) => void
  onSaved: (id: string) => void
  t: (key: string, options?: Record<string, unknown>) => string
}): ReactElement {
  const [initial] = useState(readDraft)
  const [name, setName] = useState(initial.name ?? '')
  const [command, setCommand] = useState(initial.command ?? '')
  const [args, setArgs] = useState(initial.args ?? '')
  const [taskFlag, setTaskFlag] = useState(initial.taskFlag ?? '')
  const [error, setError] = useState('')
  const saveSubmitted = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try { window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ name, command, args, taskFlag })) }
    catch { /* Editing still works if session storage is blocked. */ }
  }, [name, command, args, taskFlag])

  const save = (): void => {
    if (saveSubmitted.current) return
    const displayName = name.trim()
    const binary = command.trim()
    if (!displayName || !binary) return
    const id = terminalAgentId(displayName)
    if (settings.terminalAgents.some((entry) => entry.id === id) ||
      settings.custom.some((entry) => entry.id === id) ||
      useHarnessStore.getState().rows.some((row) => row.definition.id === id)) {
      setError(t('agentAdd.duplicate'))
      return
    }
    const entry: KunTerminalAgentEntryV1 = {
      id,
      displayName,
      command: binary,
      args: args.trim() ? args.trim().split(/\s+/u) : [],
      ...(taskFlag.trim() ? { taskFlag: taskFlag.trim() } : {})
    }
    saveSubmitted.current = true
    try {
      updateKun({ harnesses: { ...settings, terminalAgents: [...settings.terminalAgents, entry] } })
      onSaved(id)
    } catch (cause) {
      saveSubmitted.current = false
      setError(cause instanceof Error ? cause.message : String(cause))
      return
    }
    setName('')
    setCommand('')
    setArgs('')
    setTaskFlag('')
    setError('')
    if (typeof window !== 'undefined') {
      try { window.sessionStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
    }
  }

  const inputClass = 'w-full rounded-lg border border-ds-border bg-ds-card px-3 py-2 text-[12px] text-ds-ink focus:border-accent/50 focus:outline-none'
  return (
    <div className="space-y-2.5" data-agent-terminal-form>
      <p className="text-[12px] text-ds-muted">{t('agentAdd.terminalOnly')}</p>
      <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder={t('agentAdd.terminalName')} data-terminal-name />
      <div className="flex gap-2">
        <input className={`${inputClass} font-mono`} value={command} onChange={(event) => setCommand(event.target.value)} placeholder={t('agentAdd.terminalCommand')} data-terminal-command />
        <button data-settings-action="secondary" data-settings-size="default" type="button" onClick={() => void window.kunGui?.pickLocalFiles?.().then((picked) => {
          const path = picked?.paths?.[0]
          if (path) setCommand(path)
        })} className="shrink-0 rounded-lg border border-ds-border px-2 text-[11px] text-ds-muted hover:bg-ds-hover">
          {t('agentAdd.pickCommand')}
        </button>
      </div>
      <input className={`${inputClass} font-mono`} value={args} onChange={(event) => setArgs(event.target.value)} placeholder={t('agentAdd.terminalArgs')} data-terminal-args />
      <input className={`${inputClass} font-mono`} value={taskFlag} onChange={(event) => setTaskFlag(event.target.value)} placeholder={t('agentAdd.terminalTaskFlag')} data-terminal-task-flag />
      {error ? <p role="alert" className="text-[12px] text-ds-status-danger">{error}</p> : null}
      <button data-settings-action="primary" data-settings-size="default" type="button" disabled={!name.trim() || !command.trim()} onClick={save} className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-45" data-terminal-save>
        {t('agentAdd.saveUnready')}
      </button>
    </div>
  )
}
