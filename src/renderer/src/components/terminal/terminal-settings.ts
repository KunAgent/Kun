import { useEffect, useState } from 'react'
import type { TerminalSettingsV1 } from '@shared/app-settings'
import { defaultTerminalSettings, normalizeTerminalSettings } from '@shared/app-settings-terminal'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { SETTINGS_CHANGED_EVENT } from '../../lib/keyboard-shortcut-settings'

/** Live terminal settings: loaded once, then kept current by settings saves. */
let current: TerminalSettingsV1 = defaultTerminalSettings()
let loaded = false
const listeners = new Set<(settings: TerminalSettingsV1) => void>()

function publish(next: TerminalSettingsV1 | undefined): void {
  if (!next) return
  current = normalizeTerminalSettings(next)
  for (const listener of listeners) listener(current)
}

function ensureLoaded(): void {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  void rendererRuntimeClient.getSettings().then((settings) => publish(settings?.terminal)).catch(() => undefined)
  window.addEventListener(SETTINGS_CHANGED_EVENT, (event) => {
    publish((event as CustomEvent<{ terminal?: TerminalSettingsV1 }>).detail?.terminal)
  })
}

export function currentTerminalSettings(): TerminalSettingsV1 {
  ensureLoaded()
  return current
}

export function useTerminalSettings(): TerminalSettingsV1 {
  const [settings, setSettings] = useState(currentTerminalSettings)
  useEffect(() => {
    ensureLoaded()
    listeners.add(setSettings)
    setSettings(current)
    return () => { listeners.delete(setSettings) }
  }, [])
  return settings
}
