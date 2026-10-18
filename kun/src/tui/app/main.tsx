import { CliRenderEvents, decodePasteBytes, type CliRenderer, type KeyEvent, type PasteEvent, type TextareaRenderable } from '@opentui/core'
import { render, useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, on, onCleanup, Show, type JSX } from 'solid-js'
import type { ChatSession } from '../session/chat-session.js'
import type { ComposerPort } from '../session/session-types.js'
import { AppContext, type AppContextValue } from './context.js'
import { ChatSurface } from './chat/surface.js'
import { PageScreen } from './pages/page-view.js'
import { createKunRenderer, createTerminalPort, InlineScreen, type RendererStreams } from './runtime.js'
import { createTheme, markdownSyntaxStyle } from './theme.js'
import { ScrollbackWriter } from './transcript/scrollback.js'

/** Rows used by the composer cluster: activity, composer frame, footer. */
const CLUSTER_ROWS = 7
/** Welcome content rows; narrow terminals stack the metadata on three rows. */
const WELCOME_ROWS = 15
const COMPACT_WELCOME_ROWS = 11
const NARROW_WELCOME_EXTRA_ROWS = 1
const NARROW_WELCOME_COLUMNS = 60
const RESIZE_REPLAY_DELAY_MS = 200

export function chatFooterHeight(rows: number): number {
  const live = Math.max(4, Math.min(14, Math.floor(rows * 0.3)))
  return Math.max(Math.min(rows, CLUSTER_ROWS + 1), Math.min(rows - 2, CLUSTER_ROWS + live))
}

export function welcomeFooterHeight(rows: number, columns: number): number {
  const welcome = (rows < 24 ? COMPACT_WELCOME_ROWS : WELCOME_ROWS) +
    (columns < NARROW_WELCOME_COLUMNS ? NARROW_WELCOME_EXTRA_ROWS : 0)
  return Math.min(rows - 1, welcome + CLUSTER_ROWS)
}

function textareaPort(get: () => TextareaRenderable | undefined): ComposerPort {
  return {
    getText: () => get()?.plainText ?? '',
    setText: (text, cursor) => {
      const textarea = get()
      if (!textarea || textarea.isDestroyed) return
      textarea.setText(text)
      textarea.cursorOffset = cursor ?? text.length
    },
    insertText: (text) => {
      const textarea = get()
      if (textarea && !textarea.isDestroyed) textarea.insertText(text)
    },
    insertNewline: () => {
      const textarea = get()
      if (textarea && !textarea.isDestroyed) textarea.newLine()
    },
    cursor: () => {
      const cursor = get()?.logicalCursor
      return { line: cursor?.row ?? 0, col: cursor?.col ?? 0 }
    }
  }
}

function App(props: {
  app: AppContextValue
  screen: InlineScreen
  writer: ScrollbackWriter
  setTextarea: (textarea: TextareaRenderable) => void
}): JSX.Element {
  const app = props.app
  const session = app.session
  const dimensions = useTerminalDimensions()
  const requestedPage = createMemo(() => {
    app.tick()
    return session.page
  })
  // The page is shown only after the alternate screen is active; pending
  // scrollback writes finish first because they need the inline surface.
  const [pageReady, setPageReady] = createSignal(false)
  const page = () => (pageReady() ? requestedPage() : undefined)
  const welcome = createMemo(() => {
    app.tick()
    return !session.state.projection
  })
  // Switch between the inline surface and the alternate-screen page view.
  // Page switches and resize replays share one queue so they never interleave.
  let switching = Promise.resolve()
  let replayPending = false
  createEffect(on(() => Boolean(requestedPage()), (wanted) => {
    switching = switching.then(async () => {
      if (wanted && !props.screen.onPage) {
        session.setScrollbackReady(false)
        await props.writer.drain()
        if (!session.page) {
          session.setScrollbackReady(true)
          return
        }
        props.screen.enterPage()
        setPageReady(true)
      } else if (!wanted && props.screen.onPage) {
        setPageReady(false)
        props.screen.leavePage(session.pointerMode)
        if (replayPending) await replayTranscript()
        else session.setScrollbackReady(true)
      }
    })
  }))
  // A narrower terminal reflows (and partly clears) rows that were already
  // printed, so after a width change the transcript is laid out again at the
  // new width: the screen and saved lines are cleared and every committed
  // entry is written once more.
  const replayTranscript = async (): Promise<void> => {
    replayPending = false
    session.setScrollbackReady(false)
    await props.writer.drain()
    if (app.renderer.isDestroyed || props.screen.onPage) {
      replayPending = props.screen.onPage
      return
    }
    try {
      if (session.state.projection) {
        app.renderer.resetSplitFooterForReplay({ clearSavedLines: true })
        session.replayScrollback()
      }
    } finally {
      session.setScrollbackReady(true)
    }
  }
  let replayWidth = app.renderer.terminalWidth
  let replayTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(on(() => dimensions().width, () => {
    if (replayTimer) clearTimeout(replayTimer)
    replayTimer = setTimeout(() => {
      replayTimer = undefined
      if (app.renderer.isDestroyed || app.renderer.terminalWidth === replayWidth) return
      replayWidth = app.renderer.terminalWidth
      if (props.screen.onPage) {
        replayPending = true
        return
      }
      switching = switching.then(replayTranscript).catch((error: unknown) => console.error('[kun tui] resize replay failed', error))
    }, RESIZE_REPLAY_DELAY_MS)
  }, { defer: true }))
  onCleanup(() => { if (replayTimer) clearTimeout(replayTimer) })
  // Inline footer height: the welcome first, then a fixed composer cluster
  // plus a live window. Growth is applied only where it cannot scroll away
  // visible history (see InlineScreen).
  let lastRows = app.renderer.terminalHeight
  createEffect(() => {
    dimensions()
    if (page() || requestedPage()) return
    const rows = app.renderer.terminalHeight
    const resized = rows !== lastRows
    lastRows = rows
    props.screen.setFooterHeight(welcome() ? welcomeFooterHeight(rows, app.renderer.terminalWidth) : chatFooterHeight(rows), resized)
  })
  return (
    <AppContext.Provider value={app}>
      <Show
        when={page()}
        fallback={
          <ChatSurface
            welcome={welcome()}
            compactWelcome={app.renderer.terminalHeight < 24}
            onTextarea={(textarea) => {
              props.setTextarea(textarea)
              textarea.focus()
            }}
            onSubmit={() => { void session.submitComposer() }}
            onChange={() => session.onComposerChanged()}
          />
        }
      >
        <PageScreen page={page()!} />
      </Show>
    </AppContext.Provider>
  )
}

export type OpenTuiApplication = {
  run(): Promise<void>
  stop(): Promise<void>
  submitStartupGraphPrompt(prompt: string): Promise<boolean>
}

/**
 * Mount the opentui terminal UI for a ChatSession. The returned handle's
 * `run()` resolves when the session requests quit.
 */
export async function startOpenTuiApplication(
  session: ChatSession,
  streams: RendererStreams = {}
): Promise<OpenTuiApplication> {
  const output = streams.stdout ?? process.stdout
  const renderer: CliRenderer = await createKunRenderer(welcomeFooterHeight(output.rows ?? 24, output.columns ?? 80), streams)
  const screen = new InlineScreen(renderer)
  const [tick, setTick] = createSignal(0)
  const [themeName, setThemeName] = createSignal(session.state.theme)
  const theme = createMemo(() => createTheme(themeName()))
  const syntax = createMemo(() => markdownSyntaxStyle(theme(), renderer))
  const [width, setWidth] = createSignal(renderer.terminalWidth)
  let textarea: TextareaRenderable | undefined
  const app: AppContextValue = {
    session,
    controller: session.controller,
    renderer,
    tick,
    theme,
    syntax,
    width
  }
  session.attachComposer(textareaPort(() => textarea))
  session.attachTerminal(createTerminalPort(renderer, screen, () => {
    if (!screen.onPage) textarea?.focus()
    setTick((value) => value + 1)
  }))
  const writer = new ScrollbackWriter(renderer, app, (error) => console.error('[kun tui] scrollback write failed', error))
  session.attachScrollback((commits, options) => writer.write(commits, options))
  const unsubscribe = session.subscribe(() => {
    if (session.state.theme !== themeName()) setThemeName(session.state.theme)
    setTick((value) => value + 1)
  })
  const onResize = (): void => {
    setWidth(renderer.terminalWidth)
    setTick((value) => value + 1)
  }
  renderer.on(CliRenderEvents.RESIZE, onResize)
  const onKey = (event: KeyEvent): void => {
    if (session.handleKey(event)) event.preventDefault()
  }
  const onPaste = (event: PasteEvent): void => {
    event.preventDefault()
    session.handlePaste(decodePasteBytes(event.bytes))
  }
  renderer.keyInput.on('keypress', onKey)
  renderer.keyInput.on('paste', onPaste)

  await render(() => <App app={app} screen={screen} writer={writer} setTextarea={(value) => { textarea = value }} />, renderer)
  session.setScrollbackReady(true)

  let stopped = false
  return {
    run: () => session.run(),
    submitStartupGraphPrompt: (prompt) => session.submitStartupGraphPrompt(prompt),
    async stop() {
      if (stopped) return
      stopped = true
      unsubscribe()
      renderer.off(CliRenderEvents.RESIZE, onResize)
      renderer.keyInput.off('keypress', onKey)
      renderer.keyInput.off('paste', onPaste)
      if (screen.onPage) screen.leavePage(false)
      session.finalizeScrollback()
      session.setScrollbackReady(false)
      await writer.drain()
      await session.stop()
      await renderer.idle().catch(() => undefined)
      renderer.setTerminalTitle('')
      renderer.destroy()
    }
  }
}
