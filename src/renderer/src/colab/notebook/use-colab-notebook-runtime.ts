import { useCallback, useState } from 'react'
import type { ColabAccelerator, ColabConnectionView, ColabSessionView } from '@shared/colab/colab-types'
import {
  isColabSessionRunning,
  normalizeColabWorkspaceKey,
  selectWorkspaceActiveConnection,
  selectWorkspaceSessions,
  useColabStore,
  useColabSubscription
} from '../colab-store'
import { useColabNotebookStore } from './colab-notebook-store'

/** Marks runtimes provisioned for the notebook so training sessions are never reused as kernels. */
export const NOTEBOOK_ENTRY_COMMAND = 'kun-notebook'

export type ColabNotebookRuntime = {
  wsKey: string
  connection: ColabConnectionView | null
  /** Connected kernel runtime, ready for cell execution. */
  session: ColabSessionView | null
  /** Runtime being provisioned. */
  pending: ColabSessionView | null
  /** Most recent failed attempt, for surfacing the error. */
  failed: ColabSessionView | null
  connecting: boolean
  error: string | null
  connect: (accelerator: ColabAccelerator) => Promise<void>
  disconnect: () => Promise<void>
}

export function useColabNotebookRuntime(workspaceRoot: string): ColabNotebookRuntime {
  useColabSubscription()
  const snapshot = useColabStore((s) => s.snapshot)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wsKey = normalizeColabWorkspaceKey(workspaceRoot)
  const connection = selectWorkspaceActiveConnection(snapshot, workspaceRoot)
  const notebookSessions = selectWorkspaceSessions(snapshot, workspaceRoot).filter(
    (s) => s.entryCommand === NOTEBOOK_ENTRY_COMMAND
  )
  const session = notebookSessions.find((s) => s.phase === 'running') ?? null
  const pending = session ? null : notebookSessions.find((s) => isColabSessionRunning(s)) ?? null
  const failed = session || pending ? null : notebookSessions.find((s) => s.phase === 'failed') ?? null

  const connect = useCallback(
    async (accelerator: ColabAccelerator) => {
      if (!connection || !wsKey) return
      setConnecting(true)
      setError(null)
      try {
        const res = await window.kunGui.colabStartRun({
          workspaceRoot: wsKey,
          connectionId: connection.id,
          entryCommand: NOTEBOOK_ENTRY_COMMAND,
          accelerator,
          syncPaths: [],
          outputRemoteDir: '',
          outputLocalDir: '',
          maxRuntimeHours: 0,
          autoStop: false,
          terminalOnly: true
        })
        if (!res.ok) setError(res.message)
        else useColabNotebookStore.getState().resetKernelState()
      } finally {
        setConnecting(false)
      }
    },
    [connection, wsKey]
  )

  const disconnect = useCallback(async () => {
    const target = session ?? pending
    if (!target) return
    await useColabNotebookStore.getState().interrupt()
    await window.kunGui.colabStopSession({ sessionId: target.id })
    useColabNotebookStore.getState().resetKernelState()
  }, [pending, session])

  return { wsKey, connection, session, pending, failed, connecting, error, connect, disconnect }
}
