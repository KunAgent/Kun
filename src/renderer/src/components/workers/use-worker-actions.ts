import { useCallback, useState } from 'react'
import { getProvider } from '../../agent/registry'
import { formatRuntimeError } from '../../lib/format-runtime-error'
import type { WorkerRowData } from './worker-row-data'

export type WorkerBusyAction = { id: string; action: 'stop' | 'detach' | 'answer' }

/**
 * Stop / release / answer for a worker row. A child agent outside the team
 * has no team controls: Stop interrupts its turn. Every action refreshes
 * the team afterwards; a failure is kept for the surface to show.
 */
export function useWorkerActions(reload: () => Promise<void>): {
  busy: WorkerBusyAction | null
  error: string | null
  dismissError: () => void
  stop: (row: WorkerRowData) => void
  detach: (row: WorkerRowData) => void
  answer: (questionId: string, answer: string) => void
} {
  const [busy, setBusy] = useState<WorkerBusyAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback((id: string, action: WorkerBusyAction['action'], task: () => Promise<void>): void => {
    setBusy({ id, action })
    setError(null)
    void task()
      .then(reload)
      .catch((cause: unknown) => setError(formatRuntimeError(cause)))
      .finally(() => setBusy(null))
  }, [reload])
  const dismissError = useCallback(() => setError(null), [])

  const stop = useCallback((row: WorkerRowData): void => {
    run(row.workerId, 'stop', async () => {
      const provider = getProvider()
      if (row.child) {
        if (row.child.turnId) await provider.interruptTurn(row.child.threadId, row.child.turnId)
        return
      }
      await provider.controlTeamWorker?.(row.workerId, 'stop')
    })
  }, [run])
  const detach = useCallback((row: WorkerRowData): void => {
    run(row.workerId, 'detach', async () => {
      await getProvider().controlTeamWorker?.(row.workerId, 'detach')
    })
  }, [run])
  const answer = useCallback((questionId: string, text: string): void => {
    run(questionId, 'answer', async () => {
      await getProvider().answerTeamQuestion?.(questionId, text)
    })
  }, [run])
  return { busy, error, dismissError, stop, detach, answer }
}

export function busyActionFor(busy: WorkerBusyAction | null, row: WorkerRowData): WorkerBusyAction['action'] | null {
  if (!busy) return null
  return busy.id === row.workerId || busy.id === row.openQuestion?.questionId ? busy.action : null
}
