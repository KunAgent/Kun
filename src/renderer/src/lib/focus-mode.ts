import { readBrowserStorageItem, writeBrowserStorageItem } from './browser-storage'

export const FOCUS_MODE_STORAGE_KEY = 'kun.focusMode'

export function readFocusModePreference(): boolean {
  const value = readBrowserStorageItem(FOCUS_MODE_STORAGE_KEY)?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'on'
}

export function writeFocusModePreference(enabled: boolean): void {
  writeBrowserStorageItem(FOCUS_MODE_STORAGE_KEY, enabled ? '1' : '0')
}

export const FOCUS_SWITCH_PULSE_ATTRIBUTE = 'data-focus-switch-pulse'
const FOCUS_SWITCH_PULSE_MS = 2_600
let pulseTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Rings the sidebar Focus switch for a moment so a guide can show where it
 * lives (sidebar-focus-switch.css draws the ring).
 */
export function pulseFocusModeSwitch(durationMs = FOCUS_SWITCH_PULSE_MS): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.setAttribute(FOCUS_SWITCH_PULSE_ATTRIBUTE, 'on')
  if (pulseTimer) clearTimeout(pulseTimer)
  pulseTimer = setTimeout(() => {
    pulseTimer = null
    root.removeAttribute(FOCUS_SWITCH_PULSE_ATTRIBUTE)
  }, durationMs)
}
