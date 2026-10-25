import type { ReactElement } from 'react'
import type { AdeTaskSuggestionSettings } from '@shared/ade-collaboration-settings'
import { SettingRow, Toggle } from './settings-controls'
import { DISPATCH_AUTO_START_CHOICES, dispatchAutoStartLabel } from './settings-dispatch-auto-start'

/**
 * Suggestion cards (`suggest_tasks`): how long a card waits before starting its
 * tasks (never by default), and the per-task defaults a new card starts with.
 */
export function TaskSuggestionSettingRows({ t, value, onChange }: {
  t: (key: string, options?: Record<string, unknown>) => string
  value: AdeTaskSuggestionSettings
  onChange: (value: AdeTaskSuggestionSettings) => void
}): ReactElement {
  const seconds = value.autoStartSeconds
  const choices: number[] = (DISPATCH_AUTO_START_CHOICES as readonly number[]).includes(seconds)
    ? [...DISPATCH_AUTO_START_CHOICES]
    : [...DISPATCH_AUTO_START_CHOICES.filter((entry) => entry > 0), seconds, 0].sort((a, b) => (a || Infinity) - (b || Infinity))
  return <>
    <SettingRow
      title={t('adeSettings.taskSuggestionAutoStart')}
      description={t('adeSettings.taskSuggestionAutoStartDesc')}
      control={
        <select
          data-task-suggestion-auto-start
          className="min-w-[9rem] rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none"
          value={String(seconds)}
          onChange={(event) => onChange({ ...value, autoStartSeconds: Number(event.target.value) })}
        >
          {choices.map((entry) => <option key={entry} value={String(entry)}>{dispatchAutoStartLabel(t, entry)}</option>)}
        </select>
      }
    />
    <SettingRow
      title={t('adeSettings.taskSuggestionWorktree')}
      description={t('adeSettings.taskSuggestionWorktreeDesc')}
      control={<Toggle checked={value.worktree} ariaLabel={t('adeSettings.taskSuggestionWorktree')}
        onChange={(worktree) => onChange({ ...value, worktree })} />}
    />
    <SettingRow
      title={t('adeSettings.taskSuggestionContext')}
      description={t('adeSettings.taskSuggestionContextDesc')}
      control={<Toggle checked={value.inheritContext} ariaLabel={t('adeSettings.taskSuggestionContext')}
        onChange={(inheritContext) => onChange({ ...value, inheritContext })} />}
    />
  </>
}
