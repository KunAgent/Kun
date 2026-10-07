import { settingsButtonClass } from './settings-button'
import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Keyboard, RotateCcw, Search, SearchX } from 'lucide-react'
import {
  KEYBOARD_SHORTCUT_COMMANDS,
  findKeyboardShortcutConflict,
  keyboardEventToShortcut,
  normalizeKeyboardShortcuts,
  resolveKeyboardShortcutBindings,
  type KeyboardShortcutCommandId
} from '@shared/app-settings'
import { InlineNoticeView, SettingsCard } from './settings-controls'

const MAC_KEY_SYMBOLS: Record<string, string> = { Meta: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }

/** Splits `Ctrl+Shift+I` into keycaps while keeping a literal trailing `+` key (`Ctrl++`). */
export function shortcutKeycaps(shortcut: string, platform?: string): string[] {
  const keys = shortcut.match(/[^+]+|\+(?=$)/g) ?? [shortcut]
  return platform === 'darwin' ? keys.map((key) => MAC_KEY_SYMBOLS[key] ?? key) : keys
}

function ShortcutKeycaps({ shortcut, platform }: { shortcut: string; platform?: string }): ReactElement {
  return (
    <span className="ds-shortcut-combo" title={shortcut}>
      {shortcutKeycaps(shortcut, platform).map((key, index) => (
        <kbd key={`${key}-${index}`} className="ds-shortcut-key">{key}</kbd>
      ))}
    </span>
  )
}

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
    <div className="ds-settings-panel-stack">
      <label className="ds-shortcut-search">
        <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.9} />
        <input
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ds-ink placeholder:text-ds-faint focus:outline-none"
          value={query}
          aria-label={t('shortcutSearchPlaceholder')}
          placeholder={t('shortcutSearchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="ds-shortcut-count" aria-hidden="true">
          <Keyboard className="h-3.5 w-3.5" strokeWidth={1.9} />
          {filteredCommands.length}
        </span>
      </label>
      {notice ? <InlineNoticeView notice={notice} /> : null}
      <SettingsCard title={t('keyboardShortcuts')}>
        {filteredCommands.length === 0 ? (
          <div role="status" className="ds-shortcut-empty">
            <SearchX aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
            <span>{t('settingsSearchEmpty')}</span>
          </div>
        ) : null}
        {filteredCommands.map((command) => {
          const shortcuts = effectiveBindings[command.id]
          const capturing = capturingCommandId === command.id
          const label = t(command.labelKey)
          return (
            <div key={command.id} className="ds-shortcut-row">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium leading-5 text-ds-ink">{label}</div>
                <div className="mt-0.5 text-[12px] leading-[1.45] text-ds-muted">{t(command.descriptionKey)}</div>
              </div>
              <button
                type="button"
                aria-label={`${label}: ${capturing ? t('shortcutRecording') : shortcuts.join(', ') || t('shortcutUnassigned')}`}
                data-capturing={capturing ? 'true' : undefined}
                onClick={() => {
                  setCapturingCommandId(command.id)
                  setNotice({ tone: 'info', message: t('shortcutCaptureHint') })
                }}
                className="ds-shortcut-binding"
              >
                {capturing ? (
                  <span className="ds-shortcut-recording">
                    <span aria-hidden="true" className="ds-shortcut-recording-dot" />
                    {t('shortcutRecording')}
                  </span>
                ) : shortcuts.length > 0 ? (
                  shortcuts.map((shortcut) => (
                    <ShortcutKeycaps key={shortcut} shortcut={shortcut} platform={shortcutPlatform} />
                  ))
                ) : (
                  <span className="text-[12px] text-ds-faint">{t('shortcutUnassigned')}</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => updateBinding(command.id, [])}
                className={settingsButtonClass({ variant: 'ghost', size: 'icon' })}
                aria-label={`${t('shortcutReset')}: ${label}`}
                title={t('shortcutReset')}
              >
                <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          )
        })}
      </SettingsCard>
    </div>
  )
}
