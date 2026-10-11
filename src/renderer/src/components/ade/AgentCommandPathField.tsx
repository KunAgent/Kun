import { useEffect, useState, type ReactElement } from 'react'

type T = (key: string, options?: Record<string, unknown>) => string

const inputClass = 'h-9 w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 font-mono text-[12px] text-ds-ink shadow-sm placeholder:text-ds-faint focus:border-accent focus:outline-none'

/**
 * The command Kun starts for an Agent. Typing is local; the path is saved on
 * Enter or when the field loses focus, so a half-typed path never reaches the
 * runtime. Leaving it empty restores automatic detection.
 */
export function AgentCommandPathField({ value, placeholder, onCommit, t, label, autoFocus = false }: {
  value: string
  placeholder: string
  onCommit: (path: string) => void
  /** common-ns translator. */
  t: T
  /** The accessible name of the field. */
  label: string
  autoFocus?: boolean
}): ReactElement {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = (path: string): void => {
    const next = path.trim()
    if (next !== value) onCommit(next)
  }
  const pick = (): void => {
    void window.kunGui?.pickLocalFiles?.().then((picked) => {
      const path = picked?.paths?.[0]
      if (path) { setDraft(path); commit(path) }
    })
  }
  return <div className="flex w-full min-w-0 items-center gap-2">
    <input data-agent-command-path className={inputClass} value={draft} placeholder={placeholder} spellCheck={false}
      autoFocus={autoFocus} aria-label={label}
      onChange={(event) => setDraft(event.target.value)} onBlur={() => commit(draft)}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(draft) } }} />
    <button type="button" onClick={pick}
      className="h-9 shrink-0 rounded-xl border border-ds-border-muted px-3 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink">
      {t('agentCenter.pickPath')}
    </button>
  </div>
}
