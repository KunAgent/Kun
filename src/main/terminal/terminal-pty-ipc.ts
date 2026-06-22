/**
 * Main-process PTY lifecycle for the built-in terminal.
 *
 * Architecture mirrors `runtime-sse-ipc.ts`: the main process owns the real
 * resource (a node-pty pseudo-terminal), streams chunks to the renderer over
 * `terminal:data`, and reports exit via `terminal:exit`. node-pty is loaded
 * lazily so a missing/broken native build disables the terminal gracefully
 * instead of crashing app startup.
 *
 * Cross-platform notes:
 *  - macOS / Linux: node-pty uses forkpty; the `$SHELL` env var (fallback
 *    /bin/zsh on mac, /bin/bash on linux) selects the program.
 *  - Windows: node-pty uses ConPTY (`useConpty: true`); we prefer PowerShell
 *    7 (pwsh.exe), then Windows PowerShell, then cmd.exe.
 *  - `useConpty` is a no-op on non-Windows, so we always pass it.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow, IpcMain, WebContents } from 'electron'
import type { IPty } from 'node-pty'
import {
  TERMINAL_DEFAULT_COLS,
  TERMINAL_DEFAULT_ROWS,
  TERMINAL_MAX_SESSIONS,
  TERMINAL_RING_BUFFER_BYTES
} from '../../shared/terminal'
import type { TerminalColorMode } from '../../shared/app-settings-terminal'
import {
  terminalCreatePayloadSchema,
  terminalResizePayloadSchema,
  terminalSessionIdSchema,
  terminalWritePayloadSchema
} from '../ipc/app-ipc-schemas'

type TerminalSession = {
  pty: IPty
  sender: WebContents
  /** Last ~64KB of output, replayed when a panel re-attaches. */
  ringBuffer: string
  exited: boolean
}

let nodePty: typeof import('node-pty') | null | undefined

async function loadNodePty(): Promise<typeof import('node-pty') | null> {
  if (nodePty !== undefined) return nodePty
  try {
    // Dynamic import keeps the main bundle compiling even if the native
    // prebuild is missing on the current platform; failure surfaces as a
    // friendly message in the panel instead of a hard crash.
    nodePty = await import('node-pty')
  } catch (error) {
    console.warn('[terminal] node-pty failed to load; built-in terminal disabled:', error)
    nodePty = null
  }
  return nodePty
}

/**
 * Pick a default shell for the current platform.
 *
 * macOS: respects $SHELL (set by the OS for the user's default terminal),
 *        falling back to zsh which has shipped as the system default since
 *        Catalina.
 * Linux: respects $SHELL, falling back to bash (the de-facto standard).
 * Windows: PowerShell 7 (pwsh.exe) if installed, else Windows PowerShell,
 *        else the COMSPEC command interpreter (usually cmd.exe).
 */
function resolveDefaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files'
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows'
    const pwsh7 = join(programFiles, 'PowerShell', '7', 'pwsh.exe')
    if (existsSync(pwsh7)) return { file: pwsh7, args: ['-NoLogo'] }
    const windowsPwsh = join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    )
    if (existsSync(windowsPwsh)) return { file: windowsPwsh, args: ['-NoLogo'] }
    return { file: process.env.COMSPEC ?? 'cmd.exe', args: [] }
  }
  const fallback = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
  return { file: process.env.SHELL || fallback, args: [] }
}

/**
 * True when a locale string requests a UTF-8 codeset. Matches the common
 * spellings case-insensitively: `UTF-8`, `UTF8`, `utf8`, `utf-8`, etc.
 */
function isUtf8Locale(value: string | undefined): value is string {
  if (!value) return false
  return /utf-?8/i.test(value)
}

/**
 * Resolve a UTF-8 locale for the child shell.
 *
 * POSIX precedence for the character-encoding category is
 * `LC_ALL` > `LC_CTYPE` > `LANG`: LC_ALL overrides everything, then the
 * category-specific LC_CTYPE, then the catch-all LANG. The previous order
 * checked LANG before LC_ALL, which inverted that precedence.
 */
function resolveLocale(): string {
  if (isUtf8Locale(process.env.LC_ALL)) return process.env.LC_ALL
  if (isUtf8Locale(process.env.LC_CTYPE)) return process.env.LC_CTYPE
  if (isUtf8Locale(process.env.LANG)) return process.env.LANG
  if (process.platform === 'darwin') return 'en_US.UTF-8'
  if (process.platform === 'win32') return 'C.UTF-8'
  return 'en_US.UTF-8'
}

function buildShellEnv(colorMode: TerminalColorMode): NodeJS.ProcessEnv {
  // xterm-256color matches what xterm.js advertises and keeps color-capable
  // programs (ls, git, etc.) emitting escape codes.
  // LANG/LC_ALL ensure the child shell uses a UTF-8 locale so that CJK
  // output (echo, git log, cat, etc.) is not garbled. Electron launched
  // from Finder/Dock does not inherit the login-shell locale that
  // ~/.zprofile/~/.zshrc would normally set.
  const locale = resolveLocale()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    LANG: locale,
    LC_ALL: locale
  }
  // In monochrome mode we deliberately do NOT advertise truecolor: COLORTERM
  // would let tools emit 24-bit (ESC[38;2;R;G;Bm) sequences that bypass the
  // xterm palette entirely, defeating the mono theme. Without it, color-aware
  // programs fall back to the 16-color ANSI palette, which the mono theme maps
  // to the foreground. The xterm theme additionally neutralizes the 256-color
  // (16-255) range so even 8-bit color sequences stay monochrome.
  // Inherited COLORTERM from the parent env is stripped for the same reason.
  if (colorMode === 'none') {
    delete env.COLORTERM
  } else {
    env.COLORTERM = 'truecolor'
  }
  return env
}

function pushToRingBuffer(session: TerminalSession, chunk: string): void {
  session.ringBuffer += chunk
  if (session.ringBuffer.length > TERMINAL_RING_BUFFER_BYTES) {
    session.ringBuffer = session.ringBuffer.slice(-TERMINAL_RING_BUFFER_BYTES)
  }
}

function sendToSender(sender: WebContents, channel: string, payload: unknown): void {
  if (sender.isDestroyed()) return
  sender.send(channel, payload)
}

export type RegisterTerminalPtyIpcOptions = {
  ipcMain: IpcMain
  getMainWindow: () => BrowserWindow | null
  logError: (category: string, message: string, detail?: unknown) => void
  /**
   * Resolve the current terminal color mode so the spawned shell's env can be
   * tuned (e.g. dropping COLORTERM in monochrome mode). Defaults to 'none'
   * when not provided.
   */
  getTerminalColorMode?: () => TerminalColorMode | Promise<TerminalColorMode>
}

export function registerTerminalPtyIpc(options: RegisterTerminalPtyIpcOptions): void {
  const { ipcMain, getMainWindow, logError, getTerminalColorMode } = options
  const sessions = new Map<string, TerminalSession>()

  const disposeSession = (sessionId: string, killedByClient: boolean): boolean => {
    const session = sessions.get(sessionId)
    if (!session) return false
    try {
      session.pty.kill()
    } catch (error) {
      logError('terminal', 'Failed to kill PTY process', {
        sessionId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
    sessions.delete(sessionId)
    if (!killedByClient && !session.sender.isDestroyed()) {
      sendToSender(session.sender, 'terminal:exit', { sessionId, exitCode: null })
    }
    return true
  }

  const disposeForSender = (sender: WebContents): void => {
    for (const [sessionId, session] of sessions) {
      if (session.sender === sender) disposeSession(sessionId, true)
    }
  }

  // When the renderer window closes, tear down any PTY it owned. Listening
  // on the main window's webContents covers the normal single-window case.
  const attachSenderCleanup = (sender: WebContents): void => {
    if (sender.isDestroyed()) {
      disposeForSender(sender)
      return
    }
    sender.once('destroyed', () => disposeForSender(sender))
  }

  ipcMain.handle('terminal:create', async (event, args: unknown) => {
    const request = terminalCreatePayloadSchema.parse(args)

    // Re-attach to an existing session: replay the ring buffer so reopening
    // the panel shows recent output instead of a blank screen.
    const existing = sessions.get(request.sessionId)
    if (existing && !existing.exited) {
      if (existing.ringBuffer) {
        sendToSender(event.sender, 'terminal:data', {
          sessionId: request.sessionId,
          data: existing.ringBuffer
        })
      }
      // Rebind to the current sender in case the window was recreated.
      existing.sender = event.sender
      attachSenderCleanup(event.sender)
      return { ok: true as const, sessionId: request.sessionId, replayed: true }
    }
    if (existing && existing.exited) {
      disposeSession(request.sessionId, true)
    }

    if (sessions.size >= TERMINAL_MAX_SESSIONS) {
      return {
        ok: false as const,
        message: `Too many terminal sessions (limit ${TERMINAL_MAX_SESSIONS}).`
      }
    }

    const ptyModule = await loadNodePty()
    if (!ptyModule) {
      return {
        ok: false as const,
        message: 'The terminal backend (node-pty) is not available on this system.'
      }
    }

    const { file, args: shellArgs } = resolveDefaultShell()
    const cols = request.cols ?? TERMINAL_DEFAULT_COLS
    const rows = request.rows ?? TERMINAL_DEFAULT_ROWS
    const cwd = request.cwd && request.cwd.trim() ? request.cwd.trim() : homedir()
    let colorMode: TerminalColorMode = 'none'
    try {
      colorMode = (await getTerminalColorMode?.()) ?? 'none'
    } catch (error) {
      logError('terminal', 'Failed to resolve terminal color mode', {
        sessionId: request.sessionId,
        message: error instanceof Error ? error.message : String(error)
      })
    }

    try {
      const pty = ptyModule.spawn(file, shellArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: buildShellEnv(colorMode),
        // ConPTY on Windows, ignored elsewhere.
        useConpty: true
      })

      const session: TerminalSession = {
        pty,
        sender: event.sender,
        ringBuffer: '',
        exited: false
      }
      sessions.set(request.sessionId, session)
      attachSenderCleanup(event.sender)

      pty.onData((data) => {
        if (session.exited) return
        pushToRingBuffer(session, data)
        sendToSender(session.sender, 'terminal:data', { sessionId: request.sessionId, data })
      })

      pty.onExit(({ exitCode }) => {
        session.exited = true
        sendToSender(session.sender, 'terminal:exit', { sessionId: request.sessionId, exitCode })
        // Keep the entry briefly so a slow re-attach can still replay; the
        // next create disposes it. Full cleanup also happens on app quit.
      })

      return { ok: true as const, sessionId: request.sessionId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logError('terminal', 'Failed to spawn PTY', { sessionId: request.sessionId, message })
      return { ok: false as const, message }
    }
  })

  ipcMain.handle('terminal:write', async (event, args: unknown) => {
    const request = terminalWritePayloadSchema.parse(args)
    const session = sessions.get(request.sessionId)
    if (!session || session.exited) return false
    try {
      session.pty.write(request.data)
      return true
    } catch (error) {
      logError('terminal', 'Failed to write to PTY', {
        sessionId: request.sessionId,
        message: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  })

  ipcMain.handle('terminal:resize', async (event, args: unknown) => {
    const request = terminalResizePayloadSchema.parse(args)
    const session = sessions.get(request.sessionId)
    if (!session || session.exited) return false
    try {
      session.pty.resize(request.cols, request.rows)
      return true
    } catch (error) {
      logError('terminal', 'Failed to resize PTY', {
        sessionId: request.sessionId,
        message: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  })

  ipcMain.handle('terminal:dispose', async (_event, sessionId: unknown) => {
    const normalized = terminalSessionIdSchema.parse(sessionId)
    return disposeSession(normalized, true)
  })

  // App-wide teardown so no orphaned shell survives a normal quit. Lazily
  // importing `electron` here keeps the module side-effect-free for tests.
  void import('electron').then(({ app }) => {
    app.on('before-quit', () => {
      for (const sessionId of Array.from(sessions.keys())) {
        disposeSession(sessionId, true)
      }
    })
  })

  // If the main window is recreated (e.g. on macOS reactivation), make sure
  // stale sessions bound to a destroyed window are torn down.
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    attachSenderCleanup(mainWindow.webContents)
  }
}
