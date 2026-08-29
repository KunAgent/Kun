import type { CSSProperties, ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Loader2, SquareTerminal, X } from 'lucide-react'
import {
  KUN_BACKGROUND_SHELLS_PATH,
  kunBackgroundShellStopPath
} from '@shared/kun-endpoints'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import {
  calculateComposerPopoverPlacement,
  currentComposerBodyZoom,
  type ComposerPopoverAnchorRect,
  type ComposerPopoverPlacement
} from './floating-composer-popover-placement'

const SHELL_POPOVER_WIDTH = 736
const SHELL_POPOVER_MAX_HEIGHT = 620
const SHELL_POPOVER_ESTIMATED_HEIGHT = 560

type BackgroundShellSession = {
  id: string
  threadId: string
  turnId: string
  command: string
  cwd: string
  shell: string
  status: 'running' | 'completed' | 'stopped' | 'failed'
  startedAt: string
  finishedAt?: string
  exitCode: number | null
  output: string
  outputTruncated?: boolean
  outputFilePath?: string
  error?: string
  detached: boolean
}

type BackgroundShellListResponse = {
  sessions: BackgroundShellSession[]
  running: number
}

export function calculateBackgroundShellPopoverPlacement({
  anchorRect,
  popoverHeight,
  viewportHeight,
  viewportWidth,
  coordinateScale = 1
}: {
  anchorRect: ComposerPopoverAnchorRect
  popoverHeight: number
  viewportHeight: number
  viewportWidth: number
  coordinateScale?: number
}): ComposerPopoverPlacement {
  return calculateComposerPopoverPlacement({
    anchorRect,
    popoverHeight,
    viewportHeight,
    viewportWidth,
    coordinateScale,
    preferredWidth: SHELL_POPOVER_WIDTH,
    maximumHeight: SHELL_POPOVER_MAX_HEIGHT
  })
}

async function fetchBackgroundShells(threadId: string): Promise<BackgroundShellListResponse> {
  const query = `?thread_id=${encodeURIComponent(threadId)}`
  const result = await rendererRuntimeClient.runtimeRequest(`${KUN_BACKGROUND_SHELLS_PATH}${query}`)
  if (!result.ok) return { sessions: [], running: 0 }
  try {
    return JSON.parse(result.body) as BackgroundShellListResponse
  } catch {
    return { sessions: [], running: 0 }
  }
}

async function stopBackgroundShell(sessionId: string): Promise<void> {
  await rendererRuntimeClient.runtimeRequest(kunBackgroundShellStopPath(sessionId), 'POST')
}

type BackgroundShellOverlayProps = {
  threadId: string | null
  runtimeReady?: boolean
}

export function BackgroundShellOverlay({
  threadId,
  runtimeReady = true
}: BackgroundShellOverlayProps): ReactElement | null {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<BackgroundShellSession[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [placement, setPlacement] = useState<ComposerPopoverPlacement | null>(null)
  const requestIdRef = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const runtimeContextRef = useRef({ runtimeReady, threadId })
  runtimeContextRef.current = { runtimeReady, threadId }

  const refresh = useCallback(async () => {
    if (!runtimeReady || !threadId) return
    const requestContext = runtimeContextRef.current
    if (!requestContext.runtimeReady || requestContext.threadId !== threadId) return
    const requestId = ++requestIdRef.current
    const data = await fetchBackgroundShells(threadId)
    const currentContext = runtimeContextRef.current
    if (
      requestId !== requestIdRef.current ||
      !currentContext.runtimeReady ||
      currentContext.threadId !== threadId
    ) return
    setSessions(data.sessions.filter((session) => session.threadId === threadId))
  }, [runtimeReady, threadId])

  useEffect(() => {
    requestIdRef.current += 1
    setOpen(false)
    setSessions([])
    setSelectedId(null)
    void refresh()
    if (!runtimeReady || !threadId) return
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => {
      requestIdRef.current += 1
      window.clearInterval(timer)
    }
  }, [refresh, runtimeReady, threadId])

  const scopedSessions = useMemo(
    () => threadId ? sessions.filter((session) => session.threadId === threadId) : [],
    [sessions, threadId]
  )
  const runningCount = useMemo(
    () => scopedSessions.filter((session) => session.status === 'running').length,
    [scopedSessions]
  )
  const selected = useMemo(
    () => scopedSessions.find((session) => session.id === selectedId) ?? scopedSessions[0] ?? null,
    [selectedId, scopedSessions]
  )

  useEffect(() => {
    if (!open || typeof window === 'undefined') {
      setPlacement(null)
      return
    }
    const updatePlacement = (): void => {
      const button = buttonRef.current
      if (!button) return
      setPlacement(calculateBackgroundShellPopoverPlacement({
        anchorRect: button.getBoundingClientRect(),
        popoverHeight: popoverRef.current?.offsetHeight ?? SHELL_POPOVER_ESTIMATED_HEIGHT,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        coordinateScale: currentComposerBodyZoom()
      }))
    }
    updatePlacement()
    const frame = window.requestAnimationFrame(updatePlacement)
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [open, scopedSessions, selectedId])

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (runningCount <= 0 && !open) return null

  const handleStop = async (sessionId: string): Promise<void> => {
    await stopBackgroundShell(sessionId)
    await refresh()
  }
  const popoverStyle: CSSProperties = placement
    ? {
        left: `${placement.left}px`,
        top: `${placement.top}px`,
        width: `${placement.width}px`,
        maxHeight: `${placement.maxHeight}px`
      }
    : {
        left: 0,
        top: 0,
        width: `${SHELL_POPOVER_WIDTH}px`,
        maxHeight: `${SHELL_POPOVER_MAX_HEIGHT}px`,
        visibility: 'hidden'
      }

  const popover = (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={t('backgroundShells.title')}
      className="ds-no-drag fixed z-[1000] flex min-h-0 flex-col overflow-hidden rounded-[22px] border border-ds-border bg-white text-ds-ink shadow-[0_18px_48px_rgba(20,47,95,0.16)] dark:bg-ds-card"
      style={popoverStyle}
      data-background-shell-popover
    >
      <div className="flex shrink-0 items-center justify-between border-b border-ds-border-muted px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-ds-ink">{t('backgroundShells.title')}</p>
          <p className="text-[11px] text-ds-muted">{t('backgroundShells.runningCount', { count: runningCount })}</p>
        </div>
        <button
          type="button"
          className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          aria-label={t('backgroundShells.close')}
          onClick={() => setOpen(false)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(8rem,1fr)] overflow-hidden">
        <div className="max-h-48 min-h-0 overflow-y-auto border-b border-ds-border-muted">
          {scopedSessions.length === 0 ? (
            <p className="px-4 py-5 text-[12px] text-ds-muted">{t('backgroundShells.empty')}</p>
          ) : scopedSessions.map((session) => {
            const active = selected?.id === session.id
            return (
              <button
                key={session.id}
                type="button"
                className={`flex w-full items-start gap-2 border-b border-ds-border-muted/60 px-4 py-2.5 text-left last:border-b-0 ${active ? 'bg-ds-hover/70' : 'hover:bg-ds-hover/40'}`}
                onClick={() => setSelectedId(session.id)}
              >
                <span className="mt-0.5 shrink-0">
                  {session.status === 'running'
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                    : <SquareTerminal className="h-3.5 w-3.5 text-ds-muted" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[11px] text-ds-ink">{session.command}</span>
                  <span className="block truncate text-[10px] text-ds-muted">
                    {session.id} · {t(`backgroundShells.status.${session.status}`)}
                    {session.exitCode !== null ? ` · ${t('backgroundShells.exitCode', { code: session.exitCode })}` : ''}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
        {selected ? (
          <div className="flex min-h-0 flex-col px-4 py-3">
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <p className="truncate font-mono text-[11px] text-ds-muted">{selected.command}</p>
              {selected.status === 'running' ? (
                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-ds-border-muted px-2.5 py-1 text-[11px] text-ds-ink transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                  onClick={() => void handleStop(selected.id)}
                >
                  {t('backgroundShells.stop')}
                </button>
              ) : null}
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-ds-main/80 p-3 font-mono text-[11px] leading-5 text-ds-ink">
              {selected.output.trim() || t('backgroundShells.noOutput')}
            </pre>
            {selected.outputFilePath ? (
              <p className="mt-2 shrink-0 truncate font-mono text-[10px] text-ds-muted" title={selected.outputFilePath}>
                {t('backgroundShells.outputFile')}: {selected.outputFilePath}
                {selected.outputTruncated ? ` · ${t('backgroundShells.outputTruncated')}` : ''}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )

  return (
    <>
      {open && typeof document !== 'undefined' ? createPortal(popover, document.body) : null}
      <div
        ref={rootRef}
        data-composer-stack-item="background-shell"
        className="pointer-events-auto relative shrink-0"
      >
        <button
          ref={buttonRef}
          type="button"
          className="ds-no-drag ds-composer-status-glass inline-flex h-11 items-center gap-2.5 rounded-full border px-4 text-[14px] font-medium text-ds-muted transition hover:border-ds-border-strong hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <SquareTerminal className="h-5 w-5 shrink-0 text-accent" strokeWidth={1.9} />
          <span>{t('backgroundShells.badge', { count: runningCount })}</span>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>
      </div>
    </>
  )
}
