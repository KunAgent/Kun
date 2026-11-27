import { app, globalShortcut } from 'electron'
import {
  resolveKeyboardShortcutBindings,
  type KeyboardShortcutsConfigV1
} from '../../shared/keyboard-shortcuts'

let registeredAccelerator: string | null = null
let toggleHandler: (() => Promise<unknown>) | null = null
let cleanupBound = false

export function toElectronAccelerator(shortcut: string | null | undefined): string | null {
  if (!shortcut) return null
  const parts = shortcut.split('+').map(part => part.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const mapped = parts.map(part => {
    if (part === 'Meta') return process.platform === 'darwin' ? 'Command' : 'Super'
    if (part === 'Ctrl') return 'Control'
    if (part === 'ArrowUp') return 'Up'
    if (part === 'ArrowDown') return 'Down'
    if (part === 'ArrowLeft') return 'Left'
    if (part === 'ArrowRight') return 'Right'
    if (part === '+') return 'Plus'
    return part
  })
  return mapped.join('+')
}

function unregisterCurrent(): void {
  if (!registeredAccelerator) return
  try {
    globalShortcut.unregister(registeredAccelerator)
  } catch { /* ignore shutdown races */ }
  registeredAccelerator = null
}

export function setDailyNotesToggleHandler(handler: (() => Promise<unknown>) | null): void {
  toggleHandler = handler
}

export function syncDailyNotesGlobalShortcut(
  settings?: Partial<KeyboardShortcutsConfigV1> | null
): void {
  if (process.env.VITEST || process.env.KUN_PACKAGED_EXTENSION_DESKTOP_SMOKE === '1') return
  if (!app.isReady()) return

  if (!cleanupBound) {
    cleanupBound = true
    app.once('will-quit', unregisterCurrent)
  }

  const resolved = resolveKeyboardShortcutBindings(settings, process.platform)['toggle-daily-notes']?.[0] ?? null
  const nextAccelerator = toggleHandler ? toElectronAccelerator(resolved) : null
  if (nextAccelerator === registeredAccelerator) return

  unregisterCurrent()
  if (!nextAccelerator) return

  try {
    const ok = globalShortcut.register(nextAccelerator, () => {
      void toggleHandler?.().catch(() => undefined)
    })
    if (ok) registeredAccelerator = nextAccelerator
  } catch {
    // Another process may already own the chord; in-app shortcut still works.
  }
}
