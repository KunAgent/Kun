import { settingsButtonClass } from './settings-button'
import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Keyboard, RotateCcw, Search } from 'lucide-react'
import {
  KEYBOARD_SHORTCUT_COMMANDS,
  findKeyboardShortcutConflict,
  keyboardEventToShortcut,
  normalizeKeyboardShortcuts,
  resolveKeyboardShortcutBindings,
  type KeyboardShortcutCommandId
} from '@shared/app-settings'
import { InlineNoticeView, SettingsCard } from './settings-controls'

export function KeyboardShortcutsSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { t, form, update } = ctx
  const [query, setQuery] = useState('')
  const [capturingCommandId, setCapturingCommandId] = useState<KeyboardShortcutCommandId | null>(null)
  const [notice, setNotice] = useState<{ tone: 'error' | 'info'; message: string } | null>(null)
  const shortcutPlatform = typeof window === 'undefined' ? undefined : window.kunGui?.platform
  const normalized = useMemo(() => normalizeKeyboardShortcuts(form.keyboardShortcuts), [form.keyboardShortcuts])
  const effectiveBindings = useMemo(
    () => resolveKeyboardShortcutBindings(form.keyboardShortcuts, shortcutPlatform),
    [form.keyboardShortcuts, shortcutPlatform]
  )

  const commandLabel = useCallback((commandId: KeyboardShortcutCommandId): string => {
    const command = KEYBOARD_SHORTCUT_COMMANDS.find((item) => item.id === commandId)
    return command ? t(command.labelKey) : commandId
  }, [t])

  const filteredCommands = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return KEYBOARD_SHORTCUT_COMMANDS
    return KEYBOARD_SHORTCUT_COMMANDS.filter((command) => {
      const haystack = [
        command.id,
        t(command.labelKey),
        t(command.descriptionKey),
        ...effectiveBindings[command.id]
      ].join(' ').toLowerCase()
      return haystack.includes(needle)
    })
  }, [effectiveBindings, query, t])

  const updateBinding = useCallback((commandId: KeyboardShortcutCommandId, shortcuts: string[]): void => {
    update({
      keyboardShortcuts: {
        bindings: {
          ...normalized.bindings,
          [commandId]: shortcuts
        }
      }
    })
  }, [normalized.bindings, update])

  useEffect(() => {
    if (!capturingCommandId) return

    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape' && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
        setCapturingCommandId(null)
        setNotice(null)
        return
      }
      const shortcut = keyboardEventToShortcut(event)
      if (!shortcut) return
      const conflictId = findKeyboardShortcutConflict(effectiveBindings, capturingCommandId, shortcut)
      if (conflictId) {
        setNotice({
          tone: 'error',
          message: t('shortcutConflict', { command: commandLabel(conflictId) })
        })
        return
      }
      updateBinding(capturingCommandId, [shortcut])
      setCapturingCommandId(null)
      setNotice(null)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [capturingCommandId, commandLabel, effectiveBindings, t, updateBinding])

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 py-2 shadow-sm">
        <Search className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.75} />
        <input
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ds-ink placeholder:text-ds-faint focus:outline-none"
          value={query}
          placeholder={t('shortcutSearchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Keyboard className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.75} />
      </div>
      {notice ? (
        <div className="mb-3">
          <InlineNoticeView notice={notice} />
        </div>
      ) : null}
      <SettingsCard title={t('keyboardShortcuts')}>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(180px,240px)_40px] gap-3 border-b border-ds-border-muted px-3 py-3 text-[12px] font-semibold text-ds-muted">
          <div>{t('shortcutCommandColumn')}</div>
          <div>{t('shortcutBindingColumn')}</div>
          <div aria-hidden />
        </div>
        <div className="divide-y divide-ds-border-muted">
          {filteredCommands.map((command) => {
            const shortcuts = effectiveBindings[command.id]
            const capturing = capturingCommandId === command.id
            return (
              <div
                key={command.id}
                className="grid grid-cols-[minmax(0,1fr)_minmax(180px,240px)_40px] items-center gap-3 px-3 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-medium text-ds-ink">{t(command.labelKey)}</div>
                  <div className="mt-0.5 truncate text-[12px] text-ds-muted">{t(command.descriptionKey)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCapturingCommandId(command.id)
                    setNotice({ tone: 'info', message: t('shortcutCaptureHint') })
                  }}
                  className={`flex min-h-9 w-full items-center gap-1.5 rounded-xl border px-3 py-1.5 text-left transition ${
                    capturing
                      ? 'border-accent/50 bg-accent/10 text-accent'
                      : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                  }`}
                >
                  {capturing ? (
                    <span className="text-[13px] font-medium">{t('shortcutRecording')}</span>
                  ) : shortcuts.length > 0 ? (
                    shortcuts.map((shortcut) => (
                      <span
                        key={shortcut}
                        className="rounded-full bg-ds-subtle px-2 py-0.5 text-[12px] font-medium text-ds-ink"
                      >
                        {shortcut}
                      </span>
                    ))
                  ) : (
                    <span className="text-[13px]">{t('shortcutUnassigned')}</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => updateBinding(command.id, [])}
                  className={settingsButtonClass({ variant: 'ghost', size: 'icon' })}
                  aria-label={t('shortcutReset')}
                  title={t('shortcutReset')}
                >
                  <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>
            )
          })}
        </div>
      </SettingsCard>
    </div>
  )
}
