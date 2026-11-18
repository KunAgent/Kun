import { useCallback, useState } from 'react'
import type { ColabAccelerator, ColabConnectionView, ColabSessionView } from '@shared/colab/colab-types'
import { COLAB_NOTEBOOK_ENTRY_COMMAND } from '@shared/colab/colab-notebook-types'
import type {
  JupyterConnectRequest,
  JupyterServerView,
  JupyterSessionView,
  NotebookRuntimeBackend
} from '@shared/colab/colab-notebook-types'
import {
  isColabSessionRunning,
  normalizeColabWorkspaceKey,
  selectWorkspaceActiveConnection,
  selectWorkspaceSessions,
  useColabStore,
  useColabSubscription
} from '../colab-store'
import { COLAB_REMOTE_ROOT, useColabNotebookStore } from './colab-notebook-store'
import { useJupyterStore, useJupyterSubscription } from './jupyter-store'

export type ColabNotebookRuntime = {
  wsKey: string
  backend: NotebookRuntimeBackend
  setBackend: (backend: NotebookRuntimeBackend) => void
  connection: ColabConnectionView | null
  /** Connected Colab runtime, ready for cell execution. */
  session: ColabSessionView | null
  /** Colab runtime being provisioned. */
  pending: ColabSessionView | null
  /** Most recent failed Colab attempt. */
  failed: ColabSessionView | null
  connecting: boolean
  error: string | null
  connect: (accelerator: ColabAccelerator, account: ColabConnectionView) => Promise<void>
  disconnect: () => Promise<void>
  jupyterServers: JupyterServerView[]
  jupyterSession: JupyterSessionView | null
  jupyterConnecting: boolean
  jupyterError: string | null
  connectJupyter: (input: Omit<JupyterConnectRequest, 'workspaceRoot'>) => Promise<boolean>
  disconnectJupyter: () => Promise<void>
  removeJupyterServer: (serverId: string) => Promise<void>
  /** Active kernel session id across whichever backend is connected (`sessionId` or `jpy-*`). */
  activeSessionId: string | null
  /** Short runtime badge name (`T4` or `Local Jupyter · python3`). */
  activeRuntimeLabel: string | null
  /** Remote file-tree root (`/content` for Colab, `/` for Jupyter Server). */
  remoteRoot: string
  openExternalNotebookUi: () => void
}

export function useColabNotebookRuntime(workspaceRoot: string): ColabNotebookRuntime {
  useColabSubscription()
  useJupyterSubscription()
  const snapshot = useColabStore((s) => s.snapshot)
  const jupyterSnapshot = useJupyterStore((s) => s.snapshot)
  const selectedBackend = useColabNotebookStore((s) => s.runtimeBackend)
  const setRuntimeBackend = useColabNotebookStore((s) => s.setRuntimeBackend)

  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jupyterConnecting, setJupyterConnecting] = useState(false)
  const [jupyterError, setJupyterError] = useState<string | null>(null)

  const wsKey = normalizeColabWorkspaceKey(workspaceRoot)
  const connection = selectWorkspaceActiveConnection(snapshot, workspaceRoot)
  const notebookSessions = selectWorkspaceSessions(snapshot, workspaceRoot).filter(
    (s) => s.entryCommand === COLAB_NOTEBOOK_ENTRY_COMMAND
  )
  const session = notebookSessions.find((s) => s.phase === 'running') ?? null
  const pending = session ? null : notebookSessions.find((s) => isColabSessionRunning(s)) ?? null
  const failed = session || pending ? null : notebookSessions.find((s) => s.phase === 'failed') ?? null

  const jupyterSession = jupyterSnapshot.sessions.find((s) => s.workspaceRoot === wsKey) ?? null

  // Respect explicit tab choice when switching backends, while preferring the live backend if only one is connected.
  const activeBackend: NotebookRuntimeBackend =
    selectedBackend === 'jupyter'
      ? 'jupyter'
      : !session && !pending && jupyterSession
        ? 'jupyter'
        : 'colab'

  const activeSessionId =
    activeBackend === 'jupyter'
      ? (jupyterSession?.id ?? session?.id ?? null)
      : (session?.id ?? jupyterSession?.id ?? null)

  const usingJupyter = Boolean(activeSessionId && jupyterSession && activeSessionId === jupyterSession.id)
  const activeRuntimeLabel = usingJupyter && jupyterSession
    ? `${jupyterSession.serverName} · ${jupyterSession.kernelName}`
    : session
      ? session.accelerator
      : null
  const remoteRoot = (usingJupyter || (selectedBackend === 'jupyter' && !session)) ? '/' : COLAB_REMOTE_ROOT

  const connect = useCallback(
    async (accelerator: ColabAccelerator, account: ColabConnectionView) => {
      if (account.status !== 'connected' || !wsKey || session || pending) return
      setConnecting(true)
      setError(null)
      try {
        const res = await window.kunGui.colabStartRun({
          workspaceRoot: wsKey,
          connectionId: account.id,
          entryCommand: COLAB_NOTEBOOK_ENTRY_COMMAND,
          setAsWorkspaceCurrent: true,
          accelerator,
          syncPaths: [],
          outputRemoteDir: '',
          outputLocalDir: '',
          maxRuntimeHours: 0,
          autoStop: false,
          terminalOnly: true
        })
        if (!res.ok) setError(res.message)
        else {
          setRuntimeBackend('colab')
          useColabNotebookStore.getState().resetKernelState()
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error))
      } finally {
        setConnecting(false)
      }
    },
    [pending, session, setRuntimeBackend, wsKey]
  )

  const disconnect = useCallback(async () => {
    const target = session ?? pending
    if (!target) return
    await useColabNotebookStore.getState().interrupt()
    await window.kunGui.colabStopSession({ sessionId: target.id })
    useColabNotebookStore.getState().resetKernelState()
  }, [pending, session])

  const connectJupyter = useCallback(
    async (input: Omit<JupyterConnectRequest, 'workspaceRoot'>): Promise<boolean> => {
      if (!wsKey || !window.kunGui?.jupyterConnect) return false
      setJupyterConnecting(true)
      setJupyterError(null)
      try {
        const res = await window.kunGui.jupyterConnect({ ...input, workspaceRoot: wsKey })
        if (!res.ok) {
          setJupyterError(res.message)
          return false
        }
        setRuntimeBackend('jupyter')
        useColabNotebookStore.getState().resetKernelState()
        return true
      } catch (error) {
        setJupyterError(error instanceof Error ? error.message : String(error))
        return false
      } finally {
        setJupyterConnecting(false)
      }
    },
    [setRuntimeBackend, wsKey]
  )

  const disconnectJupyter = useCallback(async () => {
    if (!jupyterSession || !window.kunGui?.jupyterDisconnect) return
    await useColabNotebookStore.getState().interrupt()
    await window.kunGui.jupyterDisconnect({ sessionId: jupyterSession.id })
    useColabNotebookStore.getState().resetKernelState()
  }, [jupyterSession])

  const removeJupyterServer = useCallback(async (serverId: string) => {
    await window.kunGui?.jupyterRemoveServer?.({ serverId })
  }, [])

  const openExternalNotebookUi = useCallback(() => {
    if (usingJupyter && jupyterSession) {
      void window.kunGui?.jupyterOpenBrowser?.({ serverId: jupyterSession.serverId })
      return
    }
    const connectionId = session?.connectionId ?? connection?.id
    if (connectionId) {
      void window.kunGui.colabOpenBrowser({ connectionId, sessionId: session?.id })
    }
  }, [connection?.id, jupyterSession, session?.connectionId, session?.id, usingJupyter])

  return {
    wsKey,
    backend: selectedBackend,
    setBackend: setRuntimeBackend,
    connection,
    session,
    pending,
    failed,
    connecting,
    error,
    connect,
    disconnect,
    jupyterServers: jupyterSnapshot.servers,
    jupyterSession,
    jupyterConnecting,
    jupyterError,
    connectJupyter,
    disconnectJupyter,
    removeJupyterServer,
    activeSessionId,
    activeRuntimeLabel,
    remoteRoot,
    openExternalNotebookUi
  }
}
