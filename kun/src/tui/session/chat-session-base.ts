import { readClipboardImage, type ClipboardImage } from '../clipboard-image.js'
import type { TuiController, TuiControllerState } from '../controller.js'
import { parseTuiKeymapConfig, type TuiKeymap } from '../keymap.js'
import { editTextInExternalEditor } from '../operations.js'
import type { TuiPage } from '../page-model.js'
import { GitStatusWatcher, type GitSnapshot } from '../git-status.js'
import { isActiveChildRun } from '../subagent-format.js'
import { buildTranscriptEntries, type TranscriptEntry } from '../transcript-model.js'
import { foldWorkTrails, withPartSpacing, withTurnFooters } from '../transcript-trail.js'
import { SessionNavigation } from './session-navigation.js'
import type { OfficialProviderCliId } from '../../services/official-provider-cli.js'
import type {
  AutocompleteView,
  ChatSessionDependencies,
  ComposerPort,
  LeaderHint,
  PageEntry,
  TerminalPort,
  ViewportPort
} from './session-types.js'

export const ANIMATION_INTERVAL_MS = 80

const NOOP_COMPOSER: ComposerPort = {
  getText: () => '',
  setText: () => undefined,
  insertText: () => undefined,
  insertNewline: () => undefined,
  cursor: () => ({ line: 0, col: 0 })
}

/**
 * Renderer-neutral application state for the terminal UI: page stack,
 * gestures, transcript entries and animation. The opentui app renders this
 * state and forwards input; everything here is testable without a terminal.
 */
export abstract class ChatSessionBase {
  protected composer: ComposerPort = NOOP_COMPOSER
  protected terminal?: TerminalPort
  protected viewport?: ViewportPort
  protected readonly pages: PageEntry[] = []
  protected readonly listeners = new Set<() => void>()
  protected entriesValue: TranscriptEntry[] = []
  /** Open session tabs and when each was last seen. */
  readonly navigation = new SessionNavigation()
  protected gitValue?: GitSnapshot
  protected readonly gitWatcher = new GitStatusWatcher((snapshot) => {
    this.gitValue = snapshot
    this.changed()
  })
  /** Work trails the reader opened one by one. */
  protected readonly expandedTrails = new Set<string>()
  protected navigationTimer?: ReturnType<typeof setInterval>
  protected showReasoningValue = false
  protected readonly liveReasoningOverrides = new Map<string, boolean>()
  protected showToolDetailsValue = false
  /** Mouse capture: wheel scrolling, clicks and in-app selection. */
  protected pointerModeValue = true
  /** Docked sidebar on wide terminals (shown unless hidden). */
  protected sidebarVisibleValue = true
  /** Sidebar overlay on narrow terminals (hidden unless opened). */
  protected sidebarOverlayValue = false
  protected transientHintValue?: string
  protected leaderHintValue?: LeaderHint
  protected autocompleteValue?: AutocompleteView
  protected animationFrameValue = 0
  protected animationTimer?: ReturnType<typeof setInterval>
  protected leaderTimer?: ReturnType<typeof setTimeout>
  protected pendingExit?: { key: 'ctrl+c' | 'ctrl+d'; timer: ReturnType<typeof setTimeout> }
  protected pendingUndoTimer?: ReturnType<typeof setTimeout>
  protected threadRefreshTimer?: ReturnType<typeof setInterval>
  protected unsubscribeController?: () => void
  protected resolveRun?: () => void
  protected runPromise?: Promise<void>
  protected started = false
  protected stopped = false
  protected suspended = false
  protected clipboardPastePending = false
  protected readonly clipboardImageReader: () => Promise<ClipboardImage | null>
  protected readonly officialProviderAuthenticator?: (provider: OfficialProviderCliId) => Promise<void>
  protected readonly editTextImpl: (initial: string) => Promise<string>

  protected abstract syncPages(state: TuiControllerState): void
  protected abstract refreshSkillAutocomplete(workspace: string): Promise<void>
  protected abstract cancelLeader(): void
  protected abstract clearPendingGestures(): void

  constructor(
    readonly controller: TuiController,
    readonly keymap: TuiKeymap = parseTuiKeymapConfig({}).keymap,
    dependencies: ChatSessionDependencies = {}
  ) {
    this.clipboardImageReader = dependencies.clipboardImageReader ?? readClipboardImage
    this.officialProviderAuthenticator = dependencies.officialProviderAuthenticator
    this.editTextImpl = dependencies.editText ?? editTextInExternalEditor
  }

  get state(): TuiControllerState { return this.controller.state }
  get page(): TuiPage | undefined { return this.pages.at(-1)?.page }
  /** Every transcript entry of the open thread, in display order. */
  get entries(): readonly TranscriptEntry[] { return this.entriesValue }
  get showReasoning(): boolean { return this.showReasoningValue }
  get showToolDetails(): boolean { return this.showToolDetailsValue }
  get pointerMode(): boolean { return this.pointerModeValue }
  get sidebarVisible(): boolean { return this.sidebarVisibleValue }
  get sidebarOverlay(): boolean { return this.sidebarOverlayValue }
  /** Branch and uncommitted changes of the session's workspace, when it is a repository. */
  get git(): GitSnapshot | undefined { return this.gitValue }
  get transientHint(): string | undefined { return this.transientHintValue }
  get leaderHint(): LeaderHint | undefined { return this.leaderHintValue }
  get autocomplete(): AutocompleteView | undefined { return this.autocompleteValue }
  get animationFrame(): number { return this.animationFrameValue }

  attachComposer(composer: ComposerPort): void {
    this.composer = composer
  }

  attachTerminal(terminal: TerminalPort): void {
    this.terminal = terminal
  }

  attachViewport(viewport: ViewportPort): void {
    this.viewport = viewport
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** A layout measurement changed page state (e.g. a scroll position label). */
  layoutChanged(): void {
    this.changed()
  }

  /** Re-render request: any visible state changed. */
  protected changed(): void {
    for (const listener of [...this.listeners]) listener()
  }

  /** Rebuild the transcript entries from the current projection. */
  protected refreshEntries(): void {
    const projection = this.controller.state.projection
    const entries = buildTranscriptEntries(projection, {
      showReasoning: this.showReasoningValue,
      reasoningOverrides: this.liveReasoningOverrides,
      splitAssistantText: true
    })
    this.entriesValue = withPartSpacing(foldWorkTrails(withTurnFooters(entries, projection), projection, {
      expandAll: this.showToolDetailsValue,
      expanded: this.expandedTrails
    }))
  }

  run(): Promise<void> {
    if (this.runPromise) return this.runPromise
    this.started = true
    this.runPromise = new Promise((resolve) => { this.resolveRun = resolve })
    this.unsubscribeController = this.controller.subscribe((state) => this.onControllerState(state))
    process.on('SIGTERM', this.signalHandler)
    process.on('SIGHUP', this.signalHandler)
    this.terminal?.setTitle('Kun')
    // Tab and rail status for sessions other than the open one comes from
    // the thread list; the Sessions page refreshes it on its own.
    this.navigationTimer = setInterval(() => {
      if (this.page?.kind !== 'sessions') void this.controller.refreshThreads(this.controller.state.threadSearch)
    }, 5_000)
    this.navigationTimer.unref?.()
    this.onControllerState(this.controller.state)
    return this.runPromise
  }

  protected readonly signalHandler = (): void => this.requestQuit()

  requestQuit(): void {
    this.controller.requestQuit()
  }

  protected onControllerState(state: TuiControllerState): void {
    for (const entry of this.pages) {
      const page = entry.page as TuiPage & {
        updateParentProjection?: (projection: TuiControllerState['projection']) => void
        update?: (value: unknown) => void
        updateSnapshot?: (snapshot: NonNullable<TuiControllerState['modelConnections']>) => void
      }
      page.updateParentProjection?.(state.projection)
      if (page.kind === 'sessions' || page.kind === 'goal' || page.kind === 'graph') page.update?.(state)
      if (state.modelConnections) page.updateSnapshot?.(state.modelConnections)
    }
    this.syncPages(state)
    this.syncAnimation(state)
    const thread = state.projection?.thread
    this.navigation.observe(thread ? { id: thread.id, title: thread.title, workspace: thread.workspace } : undefined)
    this.gitWatcher.watch(thread?.workspace ?? this.controller.options.workspace)
    this.refreshEntries()
    void this.refreshSkillAutocomplete(state.projection?.thread.workspace ?? this.controller.options.workspace)
    if (state.quitRequested) this.resolveRun?.()
    this.changed()
  }

  protected animationActive(state: TuiControllerState): boolean {
    const page = this.page as (TuiPage & { animated?: boolean }) | undefined
    return Boolean(
      state.busy ||
      state.connection === 'connecting' ||
      state.connection === 'reconnecting' ||
      state.projection?.runningTurnId ||
      state.projection?.childRuns.some(isActiveChildRun) ||
      page?.animated
    )
  }

  protected syncAnimation(state: TuiControllerState): void {
    const active = this.animationActive(state)
    if (active && !this.animationTimer) {
      this.animationTimer = setInterval(() => {
        this.animationFrameValue = (this.animationFrameValue + 1) % 960
        if (!this.animationActive(this.controller.state)) this.syncAnimation(this.controller.state)
        this.changed()
      }, ANIMATION_INTERVAL_MS)
      this.animationTimer.unref?.()
    } else if (!active && this.animationTimer) {
      clearInterval(this.animationTimer)
      this.animationTimer = undefined
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    process.off('SIGTERM', this.signalHandler)
    process.off('SIGHUP', this.signalHandler)
    this.unsubscribeController?.()
    this.unsubscribeController = undefined
    for (const entry of this.pages.splice(0)) entry.page.dispose?.()
    this.cancelLeader()
    this.clearPendingGestures()
    if (this.threadRefreshTimer) clearInterval(this.threadRefreshTimer)
    this.threadRefreshTimer = undefined
    if (this.animationTimer) clearInterval(this.animationTimer)
    this.animationTimer = undefined
    if (this.navigationTimer) clearInterval(this.navigationTimer)
    this.navigationTimer = undefined
    this.gitWatcher.stop()
    this.resolveRun?.()
    this.resolveRun = undefined
  }
}
