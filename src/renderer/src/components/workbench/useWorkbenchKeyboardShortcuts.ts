import { useEffect, useMemo } from 'react'
import type { DesktopCommand } from '@shared/kun-gui-api'
import {
  findKeyboardShortcutCommand,
  keyboardEventToShortcut,
  resolveKeyboardShortcutBindings,
  type KeyboardShortcutBindingsV1,
  type KeyboardShortcutCommandId,
  type KeyboardShortcutEventLike
} from '@shared/keyboard-shortcuts'
import { useKeyboardShortcutSettings } from '../../lib/keyboard-shortcut-settings'
import { isNativeDialogOpen } from '../../lib/native-dialog-activity'

const DESKTOP_SHORTCUT_COMMANDS: Partial<Record<KeyboardShortcutCommandId, DesktopCommand>> = {
  quit: 'quit',
  undo: 'undo',
  redo: 'redo',
  cut: 'cut',
  copy: 'copy',
  paste: 'paste',
  'select-all': 'selectAll',
  reload: 'reload',
  'zoom-in': 'zoomIn',
  'zoom-out': 'zoomOut',
  'reset-zoom': 'resetZoom',
  'toggle-devtools': 'toggleDevTools',
  close: 'close',
  minimize: 'minimize',
  'toggle-maximize': 'toggleMaximize'
}

type ComposerMode = 'agent' | 'plan' | 'auto'

export function isWorkbenchNavigationShortcutLocked(
  commandId: KeyboardShortcutCommandId,
  navigationLocked: boolean
): boolean {
  return navigationLocked && (
    commandId === 'new-chat' ||
    commandId === 'choose-workspace' ||
    commandId === 'settings'
  )
}

export type WorkbenchShortcutCommandContext = {
  composerMode: ComposerMode
  setComposerMode: (mode: ComposerMode) => void
  handleGuiPlanCommand: () => void | Promise<unknown>
  createThread: (options: { useWorktreePool?: boolean; worktreeBranch?: string }) => void | Promise<unknown>
  chooseWorkspace: () => void | Promise<unknown>
  toggleTerminal: () => void
  openSettings: () => void
  useWorktreePool: boolean
  setUseWorktreePool: (enabled: boolean) => void
  worktreeBranch: string
  navigationLocked?: boolean
}

/**
 * Runs a workbench shortcut command through the exact same behavior the
 * keydown handler uses. The command palette dispatches its
 * 'shortcut-command' entries through this function so activation is
 * identical to pressing the chord.
 */
export function runWorkbenchShortcutCommand(
  commandId: KeyboardShortcutCommandId,
  context: WorkbenchShortcutCommandContext
): void {
  if (isWorkbenchNavigationShortcutLocked(commandId, context.navigationLocked === true)) return

  if (commandId === 'toggle-plan-mode') {
    if (context.composerMode === 'plan') {
      context.setComposerMode('agent')
    } else {
      context.setComposerMode('plan')
      void context.handleGuiPlanCommand()
    }
    return
  }
  if (commandId === 'new-chat') {
    void context.createThread({ useWorktreePool: context.useWorktreePool, worktreeBranch: context.worktreeBranch })
    if (context.useWorktreePool) context.setUseWorktreePool(false)
    return
  }
  if (commandId === 'choose-workspace') {
    void context.chooseWorkspace()
    return
  }
  if (commandId === 'toggle-terminal') {
    context.toggleTerminal()
    return
  }
  if (commandId === 'settings') {
    context.openSettings()
    return
  }

  const desktopCommand = DESKTOP_SHORTCUT_COMMANDS[commandId]
  if (desktopCommand && typeof window.kunGui?.runDesktopCommand === 'function') {
    void window.kunGui.runDesktopCommand(desktopCommand)
  }
}

export type WorkbenchShortcutKeyDownEvent = KeyboardShortcutEventLike & {
  defaultPrevented: boolean
  repeat: boolean
  isComposing: boolean
}

/**
 * Resolves a keydown event to the shortcut command it should run, applying
 * invocation suppression. Default-prevented, repeated, and IME-composing
 * events never resolve. The command palette additionally yields while the
 * composer slash-command menu is open or a native dialog owns input, leaving
 * the event unconsumed in both cases.
 */
export function resolveWorkbenchShortcutKeyDown(
  event: WorkbenchShortcutKeyDownEvent,
  bindings: Required<KeyboardShortcutBindingsV1>,
  options: { slashMenuOpen: boolean; nativeDialogOpen?: boolean }
): KeyboardShortcutCommandId | null {
  if (event.defaultPrevented || event.repeat || event.isComposing) return null
  const commandId = findKeyboardShortcutCommand(bindings, keyboardEventToShortcut(event))
  if (!commandId) return null
  if (commandId === 'command-palette' && (options.slashMenuOpen || options.nativeDialogOpen)) {
    return null
  }
  return commandId
}

type UseWorkbenchKeyboardShortcutsInput = WorkbenchShortcutCommandContext & {
  /** Suppresses command-palette invocation while the composer slash menu is open. */
  slashMenuOpen?: boolean
  /** Opens the palette; omitted in environments without the palette surface. */
  openCommandPalette?: () => void
  /** Pre-resolved bindings shared with other consumers (e.g. the palette). */
  keyboardShortcutBindings?: Required<KeyboardShortcutBindingsV1>
}

export function useWorkbenchKeyboardShortcuts({
  composerMode,
  setComposerMode,
  handleGuiPlanCommand,
  createThread,
  chooseWorkspace,
  toggleTerminal,
  openSettings,
  useWorktreePool,
  setUseWorktreePool,
  worktreeBranch,
  navigationLocked = false,
  slashMenuOpen = false,
  openCommandPalette,
  keyboardShortcutBindings: providedBindings
}: UseWorkbenchKeyboardShortcutsInput): void {
  const keyboardShortcuts = useKeyboardShortcutSettings()
  const shortcutPlatform = typeof window === 'undefined' ? undefined : window.kunGui?.platform
  const resolvedBindings = useMemo(
    () => resolveKeyboardShortcutBindings(keyboardShortcuts, shortcutPlatform),
    [keyboardShortcuts, shortcutPlatform]
  )
  const keyboardShortcutBindings = providedBindings ?? resolvedBindings

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const commandId = resolveWorkbenchShortcutKeyDown(event, keyboardShortcutBindings, {
        slashMenuOpen,
        nativeDialogOpen: isNativeDialogOpen()
      })
      if (!commandId) return

      if (commandId === 'command-palette') {
        // Only consume the chord when there is a palette to open, so a build
        // without the surface leaves the key to whatever else may handle it.
        if (!openCommandPalette) return
        event.preventDefault()
        openCommandPalette()
        return
      }
      event.preventDefault()

      runWorkbenchShortcutCommand(commandId, {
        composerMode,
        setComposerMode,
        handleGuiPlanCommand,
        createThread,
        chooseWorkspace,
        toggleTerminal,
        openSettings,
        useWorktreePool,
        setUseWorktreePool,
        worktreeBranch,
        navigationLocked
      })
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    chooseWorkspace,
    composerMode,
    createThread,
    handleGuiPlanCommand,
    keyboardShortcutBindings,
    navigationLocked,
    openCommandPalette,
    openSettings,
    setComposerMode,
    setUseWorktreePool,
    slashMenuOpen,
    toggleTerminal,
    useWorktreePool,
    worktreeBranch
  ])
}
