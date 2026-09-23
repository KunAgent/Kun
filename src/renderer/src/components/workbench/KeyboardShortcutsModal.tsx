import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Keyboard, Search, X } from 'lucide-react'
import {
  KEYBOARD_SHORTCUT_COMMANDS,
  resolveKeyboardShortcutBindings
} from '@shared/keyboard-shortcuts'
import { useKeyboardShortcutSettings } from '../../lib/keyboard-shortcut-settings'

const MAC_GLYPHS: Record<string, string> = {
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Meta: '⌘'
}

/** Renders a normalized `Ctrl+Shift+K` binding as platform keycap tokens. */
export function shortcutKeycapTokens(shortcut: string, mac: boolean): string[] {
  return shortcut.split('+').map((part) => {
    if (mac && MAC_GLYPHS[part]) return MAC_GLYPHS[part]
    if (part === 'Meta') return 'Win'
    if (part === 'Escape') return 'Esc'
    if (part === 'ArrowUp') return '↑'
    if (part === 'ArrowDown') return '↓'
    if (part === 'ArrowLeft') return '←'
    if (part === 'ArrowRight') return '→'
    if (part === '`') return '`'
    return part
  })
}

/**
 * `Shift+?` cheatsheet: a searchable, read-only mirror of the shortcut
 * registry so users can discover chords without opening Settings. Rebinding
 * still lives in Settings -> Keyboard shortcuts.
 */
export function KeyboardShortcutsModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): ReactElement | null {
  const { t: tSettings } = useTranslation('settings')
  const { t } = useTranslation('common')
  const settings = useKeyboardShortcutSettings()
  const platform = typeof window === 'undefined' ? undefined : window.kunGui?.platform
  const mac = platform === 'darwin'
  const bindings = useMemo(
    () => resolveKeyboardShortcutBindings(settings, platform),
    [settings, platform]
  )
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, onClose])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return KEYBOARD_SHORTCUT_COMMANDS
    return KEYBOARD_SHORTCUT_COMMANDS.filter((command) =>
      [
        command.id,
        tSettings(command.labelKey),
        tSettings(command.descriptionKey),
        ...bindings[command.id]
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    )
  }, [bindings, query, tSettings])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/30 px-4 pt-[12vh] backdrop-blur-[2px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tSettings('shortcutModalTitle')}
        className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-[0_24px_64px_rgba(15,23,42,0.28)]"
      >
        <div className="flex items-center gap-2 border-b border-ds-border-muted px-4 py-3">
          <Keyboard className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.75} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tSettings('shortcutModalSearchPlaceholder')}
            aria-label={tSettings('shortcutModalSearchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ds-ink outline-none placeholder:text-ds-faint"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            title={t('close')}
            className="rounded-md p-1 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-ds-faint">
              {tSettings('shortcutModalEmpty')}
            </p>
          ) : (
            <ul className="flex flex-col">
              {filtered.map((command) => {
                const shortcuts = bindings[command.id]
                return (
                  <li
                    key={command.id}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium text-ds-ink">
                        {tSettings(command.labelKey)}
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-ds-muted">
                        {tSettings(command.descriptionKey)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {shortcuts.length > 0 ? (
                        shortcuts.map((shortcut) => (
                          <span key={shortcut} className="flex items-center gap-0.5">
                            {shortcutKeycapTokens(shortcut, mac).map((token, tokenIndex) => (
                              <kbd
                                key={`${shortcut}-${tokenIndex}`}
                                className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-ds-border bg-ds-subtle px-1.5 text-[11.5px] font-semibold text-ds-muted shadow-[0_1px_0_rgba(15,23,42,0.08)]"
                              >
                                {token}
                              </kbd>
                            ))}
                          </span>
                        ))
                      ) : (
                        <span className="text-[12px] text-ds-faint">
                          {tSettings('shortcutUnassigned')}
                        </span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="border-t border-ds-border-muted px-4 py-2 text-[11.5px] text-ds-faint">
          {tSettings('shortcutModalFooter')}
        </div>
      </div>
    </div>
  )
}
