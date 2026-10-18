import { readClipboardImage, type ClipboardImage } from '../clipboard-image.js'
import type { TuiController, TuiControllerState } from '../controller.js'
import { parseTuiKeymapConfig, type TuiKeymap } from '../keymap.js'
import { editTextInExternalEditor } from '../operations.js'
import type { TuiPage } from '../page-model.js'
import { ScrollbackPlanner } from '../scrollback-plan.js'
import { isActiveChildRun } from '../subagent-format.js'
import { buildTranscriptEntries, type TranscriptEntry } from '../transcript-model.js'
import type { OfficialProviderCliId } from '../../services/official-provider-cli.js'
import type {
  AutocompleteView,
  ChatSessionDependencies,
  ComposerPort,
  LeaderHint,
  PageEntry,
  ScrollbackSink,
  TerminalPort
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
 * gestures, scrollback planning and animation. The opentui app renders this
 * state and forwards input; everything here is testable without a terminal.
 */
export abstract class ChatSessionBase {
  protected composer: ComposerPort = NOOP_COMPOSER
  protected terminal?: TerminalPort
  protected scrollbackSink?: ScrollbackSink
  protected readonly pages: PageEntry[] = []
  protected readonly listeners = new Set<() => void>()
  protected readonly planner = new ScrollbackPlanner()
  protected liveEntriesValue: TranscriptEntry[] = []
  protected scrollbackReady = false
  protected showReasoningValue = false
  protected readonly liveReasoningOverrides = new Map<string, boolean>()
  protected showToolDetailsValue = false
  protected pointerModeValue = false
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
  get liveEntries(): readonly TranscriptEntry[] { return this.liveEntriesValue }
  get showReasoning(): boolean { return this.showReasoningValue }
  get showToolDetails(): boolean { return this.showToolDetailsValue }
  get pointerMode(): boolean { return this.pointerModeValue }
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

  /** Receives transcript entries once they are final enough for scrollback. */
  attachScrollback(sink: ScrollbackSink): void {
    this.scrollbackSink = sink
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

  /**
   * Scrollback can only be written while the inline chat surface is active.
   * Pages run on the alternate screen and external programs own the
   * terminal while suspended; commits are planned again once ready.
   */
  setScrollbackReady(ready: boolean): void {
    this.scrollbackReady = ready
    if (ready) this.planScrollback()
  }

  protected planScrollback(): void {
    const projection = this.controller.state.projection
    const entries = buildTranscriptEntries(projection, {
      showReasoning: this.showReasoningValue,
      reasoningOverrides: this.liveReasoningOverrides,
      splitAssistantText: true
    })
    if (!this.scrollbackReady || this.suspended || !this.scrollbackSink) {
      // Without a writable scrollback everything unwritten is live; nothing
      // is marked committed so it will be written once the surface returns.
      return
    }
    const plan = this.planner.plan(projection?.thread.id, projection?.thread.title || 'Untitled', entries)
    this.liveEntriesValue = plan.live
    if (plan.commits.length) {
      this.scrollbackSink(plan.commits, {
        showReasoning: this.showReasoningValue,
        showToolDetails: this.showToolDetailsValue,
        legacyGui: this.controller.runtime.legacyGui === true
      })
    }
  }

  /**
   * On exit, write whatever is still live so the terminal scrollback keeps
   * the final state of the conversation after Kun's surface is gone.
   */
  finalizeScrollback(): void {
    if (!this.scrollbackReady || !this.scrollbackSink) return
    const projection = this.controller.state.projection
    const entries = buildTranscriptEntries(projection, {
      showReasoning: this.showReasoningValue,
      reasoningOverrides: this.liveReasoningOverrides,
      splitAssistantText: true
    }).map((entry) => ({ ...entry, settled: true }))
    const plan = this.planner.plan(projection?.thread.id, projection?.thread.title || 'Untitled', entries)
    this.liveEntriesValue = []
    if (plan.commits.length) {
      this.scrollbackSink(plan.commits, {
        showReasoning: this.showReasoningValue,
        showToolDetails: this.showToolDetailsValue,
        legacyGui: this.controller.runtime.legacyGui === true
      })
    }
  }

  /** Called by the app after it cleared the screen and wants a full replay. */
  replayScrollback(): void {
    this.planner.reset()
    this.planScrollback()
    this.changed()
  }

  run(): Promise<void> {
    if (this.runPromise) return this.runPromise
    this.started = true
    this.runPromise = new Promise((resolve) => { this.resolveRun = resolve })
    this.unsubscribeController = this.controller.subscribe((state) => this.onControllerState(state))
    process.on('SIGTERM', this.signalHandler)
    process.on('SIGHUP', this.signalHandler)
    this.terminal?.setTitle('Kun')
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
      if (page.kind === 'transcript') page.update?.(state.projection)
      else if (page.kind === 'sessions' || page.kind === 'goal' || page.kind === 'graph') page.update?.(state)
      if (state.modelConnections) page.updateSnapshot?.(state.modelConnections)
    }
    this.syncPages(state)
    this.syncAnimation(state)
    this.planScrollback()
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
    this.resolveRun?.()
    this.resolveRun = undefined
  }
}
