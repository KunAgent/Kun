import { useMemo, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Play, Plus, X } from 'lucide-react'
import type { TerminalAgentProfileV1, TerminalProfileEnvEntryV1 } from '@shared/app-settings'
import { normalizeTerminalProfile, profileCommandLine, TERMINAL_MAX_PROFILE_ENV } from '@shared/app-settings-terminal-dock'
import { useHarnessStore } from '../store/harness-store'
import { settingsButtonClass } from './settings-button'
import { TerminalAgentEntryIcon } from './terminal/TerminalIcon'

type T = (key: string, options?: Record<string, unknown>) => string

function newProfileId(name: string, existing: readonly string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'agent'
  let id = `custom-${base}`
  for (let index = 2; existing.includes(id); index += 1) id = `custom-${base}-${index}`
  return id
}

/** Create or edit a custom Agent command shown in the terminal's new-session menu. */
export function TerminalProfileEditDialog({
  profile,
  existingIds,
  onCancel,
  onSave,
  onDelete,
  onTryRun,
  t
}: {
  profile: TerminalAgentProfileV1 | null
  existingIds: readonly string[]
  onCancel: () => void
  onSave: (profile: TerminalAgentProfileV1) => void
  onDelete?: () => void
  onTryRun: (command: string, name: string) => void
  t: T
}): ReactElement {
  const harnessRows = useHarnessStore((state) => state.rows)
  const [name, setName] = useState(profile?.name ?? '')
  const [command, setCommand] = useState(profile?.command ?? '')
  const [args, setArgs] = useState(profile?.args ?? '')
  const [icon, setIcon] = useState(profile?.icon ?? 'terminal')
  const [cwd, setCwd] = useState(profile?.cwd ?? '')
  const [fixedCwd, setFixedCwd] = useState(Boolean(profile?.cwd))
  const [env, setEnv] = useState<TerminalProfileEnvEntryV1[]>(profile?.env ?? [])
  const iconChoices = useMemo(() => ['terminal', ...harnessRows.filter((row) => row.definition.terminal).map((row) => row.definition.id).slice(0, 6)], [harnessRows])

  const draft = normalizeTerminalProfile({
    id: profile?.id ?? newProfileId(name || command, existingIds),
    name: name.trim(),
    command: command.trim(),
    args,
    icon,
    cwd: fixedCwd ? cwd.trim() : '',
    env
  })
  const invalidCwd = fixedCwd && cwd.trim() !== '' && !draft?.cwd

  const field = 'h-[34px] w-full rounded-[9px] border border-ds-border bg-ds-card px-3 text-[13px] text-ds-ink outline-none focus:border-[var(--ds-accent)]'
  const label = 'mb-1.5 block text-[12.5px] text-ds-muted'

  return createPortal(
    <div className="fixed inset-0 z-[1001] flex items-center justify-center bg-[rgba(20,24,34,0.32)] p-4 dark:bg-[rgba(0,0,0,0.55)]" onPointerDown={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="terminal-profile-title"
        className="flex max-h-[calc(100vh-32px)] w-[600px] max-w-full flex-col overflow-hidden rounded-[18px] bg-ds-card text-ds-ink shadow-[var(--ds-shadow-overlay)]"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (event.key === 'Escape') onCancel() }}
      >
        <div className="flex items-center gap-2.5 px-[22px] pb-1.5 pt-[18px]">
          <h2 id="terminal-profile-title" className="flex-1 text-[16px] font-semibold">{profile ? t('termSetEditAgentTitle') : t('termSetAddAgentTitle')}</h2>
          <button type="button" aria-label={t('termSetClose')} className="rounded-lg p-1.5 text-ds-muted hover:bg-ds-hover" onClick={onCancel}><X className="h-4 w-4" strokeWidth={1.9} /></button>
        </div>
        <div className="flex flex-col gap-4 overflow-y-auto px-[22px] py-2.5">
          <div className="flex gap-3.5">
            <div className="flex-1">
              <label className={label} htmlFor="terminal-profile-name">{t('termSetName')}</label>
              <input id="terminal-profile-name" className={field} value={name} placeholder="Claude Code · acceptEdits" onChange={(event) => setName(event.target.value)} />
            </div>
            <div>
              <span className={label}>{t('termSetIcon')}</span>
              <div className="flex gap-1.5" role="radiogroup" aria-label={t('termSetIcon')}>
                {iconChoices.map((choice) => (
                  <button key={choice} type="button" role="radio" aria-checked={icon === choice} aria-label={choice} onClick={() => setIcon(choice)}
                    className={`inline-flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border bg-ds-card ${icon === choice ? 'border-transparent ring-2 ring-[var(--ds-accent)]' : 'border-ds-border'}`}>
                    <TerminalAgentEntryIcon icon={choice} size={18} />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className={label} htmlFor="terminal-profile-command">{t('termSetCommand')}</label>
            <input id="terminal-profile-command" className={`${field} font-mono`} value={command} placeholder="claude" onChange={(event) => setCommand(event.target.value)} />
          </div>
          <div>
            <div className="mb-1.5 flex items-center">
              <label className="flex-1 text-[12.5px] text-ds-muted" htmlFor="terminal-profile-args">{t('termSetArgs')}</label>
              <button type="button" className={settingsButtonClass({ size: 'compact' })} onClick={() => setArgs((value) => `${value.trimEnd()} ${t('termSetTaskToken')}`.trim())}>
                <Plus className="mr-1 inline h-3 w-3" strokeWidth={2} />{t('termSetInsertTask')}
              </button>
            </div>
            <input id="terminal-profile-args" className={`${field} font-mono`} value={args} placeholder={`--permission-mode acceptEdits ${t('termSetTaskToken')}`} onChange={(event) => setArgs(event.target.value)} />
            <p className="mt-1.5 text-[12px] leading-5 text-ds-muted">{t('termSetArgsHint')}</p>
          </div>
          <div className="flex flex-wrap gap-3.5">
            <div className="min-w-[220px] flex-1">
              <span className={label}>{t('termSetCwd')}</span>
              <div className="inline-flex gap-0.5 rounded-[9px] bg-ds-subtle p-0.5" role="radiogroup" aria-label={t('termSetCwd')}>
                {[false, true].map((fixed) => (
                  <button key={String(fixed)} type="button" role="radio" aria-checked={fixedCwd === fixed} onClick={() => setFixedCwd(fixed)}
                    className={`h-7 rounded-[7px] px-2.5 text-[12.5px] ${fixedCwd === fixed ? 'bg-ds-card text-ds-ink shadow-[0_0_0_1px_var(--ds-border)]' : 'text-ds-muted'}`}>
                    {fixed ? t('termSetCwdFixed') : t('termSetCwdFollow')}
                  </button>
                ))}
              </div>
              {fixedCwd ? (
                <input aria-label={t('termSetCwdFixed')} className={`${field} mt-2 font-mono text-[12px]`} value={cwd} placeholder="/Users/me/projects/app" onChange={(event) => setCwd(event.target.value)} />
              ) : null}
              {invalidCwd ? <p className="mt-1 text-[12px] text-[var(--ds-danger)]">{t('termSetCwdInvalid')}</p> : null}
            </div>
            <div className="min-w-[220px] flex-1">
              <span className={label}>{t('termSetEnv')}</span>
              {env.map((entry, index) => (
                <div key={index} className="mb-1.5 flex gap-1.5">
                  <input aria-label={t('termSetEnvKey')} className={`${field} flex-1 font-mono text-[12px]`} value={entry.key} placeholder="HTTPS_PROXY"
                    onChange={(event) => setEnv((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))} />
                  <input aria-label={t('termSetEnvValue')} className={`${field} flex-[1.4] font-mono text-[12px]`} value={entry.value}
                    onChange={(event) => setEnv((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} />
                  <button type="button" aria-label={t('termSetEnvRemove')} className="rounded-lg px-1.5 text-ds-muted hover:bg-ds-hover" onClick={() => setEnv((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                    <X className="h-3.5 w-3.5" strokeWidth={1.9} />
                  </button>
                </div>
              ))}
              <button type="button" disabled={env.length >= TERMINAL_MAX_PROFILE_ENV} className="text-[12.5px] text-[var(--ds-accent)] disabled:opacity-40" onClick={() => setEnv((current) => [...current, { key: '', value: '' }])}>
                + {t('termSetEnvAdd')}
              </button>
            </div>
          </div>
          <div>
            <span className={label}>{t('termSetWillRun')}</span>
            <div className="rounded-[10px] bg-ds-subtle px-3 py-2 font-mono text-[12px] leading-[1.75] text-ds-ink">
              {draft ? (
                <>
                  <div className="break-all"><span className="inline-block w-20 font-sans text-[11.5px] text-ds-muted">{t('termSetWithTask')}</span>{profileCommandLine(draft, t('termSetSampleTask'))}</div>
                  <div className="break-all"><span className="inline-block w-20 font-sans text-[11.5px] text-ds-muted">{t('termSetWithoutTask')}</span>{profileCommandLine(draft, '')}</div>
                </>
              ) : <span className="font-sans text-ds-muted">{t('termSetIncomplete')}</span>}
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2 border-t border-[var(--ds-border-muted)] px-[22px] pb-5 pt-4">
          {onDelete ? <button type="button" className={settingsButtonClass({ variant: 'danger-ghost' })} onClick={onDelete}>{t('termSetDelete')}</button> : null}
          <span className="flex-1" />
          <button type="button" className={settingsButtonClass()} disabled={!draft} onClick={() => draft && onTryRun(profileCommandLine(draft, ''), draft.name)}>
            <Play className="mr-1 inline h-3 w-3" strokeWidth={2} />{t('termSetTryRun')}
          </button>
          <button type="button" className={settingsButtonClass()} onClick={onCancel}>{t('termSetCancel')}</button>
          <button type="button" className={settingsButtonClass({ variant: 'primary' })} disabled={!draft || invalidCwd} onClick={() => draft && onSave(draft)}>{t('termSetSave')}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
