import { BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn as spawnPty, type IPty } from 'node-pty'
import { randomUUID } from 'node:crypto'
import type {
  TerminalCreateOptions,
  TerminalCreateResult,
  TerminalDataPayload,
  TerminalExitPayload,
  TerminalInputPayload,
  TerminalLifecyclePayload,
  TerminalResizePayload
} from '../../shared/terminal-session'
import { expandHomePath } from './workspace-service'

type TerminalSessionState = {
  id: string
  windowId: number
  pty: IPty
  pendingData: string
  flushTimer: ReturnType<typeof setTimeout> | null
}

const TERMINAL_DATA_FLUSH_MS = 16

function resolveTerminalShell(): { file: string; args: string[]; name: string } {
  if (process.platform === 'win32') {
    const file = process.env.COMSPEC?.trim() || 'cmd.exe'
    return { file, args: [], name: 'xterm-color' }
  }

  const shellPath = process.env.SHELL?.trim() || ''

  if (shellPath && existsSync(shellPath)) {
    return { file: shellPath, args: ['-l'], name: 'xterm-256color' }
  }

  if (process.platform === 'darwin') {
    if (existsSync('/bin/zsh')) return { file: '/bin/zsh', args: ['-l'], name: 'xterm-256color' }
    if (existsSync('/bin/bash')) return { file: '/bin/bash', args: ['-l'], name: 'xterm-256color' }
  }

  if (existsSync('/bin/bash')) return { file: '/bin/bash', args: ['-l'], name: 'xterm-256color' }
  if (existsSync('/bin/sh')) return { file: '/bin/sh', args: ['-l'], name: 'xterm-256color' }

  return { file: shellPath || '/bin/bash', args: ['-l'], name: 'xterm-256color' }
}

function normalizeTerminalDimension(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(20, Math.floor(value))
}

async function resolveTerminalCwd(raw: string): Promise<string> {
  const target = resolve(expandHomePath(raw))
  const info = await stat(target)
  if (!info.isDirectory()) {
    throw new Error(`Not a directory: ${raw}`)
  }
  return target
}

export function createTerminalService() {
  const terminalSessions = new Map<string, TerminalSessionState>()

  function sendTerminalEvent(
    windowId: number,
    channel: 'terminal:data',
    payload: TerminalDataPayload
  ): boolean
  function sendTerminalEvent(
    windowId: number,
    channel: 'terminal:exit',
    payload: TerminalExitPayload
  ): boolean
  function sendTerminalEvent(
    windowId: number,
    channel: 'terminal:data' | 'terminal:exit',
    payload: TerminalDataPayload | TerminalExitPayload
  ): boolean {
    const window = BrowserWindow.fromId(windowId)
    if (!window || window.isDestroyed()) return false
    const contents = window.webContents
    if (contents.isDestroyed()) return false
    try {
      contents.send(channel, payload)
      return true
    } catch {
      return false
    }
  }

  function disposeTerminalSession(sessionId: string): boolean {
    const session = terminalSessions.get(sessionId)
    if (!session) return false
    terminalSessions.delete(sessionId)
    if (session.flushTimer) {
      clearTimeout(session.flushTimer)
      session.flushTimer = null
    }
    session.pendingData = ''
    try {
      session.pty.kill()
    } catch {
      /* ignore cleanup failures */
    }
    return true
  }

  function flushTerminalSessionData(sessionId: string): boolean {
    const session = terminalSessions.get(sessionId)
    if (!session) return false
    if (session.flushTimer) {
      clearTimeout(session.flushTimer)
      session.flushTimer = null
    }
    if (!session.pendingData) return true
    const data = session.pendingData
    session.pendingData = ''
    if (!sendTerminalEvent(session.windowId, 'terminal:data', { sessionId, data })) {
      disposeTerminalSession(sessionId)
      return false
    }
    return true
  }

  function scheduleTerminalSessionFlush(sessionId: string): void {
    const session = terminalSessions.get(sessionId)
    if (!session || session.flushTimer) return
    session.flushTimer = setTimeout(() => {
      const next = terminalSessions.get(sessionId)
      if (!next) return
      next.flushTimer = null
      void flushTerminalSessionData(sessionId)
    }, TERMINAL_DATA_FLUSH_MS)
  }

  function disposeTerminalSessionsForWindow(windowId: number): void {
    for (const [sessionId, session] of terminalSessions.entries()) {
      if (session.windowId === windowId) {
        disposeTerminalSession(sessionId)
      }
    }
  }

  async function createTerminalSession(
    sender: Electron.WebContents,
    options: TerminalCreateOptions
  ): Promise<TerminalCreateResult> {
    try {
      const cwd = await resolveTerminalCwd(options.cwd)
      const windowId = BrowserWindow.fromWebContents(sender)?.id
      if (!windowId) {
        throw new Error('Could not resolve the current window.')
      }

      const shellConfig = resolveTerminalShell()
      const sessionId = randomUUID()
      const cols = normalizeTerminalDimension(options.cols, 120)
      const rows = normalizeTerminalDimension(options.rows, 32)
      const env = {
        ...process.env,
        TERM: shellConfig.name,
        COLORTERM: 'truecolor'
      }

      const pty = spawnPty(shellConfig.file, shellConfig.args, {
        name: shellConfig.name,
        cwd,
        cols,
        rows,
        env
      })

      terminalSessions.set(sessionId, {
        id: sessionId,
        windowId,
        pty,
        pendingData: '',
        flushTimer: null
      })

      pty.onData((data) => {
        const session = terminalSessions.get(sessionId)
        if (!session) return
        session.pendingData += data
        scheduleTerminalSessionFlush(sessionId)
      })

      pty.onExit(({ exitCode, signal }) => {
        flushTerminalSessionData(sessionId)
        const session = terminalSessions.get(sessionId)
        if (session?.flushTimer) {
          clearTimeout(session.flushTimer)
          session.flushTimer = null
        }
        terminalSessions.delete(sessionId)
        sendTerminalEvent(windowId, 'terminal:exit', { sessionId, exitCode, signal })
      })

      return {
        ok: true,
        session: {
          id: sessionId,
          cwd,
          shell: shellConfig.file
        }
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  function writeTerminalSession(payload: TerminalInputPayload): boolean {
    const session = terminalSessions.get(payload.sessionId)
    if (!session) return false
    session.pty.write(payload.data)
    return true
  }

  function resizeTerminalSession(payload: TerminalResizePayload): boolean {
    const session = terminalSessions.get(payload.sessionId)
    if (!session) return false
    session.pty.resize(
      normalizeTerminalDimension(payload.cols, session.pty.cols),
      normalizeTerminalDimension(payload.rows, session.pty.rows)
    )
    return true
  }

  function closeTerminalSession(payload: TerminalLifecyclePayload): boolean {
    return disposeTerminalSession(payload.sessionId)
  }

  return {
    createTerminalSession,
    writeTerminalSession,
    resizeTerminalSession,
    closeTerminalSession,
    disposeTerminalSessionsForWindow
  }
}
