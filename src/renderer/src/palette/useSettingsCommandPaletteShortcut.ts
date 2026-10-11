import { useEffect, useMemo } from 'react'
import { resolveKeyboardShortcutBindings } from '@shared/keyboard-shortcuts'
import { useKeyboardShortcutSettings } from '../lib/keyboard-shortcut-settings'
import { isNativeDialogOpen } from '../lib/native-dialog-activity'
import { resolveWorkbenchShortcutKeyDown } from '../components/workbench/useWorkbenchKeyboardShortcuts'
import { useCommandPaletteStore } from './palette-store'

/**
 * Keeps the palette chord alive on the Settings route.
 *
 * AppShell renders SettingsView *instead of* Workbench, so the workbench
 * keydown listener and the palette overlay are both unmounted here. Without
 * this the palette would be dead on the one route its own settings entries
 * navigate to. Settings owns no palette sources of its own, so the chord
 * returns to the route the user came from and opens the palette there.
 */
export function useSettingsCommandPaletteShortcut(closeSettings: () => boolean | void): void {
  const keyboardShortcuts = useKeyboardShortcutSettings()
  const shortcutPlatform = typeof window === 'undefined' ? undefined : window.kunGui?.platform
  const bindings = useMemo(
    () => resolveKeyboardShortcutBindings(keyboardShortcuts, shortcutPlatform),
    [keyboardShortcuts, shortcutPlatform]
  )
  const openPalette = useCommandPaletteStore((state) => state.openPalette)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const commandId = resolveWorkbenchShortcutKeyDown(event, bindings, {
        slashMenuOpen: false,
        nativeDialogOpen: isNativeDialogOpen()
      })
      if (commandId !== 'command-palette') return
      event.preventDefault()
      if (closeSettings() === false) return
      openPalette()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [bindings, closeSettings, openPalette])
}
