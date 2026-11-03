import { CliRenderEvents, decodePasteBytes, type CliRenderer, type KeyEvent, type MouseEvent, type PasteEvent, type TextareaRenderable } from '@opentui/core'
import { render } from '@opentui/solid'
import { createEffect, createMemo, createSignal, Show, type JSX } from 'solid-js'
import type { ChatSession } from '../session/chat-session.js'
import { exitEpilogue } from '../session-view-model.js'
import type { ComposerPort } from '../session/session-types.js'
import { AppContext, type AppContextValue } from './context.js'
import type { ComposerHandlers } from './chat/composer.js'
import { HomeView } from './home/home-view.js'
import { isDockedPage, PageDialog } from './pages/page-view.js'
import { createKunRenderer, createTerminalPort, type RendererStreams } from './runtime.js'
import { SessionView } from './session/session-view.js'
import { setAnsiTheme } from './ansi.js'
import { createTheme, markdownSyntaxStyle, type ThemeMode } from './theme.js'

/**
 * The composer textarea is remounted when the view changes (home, session,
 * a docked page); the draft follows it so nothing typed is lost.
 */
class ComposerBinding {
  private textarea?: TextareaRenderable
  private draft = ''

  constructor(private readonly session: ChatSession) {}

  readonly handlers: ComposerHandlers = {
    onTextarea: (element) => {
      this.textarea = element
      if (this.draft) {
        element.setText(this.draft)
        element.cursorOffset = this.draft.length
      }
      if (!this.session.page) element.focus()
    },
    onSubmit: () => { void this.session.submitComposer() },
    onChange: () => {
      if (this.textarea && !this.textarea.isDestroyed) this.draft = this.textarea.plainText
      this.session.onComposerChanged()
    }
  }

  private live(): TextareaRenderable | undefined {
    return this.textarea && !this.textarea.isDestroyed ? this.textarea : undefined
  }

  setFocused(focused: boolean): void {
    const textarea = this.live()
    if (!textarea) return
    if (focused) textarea.focus()
    else textarea.blur()
  }

  readonly port: ComposerPort = {
    getText: () => this.live()?.plainText ?? this.draft,
    setText: (text, cursor) => {
      this.draft = text
      const textarea = this.live()
      if (!textarea) return
      textarea.setText(text)
      textarea.cursorOffset = cursor ?? text.length
    },
    insertText: (text) => this.live()?.insertText(text),
    insertNewline: () => this.live()?.newLine(),
    cursor: () => {
      const cursor = this.live()?.logicalCursor
      return { line: cursor?.row ?? 0, col: cursor?.col ?? 0 }
    }
  }
}

function App(props: { app: AppContextValue; composer: ComposerBinding }): JSX.Element {
  const app = props.app
  const session = app.session
  const page = createMemo(() => {
    app.tick()
    return session.page
  })
  const home = createMemo(() => {
    app.tick()
    return !session.state.projection
  })
  const dialog = () => (isDockedPage(page()) ? undefined : page())
  const dock = () => (isDockedPage(page()) ? page() : undefined)
  // Keys go to the open page; the composer keeps its draft but not focus.
  createEffect(() => props.composer.setFocused(!page()))
  // Page formatters and cleared cells follow the active theme.
  createEffect(() => {
    setAnsiTheme(app.theme())
    app.renderer.setBackgroundColor(app.theme().bg)
  })
  // Dragging over text selects it; releasing copies it, like OpenCode.
  const copySelection = (event: MouseEvent): void => {
    if (!event.isDragging) return
    const text = app.renderer.getSelection()?.getSelectedText()
    if (text) void session.copySelection(text)
  }
  const handlers = props.composer.handlers
  return (
    <AppContext.Provider value={app}>
      <box width="100%" height="100%" flexDirection="column" backgroundColor={app.theme().bg} onMouseUp={copySelection}>
        <Show
          when={home()}
          fallback={<SessionView onTextarea={handlers.onTextarea} onSubmit={handlers.onSubmit} onChange={handlers.onChange} dock={dock()} />}
        >
          <HomeView onTextarea={handlers.onTextarea} onSubmit={handlers.onSubmit} onChange={handlers.onChange} />
        </Show>
        <Show when={dialog()} keyed>
          {(value) => <PageDialog page={value} />}
        </Show>
      </box>
    </AppContext.Provider>
  )
}

export type OpenTuiApplication = {
  run(): Promise<void>
  stop(): Promise<void>
  submitStartupGraphPrompt(prompt: string): Promise<boolean>
}

/**
 * Mount the full-screen opentui terminal UI for a ChatSession. The returned
 * handle's `run()` resolves when the session requests quit.
 */
export async function startOpenTuiApplication(
  session: ChatSession,
  streams: RendererStreams = {}
): Promise<OpenTuiApplication> {
  const output = streams.stdout ?? process.stdout
  const renderer: CliRenderer = await createKunRenderer(streams)
  const [tick, setTick] = createSignal(0)
  const [themeName, setThemeName] = createSignal(session.state.theme)
  // Dark or light follows the terminal's background, also when it changes.
  const [themeMode, setThemeMode] = createSignal<ThemeMode>(renderer.themeMode ?? 'dark')
  const theme = createMemo(() => createTheme(themeName(), themeMode()))
  setAnsiTheme(theme())
  const onThemeMode = (mode: ThemeMode): void => { setThemeMode(mode) }
  renderer.on(CliRenderEvents.THEME_MODE, onThemeMode)
  void renderer.waitForThemeMode(300).then((mode) => { if (mode) setThemeMode(mode) }).catch(() => undefined)
  const syntax = createMemo(() => markdownSyntaxStyle(theme(), renderer))
  const [width, setWidth] = createSignal(renderer.terminalWidth)
  const composer = new ComposerBinding(session)
  const app: AppContextValue = {
    session,
    controller: session.controller,
    renderer,
    tick,
    theme,
    syntax,
    width
  }
  session.attachComposer(composer.port)
  session.attachTerminal(createTerminalPort(renderer, () => {
    composer.setFocused(!session.page)
    setTick((value) => value + 1)
  }))
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

  await render(() => <App app={app} composer={composer} />, renderer)

  let stopped = false
  return {
    run: () => session.run(),
    submitStartupGraphPrompt: (prompt) => session.submitStartupGraphPrompt(prompt),
    async stop() {
      if (stopped) return
      stopped = true
      const thread = session.state.projection?.thread
      unsubscribe()
      renderer.off(CliRenderEvents.RESIZE, onResize)
      renderer.off(CliRenderEvents.THEME_MODE, onThemeMode)
      renderer.keyInput.off('keypress', onKey)
      renderer.keyInput.off('paste', onPaste)
      await session.stop()
      await renderer.idle().catch(() => undefined)
      renderer.setTerminalTitle('')
      renderer.destroy()
      // The main screen is back only once destroy has finished restoring it.
      await renderer.closed.catch(() => undefined)
      if (thread) output.write(exitEpilogue(thread))
    }
  }
}
