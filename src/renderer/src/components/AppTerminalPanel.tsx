import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { workspaceLabelFromPath } from '../lib/workspace-label'

type SessionState = {
  id: string
  cwd: string
  status: 'running' | 'exited'
  exitCode?: number
}

type TerminalHandle = {
  terminal: XTerm
  fitAddon: FitAddon
  inputDisposable: { dispose: () => void }
}

type Props = {
  workspaceRoot: string
  onClose: () => void
  className?: string
}

function readTerminalTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement)
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
  const accent = styles.getPropertyValue('--ds-accent').trim() || (dark ? '#339cff' : '#0088ff')
  const success = styles.getPropertyValue('--ds-success').trim() || (dark ? '#40c977' : '#128a4a')
  const danger = styles.getPropertyValue('--ds-danger').trim() || (dark ? '#fa423e' : '#c92a2a')
  const skill = styles.getPropertyValue('--ds-skill').trim() || (dark ? '#ad7bf9' : '#7c3aed')
  const canvasBg =
    styles.getPropertyValue('--ds-bg-canvas').trim() || (dark ? '#181818' : '#ffffff')
  const foreground = styles.getPropertyValue('--ds-text').trim() || (dark ? '#ffffff' : '#222222')
  return {
    background: canvasBg,
    foreground,
    cursor: foreground,
    selectionBackground: dark ? 'rgba(51,156,255,0.28)' : 'rgba(0,136,255,0.2)',
    black: dark ? '#242424' : '#374151',
    red: danger,
    green: success,
    yellow: '#f59e0b',
    blue: accent,
    magenta: skill,
    cyan: '#06b6d4',
    white: dark ? '#f4f4f4' : '#111827',
    brightBlack: dark ? '#7a7a7a' : '#6b7280',
    brightRed: dark ? '#ff7d79' : '#f87171',
    brightGreen: dark ? '#72df9b' : '#4ade80',
    brightYellow: '#fbbf24',
    brightBlue: dark ? '#7bbcff' : '#60a5fa',
    brightMagenta: dark ? '#c49bff' : '#e879f9',
    brightCyan: '#22d3ee',
    brightWhite: dark ? '#ffffff' : '#030712'
  }
}

export function AppTerminalPanel({
  workspaceRoot,
  onClose,
  className
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [sessions, setSessions] = useState<SessionState[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [creatingSession, setCreatingSession] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const sessionNodeRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const terminalHandlesRef = useRef<Map<string, TerminalHandle>>(new Map())
  const sessionsRef = useRef<SessionState[]>([])
  const hasStartedInitialSession = useRef(false)
  const fitFrameRef = useRef<number | null>(null)
  const trimmedWorkspaceRoot = workspaceRoot.trim()

  sessionsRef.current = sessions

  const baseLabel = useMemo(() => {
    const label = workspaceLabelFromPath(workspaceRoot)
    return label || t('terminalPanelTitle')
  }, [t, workspaceRoot])

  const scheduleFit = (sessionId: string | null): void => {
    if (!sessionId) return
    if (fitFrameRef.current !== null) {
      window.cancelAnimationFrame(fitFrameRef.current)
    }
    fitFrameRef.current = window.requestAnimationFrame(() => {
      const handle = terminalHandlesRef.current.get(sessionId)
      if (!handle) return
      handle.fitAddon.fit()
      if (handle.terminal.cols > 0 && handle.terminal.rows > 0) {
        void window.dsGui?.resizeTerminalSession?.({
          sessionId,
          cols: handle.terminal.cols,
          rows: handle.terminal.rows
        })
      }
    })
  }

  const createSession = useCallback(async (): Promise<void> => {
    const cwd = trimmedWorkspaceRoot
    if (!cwd || creatingSession || typeof window.dsGui?.createTerminalSession !== 'function') return

    setCreatingSession(true)
    setCreateError(null)
    try {
      const result = await window.dsGui.createTerminalSession({
        cwd,
        cols: 120,
        rows: 32
      })
      if (!result.ok) {
        setCreateError(result.message)
        return
      }
      setSessions((prev) => [...prev, { id: result.session.id, cwd: result.session.cwd, status: 'running' }])
      setActiveSessionId(result.session.id)
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error))
    } finally {
      setCreatingSession(false)
    }
  }, [creatingSession, trimmedWorkspaceRoot])

  useEffect(() => {
    if (!trimmedWorkspaceRoot) return
    if (hasStartedInitialSession.current) return
    hasStartedInitialSession.current = true
    void createSession()
  }, [createSession, trimmedWorkspaceRoot])

  useEffect(() => {
    if (typeof window.dsGui?.onTerminalData !== 'function' || typeof window.dsGui?.onTerminalExit !== 'function') {
      return
    }

    const offData = window.dsGui.onTerminalData(({ sessionId, data }) => {
      terminalHandlesRef.current.get(sessionId)?.terminal.write(data)
    })

    const offExit = window.dsGui.onTerminalExit(({ sessionId, exitCode }) => {
      const handle = terminalHandlesRef.current.get(sessionId)
      handle?.terminal.write(`\r\n${t('terminalExited', { code: exitCode })}\r\n`)
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId ? { ...session, status: 'exited', exitCode } : session
        )
      )
    })

    return () => {
      offData()
      offExit()
    }
  }, [t])

  useEffect(() => {
    for (const session of sessions) {
      const host = sessionNodeRefs.current[session.id]
      if (!host || terminalHandlesRef.current.has(session.id)) continue

      const terminal = new XTerm({
        cursorBlink: true,
        convertEol: true,
        fontFamily: '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        fontSize: 13,
        lineHeight: 1.35,
        scrollback: 8_000,
        theme: readTerminalTheme()
      })
      const fitAddon = new FitAddon()
      terminal.loadAddon(fitAddon)
      terminal.open(host)
      const inputDisposable = terminal.onData((data) => {
        void window.dsGui?.writeTerminalSession?.({ sessionId: session.id, data })
      })

      terminalHandlesRef.current.set(session.id, {
        terminal,
        fitAddon,
        inputDisposable
      })

      scheduleFit(session.id)
    }

    for (const [sessionId, handle] of terminalHandlesRef.current.entries()) {
      if (sessions.some((session) => session.id === sessionId)) continue
      handle.inputDisposable.dispose()
      handle.terminal.dispose()
      terminalHandlesRef.current.delete(sessionId)
      delete sessionNodeRefs.current[sessionId]
    }
  }, [sessions])

  useEffect(() => {
    scheduleFit(activeSessionId)
  }, [activeSessionId, sessions.length])

  useEffect(() => {
    const onResize = (): void => scheduleFit(activeSessionId)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [activeSessionId])

  useEffect(() => {
    if (!viewportRef.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => scheduleFit(activeSessionId))
    observer.observe(viewportRef.current)
    return () => observer.disconnect()
  }, [activeSessionId])

  useEffect(() => {
    const terminalHandles = terminalHandlesRef.current
    return () => {
      if (fitFrameRef.current !== null) {
        window.cancelAnimationFrame(fitFrameRef.current)
      }
      for (const session of sessionsRef.current) {
        void window.dsGui?.closeTerminalSession?.({ sessionId: session.id })
      }
      for (const handle of terminalHandles.values()) {
        handle.inputDisposable.dispose()
        handle.terminal.dispose()
      }
      terminalHandles.clear()
    }
  }, [])

  const closeSession = (sessionId: string): void => {
    void window.dsGui?.closeTerminalSession?.({ sessionId })
    const handle = terminalHandlesRef.current.get(sessionId)
    if (handle) {
      handle.inputDisposable.dispose()
      handle.terminal.dispose()
      terminalHandlesRef.current.delete(sessionId)
    }
    delete sessionNodeRefs.current[sessionId]
    setSessions((prev) => {
      const next = prev.filter((session) => session.id !== sessionId)
      if (activeSessionId === sessionId) {
        setActiveSessionId(next.length > 0 ? next[0].id : null)
      }
      return next
    })
  }

  return (
    <section className={`ds-no-drag ds-terminal-panel flex min-h-0 flex-col overflow-hidden ${className ?? ''}`}>
      <div className="ds-terminal-panel__tabs flex shrink-0 items-center justify-between gap-2 border-b border-ds-border-muted px-2.5 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sessions.map((session, index) => {
            const active = session.id === activeSessionId
            return (
              <span
                key={session.id}
                className={`inline-flex shrink-0 items-center gap-0.5 rounded-lg border transition ${
                  active
                    ? 'border-ds-border-muted bg-white/90 text-ds-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:border-white/10 dark:bg-white/10 dark:shadow-none'
                    : 'border-transparent text-ds-faint hover:border-ds-border-muted/60 hover:bg-ds-hover/50 hover:text-ds-ink'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveSessionId(session.id)}
                  className="max-w-[200px] truncate px-2.5 py-1 text-[12.5px] font-medium"
                  title={session.cwd}
                >
                  {`${baseLabel} ${index + 1}`}
                  {session.status === 'exited' ? (
                    <span className="ml-1.5 rounded bg-ds-hover px-1 py-0.5 text-[10px] font-medium text-ds-faint">
                      {session.exitCode ?? 0}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    closeSession(session.id)
                  }}
                  className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded text-ds-faint hover:bg-ds-hover/80 hover:text-ds-ink"
                  aria-label={t('terminalCloseTab')}
                  title={t('terminalCloseTab')}
                >
                  <X className="h-3 w-3" strokeWidth={2} />
                </button>
              </span>
            )
          })}
            <button
              type="button"
              onClick={() => void createSession()}
              disabled={creatingSession || !trimmedWorkspaceRoot}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover/70 hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45"
              aria-label={t('terminalNewTab')}
              title={t('terminalNewTab')}
          >
            {creatingSession ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
            ) : (
              <Plus className="h-4 w-4" strokeWidth={1.9} />
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover/70 hover:text-ds-ink"
          aria-label={t('terminalClose')}
          title={t('terminalClose')}
        >
          <X className="h-4 w-4" strokeWidth={1.85} />
        </button>
      </div>

      {createError ? (
        <div className="shrink-0 border-b border-red-200/70 bg-red-50/80 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-500/20 dark:bg-red-500/8 dark:text-red-200">
          {t('terminalCreateFailed', { message: createError })}
        </div>
      ) : null}

      <div ref={viewportRef} className="min-h-0 flex-1">
        {sessions.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-ds-faint">
            {creatingSession ? t('terminalStarting') : t('terminalEmpty')}
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={session.id === activeSessionId ? 'h-full w-full' : 'hidden h-full w-full'}
            >
              <div
                ref={(node) => {
                  sessionNodeRefs.current[session.id] = node
                }}
                className="ds-terminal-host h-full w-full"
              />
            </div>
          ))
        )}
      </div>
    </section>
  )
}
