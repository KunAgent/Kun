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
import { enterPaperMode, togglePaperMode } from '../../paper/paper-mode-actions'
import { usePaperModeStore } from '../../paper/paper-mode-store'

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
  /** Opens the in-conversation find bar; omitted where no chat stage exists. */
  openFindInChat?: () => void
  /** Opens the keyboard-shortcut cheatsheet overlay. */
  openKeyboardShortcuts?: () => void
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
  if (commandId === 'find-in-chat') {
    context.openFindInChat?.()
    return
  }
  if (commandId === 'open-keyboard-shortcuts') {
    context.openKeyboardShortcuts?.()
    return
  }
  // Paper-mode commands act on the Write surface regardless of composer
  // context; they are safe no-ops when the write store is uninitialized.
  if (commandId === 'toggle-paper-mode') {
    void togglePaperMode()
    return
  }
  if (commandId === 'paper-import') {
    void enterPaperMode().then((result) => {
      if (result.ok) usePaperModeStore.getState().setImportDialogOpen(true)
    })
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
  /** Event target; used to keep printable chords typing instead of firing. */
  target?: unknown
}

/**
 * True when a resolved chord ends in a printable character without Ctrl/Alt/
 * Meta — `Shift+?`, for example. Such chords produce text inside editable
 * fields, so they must not run their command while the user is typing.
 */
function isPrintableCharacterChord(shortcut: string): boolean {
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1]
  if (!key || key.length !== 1) return false
  return !parts
    .slice(0, -1)
    .some((modifier) => modifier === 'Ctrl' || modifier === 'Alt' || modifier === 'Meta')
}

function isEditableShortcutTarget(target: unknown): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
  )
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
  const shortcut = keyboardEventToShortcut(event)
  const commandId = findKeyboardShortcutCommand(bindings, shortcut)
  if (!commandId || !shortcut) return null
  // A chord like `Shift+?` is how a user types `?` — inside an editable it
  // must produce text, not open the cheatsheet.
  if (isPrintableCharacterChord(shortcut) && isEditableShortcutTarget(event.target)) return null
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
  openFindInChat,
  openKeyboardShortcuts,
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
        navigationLocked,
        openFindInChat,
        openKeyboardShortcuts
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
    openFindInChat,
    openKeyboardShortcuts,
    openSettings,
    setComposerMode,
    setUseWorktreePool,
    slashMenuOpen,
    toggleTerminal,
    useWorktreePool,
    worktreeBranch
  ])
}
