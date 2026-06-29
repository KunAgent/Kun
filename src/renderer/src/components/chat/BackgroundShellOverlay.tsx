import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Loader2, SquareTerminal, X } from 'lucide-react'
import {
  KUN_BACKGROUND_SHELLS_PATH,
  kunBackgroundShellStopPath
} from '@shared/kun-endpoints'
import { rendererRuntimeClient } from '../../agent/runtime-client'

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

async function fetchBackgroundShells(threadId?: string): Promise<BackgroundShellListResponse> {
  const query = threadId ? `?thread_id=${encodeURIComponent(threadId)}` : ''
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
  runtimeReady?: boolean
}

export function BackgroundShellOverlay({
  runtimeReady = true
}: BackgroundShellOverlayProps): ReactElement | null {
  const { t } = useTranslation('chat')
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<BackgroundShellSession[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!runtimeReady) return
    const data = await fetchBackgroundShells()
    setSessions(data.sessions)
  }, [runtimeReady])

  useEffect(() => {
    void refresh()
    if (!runtimeReady) return
    const timer = window.setInterval(() => {
      void refresh()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [refresh, runtimeReady])

  const runningCount = useMemo(
    () => sessions.filter((session) => session.status === 'running').length,
    [sessions]
  )
  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? sessions[0] ?? null,
    [selectedId, sessions]
  )

  if (runningCount <= 0 && !open) return null

  const handleStop = async (sessionId: string) => {
    await stopBackgroundShell(sessionId)
    await refresh()
  }

  return (
    <div className="pointer-events-none flex w-full max-w-[min(100vw-2rem,28rem)] flex-col items-center gap-2">
      {open ? (
        <div className="pointer-events-auto w-full overflow-hidden rounded-2xl border border-ds-border-muted bg-ds-card/95 shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-ds-border-muted px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-ds-text">
                {t('backgroundShells.title', { defaultValue: 'Background shells' })}
              </p>
              <p className="text-[11px] text-ds-muted">
                {t('backgroundShells.runningCount', {
                  defaultValue: '{{count}} running',
                  count: runningCount
                })}
              </p>
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-ds-muted hover:bg-ds-hover hover:text-ds-text"
              aria-label={t('backgroundShells.close', { defaultValue: 'Close panel' })}
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {sessions.length === 0 ? (
              <p className="px-3 py-4 text-[12px] text-ds-muted">
                {t('backgroundShells.empty', { defaultValue: 'No background shells.' })}
              </p>
            ) : (
              sessions.map((session) => {
                const active = selected?.id === session.id
                return (
                  <button
                    key={session.id}
                    type="button"
                    className={`flex w-full items-start gap-2 border-b border-ds-border-muted/60 px-3 py-2 text-left last:border-b-0 ${
                      active ? 'bg-ds-hover/70' : 'hover:bg-ds-hover/40'
                    }`}
                    onClick={() => setSelectedId(session.id)}
                  >
                    <span className="mt-0.5 shrink-0">
                      {session.status === 'running' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                      ) : (
                        <SquareTerminal className="h-3.5 w-3.5 text-ds-muted" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[11px] text-ds-text">{session.command}</span>
                      <span className="block truncate text-[10px] text-ds-muted">
                        {session.id} · {session.status}
                        {session.exitCode !== null ? ` · exit ${session.exitCode}` : ''}
                      </span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
          {selected ? (
            <div className="border-t border-ds-border-muted px-3 py-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="truncate font-mono text-[11px] text-ds-muted">{selected.command}</p>
                {selected.status === 'running' ? (
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-ds-border-muted px-2 py-1 text-[11px] text-ds-text hover:bg-ds-hover"
                    onClick={() => void handleStop(selected.id)}
                  >
                    {t('backgroundShells.stop', { defaultValue: 'Stop' })}
                  </button>
                ) : null}
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ds-main/80 p-2 font-mono text-[11px] leading-5 text-ds-text">
                {selected.output.trim() || t('backgroundShells.noOutput', { defaultValue: '(no output yet)' })}
              </pre>
              {selected.outputFilePath ? (
                <p className="mt-2 truncate font-mono text-[10px] text-ds-muted" title={selected.outputFilePath}>
                  {t('backgroundShells.outputFile', { defaultValue: 'Full output' })}: {selected.outputFilePath}
                  {selected.outputTruncated
                    ? ` · ${t('backgroundShells.outputTruncated', { defaultValue: 'preview truncated' })}`
                    : ''}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-ds-border-muted bg-ds-card/95 px-3 py-1.5 text-[12px] font-medium text-ds-text shadow-lg backdrop-blur-md hover:bg-ds-hover"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <SquareTerminal className="h-3.5 w-3.5 text-accent" />
        <span>
          {t('backgroundShells.badge', {
            defaultValue: '{{count}} background shell(s)',
            count: runningCount
          })}
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}
