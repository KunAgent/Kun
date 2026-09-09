/**
 * Keeps the Speak answer action in sync with its settings toggle.
 *
 * Every assistant bubble renders a Speak button, so the settings read is shared
 * through one module-level subscription instead of one IPC call per bubble.
 */
import { useEffect } from 'react'
import type { AppSettingsV1 } from '@shared/app-settings'
import { defaultKunSpeakSettings, getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { SETTINGS_CHANGED_EVENT } from '../../lib/keyboard-shortcut-settings'
import { useSpeakStore } from '../../stores/speak-store'

export function speakEnabledFromApp(settings: AppSettingsV1): boolean {
  return getKunRuntimeSettings(settings).speak?.enabled ?? defaultKunSpeakSettings().enabled
}

let watching = false

/**
 * Start the single settings subscription behind the Speak action. Repeat calls
 * are ignored, so mounting any number of bubbles costs one read.
 */
export function ensureSpeakEnabledWatcher(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  const apply = (settings: AppSettingsV1 | undefined): void => {
    if (settings) useSpeakStore.getState().setEnabled(speakEnabledFromApp(settings))
  }
  if (typeof window.kunGui?.getSettings === 'function') {
    void window.kunGui.getSettings().then(apply).catch(() => undefined)
  }
  window.addEventListener(SETTINGS_CHANGED_EVENT, (event) => {
    apply((event as CustomEvent<AppSettingsV1>).detail)
  })
}

/** `null` while the first settings read is still in flight. */
export function useSpeakEnabled(): boolean | null {
  const enabled = useSpeakStore((state) => state.enabled)
  useEffect(() => {
    ensureSpeakEnabledWatcher()
  }, [])
  return enabled
}
