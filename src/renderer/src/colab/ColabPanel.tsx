import { type ReactElement } from 'react'
import { AlertTriangle, Cloud, Play, RotateCcw, Terminal, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { openTerminal } from '../components/terminal/terminal-open'
import { ColabConnectionsSection } from './ColabConnectionsSection'
import { ColabRunDialog } from './ColabRunDialog'
import { ColabSessionCards } from './ColabSessionCards'
import {
  formatColabDuration,
  normalizeColabWorkspaceKey,
  selectWorkspaceActiveConnection,
  selectWorkspaceSessions,
  useColabStore,
  useColabSubscription
} from './colab-store'

export function ColabPanel({ workspaceRoot }: { workspaceRoot?: string }): ReactElement {
  useColabSubscription()
  const { t } = useTranslation('common')
  const snapshot = useColabStore((s) => s.snapshot)
  const runDialogOpen = useColabStore((s) => s.runDialogOpen)
  const openRunDialog = useColabStore((s) => s.openRunDialog)
  const closeRunDialog = useColabStore((s) => s.closeRunDialog)
  const openAddAccount = useColabStore((s) => s.openAddAccount)
  const focusedSessionId = useColabStore((s) => s.focusedSessionId)
  const toast = useColabStore((s) => s.toast)
  const dismissToast = useColabStore((s) => s.dismissToast)

  const wsKey = normalizeColabWorkspaceKey(workspaceRoot)
  const activeConnection = selectWorkspaceActiveConnection(snapshot, workspaceRoot)
  const workspaceSessions = selectWorkspaceSessions(snapshot, workspaceRoot)
  const currentSession =
    (focusedSessionId
      ? workspaceSessions.find((s) => s.id === focusedSessionId) ??
        snapshot.sessions.find((s) => s.id === focusedSessionId)
      : undefined) ?? workspaceSessions[0] ?? null
  const owningConnection = currentSession
    ? snapshot.connections.find((c) => c.id === currentSession.connectionId) ?? null
    : null
  const lastRun = wsKey ? snapshot.lastRunsByWorkspace[wsKey] : undefined

  const openIdleTerminal = async (): Promise<void> => {
    if (!activeConnection) return
    const res = await window.kunGui.colabPrepareTerminalLaunch({
      connectionId: activeConnection.id,
      workspaceRoot: wsKey
    })
    if (!res.ok) return
    const shellBin = window.kunGui.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
    const shellFlag = window.kunGui.platform === 'win32' ? '/c' : '-c'
    openTerminal({
      title: res.title,
      cwd: res.cwd,
      profileLaunch: {
        argv: [shellBin, shellFlag, res.command],
        env: res.env
      }
    })
  }

  const rerunLastSession = async (): Promise<void> => {
    if (!lastRun || !activeConnection) {
      openRunDialog()
      return
    }
    await window.kunGui.colabStartRun({
      workspaceRoot: wsKey,
      connectionId: activeConnection.id,
      entryCommand: lastRun.entryCommand,
      accelerator: lastRun.accelerator,
      syncPaths: lastRun.syncPaths,
      outputRemoteDir: lastRun.outputRemoteDir,
      outputLocalDir: lastRun.outputLocalDir,
      maxRuntimeHours: lastRun.maxRuntimeHours,
      autoStop: lastRun.autoStop,
      mountDrive: lastRun.mountDrive,
      envVars: lastRun.envVars,
      setupScript: lastRun.setupScript
    })
  }

  return (
    <div
      data-testid="colab-right-panel"
      className="flex h-full min-h-0 w-full flex-col bg-ds-sidebar text-ds-ink"
    >
      {/* Toast banner with optional Undo */}
      {toast ? (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-2 border-b border-ds-border bg-ds-elevated px-3 py-2 text-[11.5px]"
        >
          <span className="truncate text-ds-ink">{toast.text}</span>
          <div className="flex shrink-0 items-center gap-1.5">
            {toast.undo ? (
              <button
                type="button"
                onClick={() => {
                  toast.undo?.()
                  dismissToast()
                }}
                className="font-semibold text-accent hover:underline"
              >
                {t('colab.undoBtn')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={dismissToast}
              aria-label={t('colab.cancelBtn')}
              className="rounded p-0.5 text-ds-faint hover:text-ds-ink"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Scrollable Upper Session & Artifacts Area */}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        {/* Untracked remote sessions warning */}
        {snapshot.untrackedSessions.map((untracked) => (
          <div
            key={`${untracked.connectionId}:${untracked.endpoint}`}
            className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-[11.5px]"
          >
            <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{t('colab.untrackedTitle')}</div>
                <p className="mt-0.5 leading-relaxed opacity-90">
                  {t('colab.untrackedDesc', {
                    name: untracked.connectionName,
                    accelerator: untracked.accelerator,
                    endpoint: untracked.remoteLabel
                  })}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      void window.kunGui.colabAdoptUntrackedSession({
                        connectionId: untracked.connectionId,
                        endpoint: untracked.endpoint,
                        workspaceRoot: wsKey
                      })
                    }
                    className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-white"
                  >
                    {t('colab.adoptBtn')}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void window.kunGui.colabStopUntrackedSession({
                        connectionId: untracked.connectionId,
                        endpoint: untracked.endpoint
                      })
                    }
                    className="rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white"
                  >
                    {t('colab.stopBtn')}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void window.kunGui.colabIgnoreUntrackedSession({
                        connectionId: untracked.connectionId,
                        endpoint: untracked.endpoint
                      })
                    }
                    className="rounded-lg border border-ds-border bg-ds-card px-2.5 py-1 text-[11px] text-ds-muted"
                  >
                    {t('colab.ignoreBtn')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Session Error / Disconnected / Auth Callouts */}
        {currentSession?.errorKind === 'gpu_unavailable' ? (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-[11.5px] text-amber-900 dark:text-amber-200">
            <div className="font-semibold">
              {t('colab.errGpuUnavailableTitle', { accelerator: currentSession.accelerator })}
            </div>
            <p className="mt-0.5 opacity-90">{t('colab.errGpuUnavailableDesc')}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => openRunDialog('L4')}
                className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-white"
              >
                {t('colab.switchToL4')}
              </button>
              <button
                type="button"
                onClick={() => openRunDialog(currentSession.accelerator)}
                className="rounded-lg border border-ds-border bg-ds-card px-2.5 py-1 text-[11px] text-ds-ink"
              >
                {t('colab.retryLater')}
              </button>
            </div>
          </div>
        ) : null}

        {currentSession?.phase === 'disconnected' ||
        currentSession?.errorKind === 'disconnected_billing' ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11.5px] text-amber-900 dark:text-amber-200">
            <div className="font-semibold">{t('colab.errDisconnectedTitle')}</div>
            <p className="mt-0.5 opacity-90">{t('colab.errDisconnectedDesc')}</p>
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                onClick={() =>
                  void window.kunGui.colabReconnectSession({ sessionId: currentSession.id })
                }
                className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-white"
              >
                {t('colab.reconnectBtn')}
              </button>
              <button
                type="button"
                onClick={() =>
                  void window.kunGui.colabStopSession({ sessionId: currentSession.id })
                }
                className="rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white"
              >
                {t('colab.stopBtn')}
              </button>
            </div>
          </div>
        ) : null}

        {activeConnection?.status === 'expired' ||
        currentSession?.errorKind === 'auth_expired' ? (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-[11.5px] text-amber-900 dark:text-amber-200">
            <div className="font-semibold">
              {t('colab.errAuthExpiredTitle', {
                name: currentSession?.connectionName ?? activeConnection?.name ?? ''
              })}
            </div>
            <p className="mt-0.5 opacity-90">{t('colab.errAuthExpiredDesc')}</p>
            <button
              type="button"
              onClick={() =>
                openAddAccount(currentSession?.connectionId ?? activeConnection?.id)
              }
              className="mt-2 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-white"
            >
              {t('colab.reauthorizeExt')}
            </button>
          </div>
        ) : null}

        {/* Connected Body */}
        {snapshot.connections.length > 0 ? (
          currentSession ? (
            <>
              {['completed', 'failed', 'stopped'].includes(currentSession.phase) ? (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => openRunDialog()}
                    className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white"
                  >
                    <Play className="h-3 w-3 fill-current" />
                    <span>{t('colab.runTraining')}</span>
                  </button>
                </div>
              ) : null}
              <ColabSessionCards session={currentSession} owningConnection={owningConnection} />
            </>
          ) : (
            <div
              data-testid="colab-idle-card"
              className="rounded-xl border border-ds-border bg-ds-card p-4"
            >
              <div className="flex items-center justify-between text-[11.5px] text-ds-muted">
                <span className="inline-flex items-center gap-1.5 font-medium text-ds-ink">
                  <Cloud className="h-3.5 w-3.5 text-accent" />
                  <span>{activeConnection?.name}</span>
                </span>
                {activeConnection?.balanceCu !== null && activeConnection?.balanceCu !== undefined ? (
                  <span className="font-mono">{activeConnection.balanceCu} CU</span>
                ) : null}
              </div>

              <div className="mt-3 text-[13px] font-semibold text-ds-ink">
                {t('colab.noActiveSession')}
              </div>
              {lastRun ? (
                <p className="mt-1 truncate font-mono text-[11px] text-ds-faint">
                  {t('colab.lastRunSummary', {
                    command: lastRun.entryCommand,
                    accelerator: lastRun.accelerator,
                    duration: formatColabDuration(lastRun.durationSeconds),
                    cu: lastRun.consumedCu
                  })}
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => openRunDialog()}
                className="mt-3.5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent py-2 text-[12.5px] font-semibold text-white shadow-sm hover:opacity-95"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>{t('colab.runTraining')}</span>
              </button>

              <div className="mt-2 grid grid-cols-2 gap-2">
                {lastRun ? (
                  <button
                    type="button"
                    onClick={() => void rerunLastSession()}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border border-ds-border bg-ds-subtle py-1.5 text-[11.5px] font-medium text-ds-ink hover:bg-ds-hover"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>{t('colab.rerunLast')}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void openIdleTerminal()}
                  className={`inline-flex items-center justify-center gap-1 rounded-xl border border-ds-border bg-ds-subtle py-1.5 text-[11.5px] font-medium text-ds-ink hover:bg-ds-hover ${
                    lastRun ? '' : 'col-span-2'
                  }`}
                >
                  <Terminal className="h-3 w-3" />
                  <span>{t('colab.terminalOnly')}</span>
                </button>
              </div>
            </div>
          )
        ) : null}
      </div>

      {/* Independent Connections Section Sticky at Bottom (below Artifacts) */}
      <ColabConnectionsSection workspaceRoot={wsKey} />

      {runDialogOpen ? (
        <ColabRunDialog workspaceRoot={wsKey} onClose={closeRunDialog} />
      ) : null}
    </div>
  )
}
