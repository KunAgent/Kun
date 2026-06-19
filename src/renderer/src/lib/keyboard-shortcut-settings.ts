import { useEffect, useState } from 'react'
import {
  defaultKeyboardShortcuts,
  normalizeKeyboardShortcuts,
  type AppSettingsV1,
  type KeyboardShortcutsConfigV1
} from '@shared/app-settings'

export const SETTINGS_CHANGED_EVENT = 'kun:settings-changed'

export function emitRendererSettingsChanged(settings: AppSettingsV1): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new CustomEvent<AppSettingsV1>(SETTINGS_CHANGED_EVENT, { detail: settings }))
}

export function useKeyboardShortcutSettings(): KeyboardShortcutsConfigV1 {
  const [shortcuts, setShortcuts] = useState<KeyboardShortcutsConfigV1>(() => defaultKeyboardShortcuts())

  useEffect(() => {
    let cancelled = false
    const apply = (settings: AppSettingsV1): void => {
      if (!cancelled) setShortcuts(normalizeKeyboardShortcuts(settings.keyboardShortcuts))
    }

    if (typeof window.kunGui?.getSettings === 'function') {
      void window.kunGui.getSettings().then(apply).catch(() => undefined)
    }

    const onSettingsChanged = (event: Event): void => {
      apply((event as CustomEvent<AppSettingsV1>).detail)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    }
  }, [])

  return shortcuts
}
