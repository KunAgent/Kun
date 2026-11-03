import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import type { TerminalAgentProfileV1, TerminalSettingsV1 } from '@shared/app-settings'
import { loadHarnesses, useHarnessStore } from '../store/harness-store'
import { settingsButtonClass } from './settings-button'
import { SettingsCard, Toggle } from './settings-controls'
import { moveAgent, terminalAgentEntries, type TerminalAgentEntry } from './terminal/terminal-agent-catalog'
import { TerminalAgentEntryIcon } from './terminal/TerminalIcon'
import { openTerminal } from './terminal/terminal-open'
import { TerminalProfileEditDialog } from './TerminalProfileEditDialog'

type T = (key: string, options?: Record<string, unknown>) => string
type Update = (patch: { terminal: Record<string, unknown> }) => void

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: string }): ReactElement {
  const style = tone === 'ok'
    ? { background: 'var(--ds-success-soft)', color: 'color-mix(in srgb, var(--ds-success) 90%, black)' }
    : tone === 'warn'
      ? { background: 'var(--ds-warning-soft)', color: 'color-mix(in srgb, var(--ds-warning) 72%, black)' }
      : { background: 'var(--ds-surface-subtle)', color: 'var(--ds-text-muted)' }
  return <span className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md px-1.5 text-[11.5px]" style={style}>{children}</span>
}

export function TerminalAgentsCard({ terminal, update, openSettingsCategory, t }: {
  terminal: TerminalSettingsV1
  update: Update
  openSettingsCategory?: (category: string) => void
  t: T
}): ReactElement {
  const rows = useHarnessStore((state) => state.rows)
  const [editing, setEditing] = useState<TerminalAgentProfileV1 | 'new' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => { void loadHarnesses(false) }, [])
  const entries = useMemo(() => terminalAgentEntries(rows, terminal), [rows, terminal])

  const setHidden = (entry: TerminalAgentEntry, visible: boolean): void => {
    const hidden = new Set(terminal.hiddenAgentIds)
    if (visible) hidden.delete(entry.id)
    else hidden.add(entry.id)
    update({ terminal: { hiddenAgentIds: [...hidden] } })
  }
  const move = (entry: TerminalAgentEntry, direction: -1 | 1): void => {
    update({ terminal: { agentOrder: moveAgent(entries, entry.id, direction) } })
  }
  const saveProfile = (profile: TerminalAgentProfileV1): void => {
    const exists = terminal.profiles.some((candidate) => candidate.id === profile.id)
    update({ terminal: { profiles: exists ? terminal.profiles.map((candidate) => candidate.id === profile.id ? profile : candidate) : [...terminal.profiles, profile] } })
    setEditing(null)
  }
  const removeProfile = (id: string): void => {
    update({
      terminal: {
        profiles: terminal.profiles.filter((profile) => profile.id !== id),
        hiddenAgentIds: terminal.hiddenAgentIds.filter((hidden) => hidden !== id),
        agentOrder: terminal.agentOrder.filter((ordered) => ordered !== id)
      }
    })
    setEditing(null)
  }

  return (
    <SettingsCard title={t('termSetAgentsTitle')} description={t('termSetAgentsDesc')}>
      <div className="divide-y divide-[var(--ds-border-muted)]">
        {entries.map((entry, index) => (
          <div key={entry.id} className="flex items-center gap-3 py-2.5">
            <div className="flex shrink-0 flex-col">
              <button type="button" className="rounded p-0.5 text-ds-muted hover:text-ds-ink disabled:opacity-30" aria-label={t('termSetMoveUp')} disabled={index === 0} onClick={() => move(entry, -1)}>
                <ArrowUp className="h-3 w-3" strokeWidth={2} />
              </button>
              <button type="button" className="rounded p-0.5 text-ds-muted hover:text-ds-ink disabled:opacity-30" aria-label={t('termSetMoveDown')} disabled={index === entries.length - 1} onClick={() => move(entry, 1)}>
                <ArrowDown className="h-3 w-3" strokeWidth={2} />
              </button>
            </div>
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center"><TerminalAgentEntryIcon icon={entry.icon} size={22} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13.5px] text-ds-ink">
                <span className="truncate">{entry.name}</span>
                {!entry.builtin ? <Badge tone="muted">{t('termSetCustom')}</Badge> : null}
              </div>
              <div className="truncate font-mono text-[12px] text-ds-muted">
                {entry.kind === 'harness' ? (entry.harness?.definition.terminal?.argv.join(' ') || entry.id) + (entry.harness?.definition.terminal?.taskFlag ? ` ${entry.harness.definition.terminal.taskFlag}` : '') + ` ${t('termSetTaskToken')}` : entry.detail}
              </div>
            </div>
            {entry.kind === 'harness'
              ? entry.needsLogin
                ? <Badge tone="warn">{t('termSetNeedsLogin')}</Badge>
                : <Badge tone="ok">{entry.detail ? t('termSetInstalledVersion', { version: entry.detail }) : t('termSetInstalled')}</Badge>
              : entry.builtin ? <Badge tone="muted">{t('termSetBundled')}</Badge> : null}
            {entry.needsLogin && entry.loginCommand ? (
              <button type="button" className={settingsButtonClass({ size: 'compact' })} onClick={() => {
                openTerminal({ prefill: entry.loginCommand, probeHarnessId: entry.id, title: entry.name })
                setNotice(t('termSetOpenedInTerminal'))
              }}>{t('termSetLoginInTerminal')}</button>
            ) : (
              <Toggle checked={!entry.hidden} onChange={(visible) => setHidden(entry, visible)} ariaLabel={t('termSetShowInMenu', { name: entry.name })} />
            )}
            <button
              type="button"
              className={settingsButtonClass({ size: 'compact' })}
              disabled={entry.builtin && entry.kind === 'profile'}
              onClick={() => entry.kind === 'harness' ? openSettingsCategory?.('harnesses') : entry.profile && setEditing(entry.profile)}
            >
              {t('termSetEdit')}
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-[var(--ds-border-muted)] pt-3">
        <button type="button" className={settingsButtonClass()} onClick={() => setEditing('new')}>
          <Plus className="mr-1 inline h-3.5 w-3.5" strokeWidth={2} />{t('termSetAddAgent')}
        </button>
        {notice ? <span className="text-[12px] text-ds-muted" role="status">{notice}</span> : null}
      </div>
      {editing ? (
        <TerminalProfileEditDialog
          profile={editing === 'new' ? null : editing}
          existingIds={terminal.profiles.map((profile) => profile.id)}
          onCancel={() => setEditing(null)}
          onSave={saveProfile}
          onDelete={editing === 'new' ? undefined : () => removeProfile(editing.id)}
          onTryRun={(command, name) => {
            openTerminal({ command, title: name })
            setNotice(t('termSetOpenedInTerminal'))
          }}
          t={t}
        />
      ) : null}
    </SettingsCard>
  )
}
