import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { TFunction } from 'i18next'
import { Loader2, Square } from 'lucide-react'
import { kunDelegationAbortPath } from '@shared/kun-endpoints'
import { rendererRuntimeClient } from '../../agent/runtime-client'

export function SubagentStopControl({
  childId,
  active,
  t
}: {
  childId?: string
  active: boolean
  t: TFunction<'common'>
}): ReactElement | null {
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState('')
  const stoppingRef = useRef(false)

  useEffect(() => {
    if (!active) {
      stoppingRef.current = false
      setStopping(false)
      setError('')
    }
  }, [active])

  if (!childId || !active) return null

  const stop = async (): Promise<void> => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    setStopping(true)
    setError('')
    try {
      const response = await rendererRuntimeClient.runtimeRequest(
        kunDelegationAbortPath(childId),
        'POST'
      )
      const body = response.ok
        ? JSON.parse(response.body) as { aborted?: unknown }
        : undefined
      if (!response.ok || body?.aborted !== true) {
        throw new Error('subagent stop was not accepted')
      }
    } catch {
      stoppingRef.current = false
      setStopping(false)
      setError(t('subagentStopFailed', { defaultValue: 'Could not stop' }))
    }
  }

  const action = stopping
    ? t('subagentStoppingAction', { defaultValue: 'Stopping subagent' })
    : t('subagentStopAction', { defaultValue: 'Stop subagent' })
  return (
    <span className="relative shrink-0">
      <button
        type="button"
        disabled={stopping}
        onClick={(event) => {
          event.stopPropagation()
          void stop()
        }}
        className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold text-ds-faint transition hover:bg-red-500/10 hover:text-ds-danger disabled:cursor-wait disabled:opacity-60"
        aria-label={action}
        title={action}
        data-testid="subagent-stop-button"
      >
        {stopping ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <Square className="h-3 w-3 fill-current" strokeWidth={2} />
        )}
        <span className="hidden sm:inline">
          {stopping
            ? t('subagentStoppingShort', { defaultValue: 'Stopping' })
            : t('subagentStopShort', { defaultValue: 'Stop' })}
        </span>
      </button>
      {error ? (
        <span
          role="alert"
          className="absolute right-0 top-8 z-20 whitespace-nowrap rounded-md border border-red-200 bg-ds-card px-2 py-1 text-[10.5px] font-medium text-ds-danger shadow-lg dark:border-red-900/60"
        >
          {error}
        </span>
      ) : null}
    </span>
  )
}

/** Stops every still-active child of a swarm group in one click. */
export function SubagentStopAllButton({
  childIds,
  t
}: {
  childIds: string[]
  t: TFunction<'common'>
}): ReactElement | null {
  const [stopping, setStopping] = useState(false)
  useEffect(() => {
    if (childIds.length === 0) setStopping(false)
  }, [childIds.length])
  if (childIds.length === 0) return null
  const stopAll = async (): Promise<void> => {
    if (stopping) return
    setStopping(true)
    const results = await Promise.all(childIds.map((childId) =>
      rendererRuntimeClient.runtimeRequest(kunDelegationAbortPath(childId), 'POST').then(
        (response) => response.ok,
        () => false
      )
    ))
    if (results.some((ok) => !ok)) setStopping(false)
  }
  return (
    <button
      type="button"
      disabled={stopping}
      onClick={() => void stopAll()}
      className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium text-ds-muted transition hover:bg-red-500/10 hover:text-ds-danger disabled:cursor-wait disabled:opacity-60"
      data-testid="subagent-stop-all-button"
    >
      {stopping
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        : <Square className="h-3 w-3 fill-current" strokeWidth={2} />}
      {t('subagentStopAll', { defaultValue: 'Stop all' })}
    </button>
  )
}
