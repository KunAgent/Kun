import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveKeyboardShortcutBindings } from '@shared/keyboard-shortcuts'
import type { AppRoute, SettingsRouteSection } from '../../store/chat-store-types'
import type { ExtensionRightRailViewEntry } from '../../extensions/contribution-registry'
import { useKeyboardShortcutSettings } from '../../lib/keyboard-shortcut-settings'
import { openChatFind } from '../chat/chat-find'
import { CommandPaletteOverlay } from '../../palette/CommandPaletteOverlay'
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal'
import type { PaletteSourcesInput } from '../../palette/palette-sources'
import { useCommandPaletteStore } from '../../palette/palette-store'
import { useWorkbenchCommandPalette } from '../../palette/useWorkbenchCommandPalette'
import { COMPOSER_FOCUS_REQUEST_EVENT, getSlashQuery } from '../chat/floating-composer-commands'
import {
  runWorkbenchShortcutCommand,
  useWorkbenchKeyboardShortcuts,
  type WorkbenchShortcutCommandContext
} from './useWorkbenchKeyboardShortcuts'

type MaybeAsync = void | Promise<unknown>

type PaletteSources = Omit<
  PaletteSourcesInput,
  't' | 'tSettings' | 'shortcutBindings' | 'hasComposerDraft'
>

export type WorkbenchCommandPaletteRuntimeProps = {
  sources: PaletteSources
  shortcutContext: WorkbenchShortcutCommandContext
  actions: {
    routes: Record<AppRoute, () => MaybeAsync>
    openSettings: (section?: SettingsRouteSection) => MaybeAsync
    openThread: (threadId: string) => MaybeAsync
    selectWorkspaceRoot: (root: string) => MaybeAsync
    selectExtension: (entry: ExtensionRightRailViewEntry) => boolean
    openCode: () => MaybeAsync
    setInput: (text: string) => void
    setError: (message: string | null) => void
    setComposerModel: (modelId: string, providerId?: string) => void
    archiveThread: (threadId: string, archived: boolean) => MaybeAsync
    pinThread: (threadId: string, pinned: boolean) => MaybeAsync
  }
  input: string
}

export function openWorkbenchCommandPalette(): void {
  useCommandPaletteStore.getState().openPalette()
}

function focusComposer(): void {
  window.dispatchEvent(new CustomEvent(COMPOSER_FOCUS_REQUEST_EVENT))
}

export function WorkbenchCommandPaletteRuntime({
  sources,
  shortcutContext,
  actions,
  input
}: WorkbenchCommandPaletteRuntimeProps): ReactElement {
  const { t } = useTranslation('common')
  const { t: tSettings } = useTranslation('settings')
  const keyboardShortcuts = useKeyboardShortcutSettings()
  const shortcutPlatform = typeof window === 'undefined' ? undefined : window.kunGui?.platform
  const shortcutBindings = useMemo(
    () => resolveKeyboardShortcutBindings(keyboardShortcuts, shortcutPlatform),
    [keyboardShortcuts, shortcutPlatform]
  )
  const openPalette = useCommandPaletteStore((state) => state.openPalette)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  // Surface-specific commands attach here so both the keydown path and the
  // palette's 'shortcut-command' rows behave identically.
  const effectiveShortcutContext: WorkbenchShortcutCommandContext = useMemo(
    () => ({
      ...shortcutContext,
      openFindInChat:
        sources.route === 'chat' && sources.activeThreadId
          ? () => openChatFind(sources.activeThreadId!)
          : undefined,
      openKeyboardShortcuts: () => setShortcutsOpen(true)
    }),
    [shortcutContext, sources.route, sources.activeThreadId]
  )

  useWorkbenchKeyboardShortcuts({
    ...effectiveShortcutContext,
    slashMenuOpen: getSlashQuery(input) !== null,
    openCommandPalette: openPalette,
    keyboardShortcutBindings: shortcutBindings
  })

  const commandPalette = useWorkbenchCommandPalette({
    ...sources,
    t,
    tSettings,
    shortcutBindings,
    hasComposerDraft: input.trim().length > 0,
    handlers: {
      route: (target) => { void actions.routes[target]() },
      settings: (section) => { void actions.openSettings(section) },
      thread: (threadId) => { void actions.openThread(threadId) },
      workspace: (root) => { void actions.selectWorkspaceRoot(root) },
      'shortcut-command': (commandId) => {
        runWorkbenchShortcutCommand(commandId, effectiveShortcutContext)
      },
      'slash-command': (_commandId, insertText) => {
        const draft = input.trim()
        const takesArgument = insertText.endsWith(' ')
        if (draft && !takesArgument) {
          actions.setError(t('paletteComposerBusy'))
          return
        }
        actions.setInput(draft && takesArgument ? insertText + draft : insertText)
        if (sources.route === 'chat') focusComposer()
        else {
          void actions.openCode()
          window.setTimeout(focusComposer, 0)
        }
      },
      'extension-view': (entryId) => {
        const entry = sources.extensionRightRailItems.find((candidate) => candidate.id === entryId)
        return entry ? actions.selectExtension(entry) : false
      },
      compose: (text) => {
        actions.setInput(text)
        if (sources.route === 'chat') focusComposer()
        else {
          void actions.openCode()
          window.setTimeout(focusComposer, 0)
        }
      },
      'select-model': actions.setComposerModel,
      'thread-action': (action, threadId) => {
        if (action === 'archive') void actions.archiveThread(threadId, true)
        else void actions.pinThread(threadId, action === 'pin')
      },
      unavailable: () => actions.setError(t('paletteTargetUnavailable'))
    }
  })

  return (
    <>
      {commandPalette.open ? (
        <CommandPaletteOverlay
          query={commandPalette.query}
          matchTerm={commandPalette.matchTerm}
          scope={commandPalette.scope}
          scopeLabel={commandPalette.scopeLabel}
          groups={commandPalette.groups}
          results={commandPalette.results}
          contentSearchPending={commandPalette.contentSearchPending}
          sourceLabel={commandPalette.sourceLabelFor}
          onQueryChange={commandPalette.setQuery}
          onActivate={commandPalette.activate}
          onClose={commandPalette.close}
        />
      ) : null}
      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  )
}
