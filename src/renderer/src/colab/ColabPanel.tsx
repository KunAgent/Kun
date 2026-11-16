import { type ReactElement } from 'react'
import { ArrowLeft, Cloud, Play, RotateCcw, Terminal, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ColabSessionView } from '@shared/colab/colab-types'
import { openTerminal } from '../components/terminal/terminal-open'
import { ColabConnectionsSection } from './ColabConnectionsSection'
import { ColabSessionCallouts, ColabUntrackedCallout } from './ColabPanelCallouts'
import { ColabRunDialog } from './ColabRunDialog'
import { ColabRuntimeSetup } from './ColabRuntimeSetup'
import { ColabSessionCards } from './ColabSessionCards'
import {
  formatColabDuration,
  isColabSessionRunning,
  normalizeColabWorkspaceKey,
  selectWorkspaceActiveConnection,
  selectWorkspaceSessions,
  useColabStore,
  useColabSubscription
} from './colab-store'

function sessionDotClass(session: ColabSessionView): string {
  if (session.phase === 'running') return 'bg-emerald-500'
  if (isColabSessionRunning(session)) return 'bg-amber-500'
  if (session.phase === 'failed') return 'bg-red-500'
  return 'bg-ds-faint'
}

export function ColabPanel({ workspaceRoot }: { workspaceRoot?: string }): ReactElement {
  useColabSubscription()
  const { t } = useTranslation('common')
  const snapshot = useColabStore((s) => s.snapshot)
  const runDialogOpen = useColabStore((s) => s.runDialogOpen)
  const openRunDialog = useColabStore((s) => s.openRunDialog)
  const closeRunDialog = useColabStore((s) => s.closeRunDialog)
  const focusedSessionId = useColabStore((s) => s.focusedSessionId)
  const setFocusedSessionId = useColabStore((s) => s.setFocusedSessionId)
  const toast = useColabStore((s) => s.toast)
  const dismissToast = useColabStore((s) => s.dismissToast)

  const wsKey = normalizeColabWorkspaceKey(workspaceRoot)
  const activeConnection = selectWorkspaceActiveConnection(snapshot, workspaceRoot)
  const workspaceSessions = selectWorkspaceSessions(snapshot, workspaceRoot)
  const focusedSession = focusedSessionId
    ? snapshot.sessions.find((s) => s.id === focusedSessionId) ?? null
    : null
  // Finished sessions stay reachable from the switcher, but only an explicit focus keeps one
  // on screen; otherwise the panel returns to the idle overview (re-run / terminal).
  const currentSession = focusedSession ?? workspaceSessions.find(isColabSessionRunning) ?? null
  const owningConnection = currentSession
    ? snapshot.connections.find((c) => c.id === currentSession.connectionId) ?? null
    : null
  const lastRun = wsKey ? snapshot.lastRunsByWorkspace[wsKey] : undefined
  const showSwitcher =
    workspaceSessions.length > 1 || (workspaceSessions.length === 1 && !currentSession)

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
      profileLaunch: { argv: [shellBin, shellFlag, res.command], env: res.env }
    })
  }

  const rerunLastSession = async (): Promise<void> => {
    if (!lastRun || !activeConnection || activeConnection.status === 'expired') {
      openRunDialog()
      return
    }
    const res = await window.kunGui.colabStartRun({
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
    if (res.ok) setFocusedSessionId(res.session.id)
    else openRunDialog()
  }

  const toastBanner = toast ? (
    <div
      role="status"
      className="flex shrink-0 items-center justify-between gap-2 border-b border-ds-border bg-ds-elevated px-3 py-2 text-[11.5px]"
    >
      <span className="min-w-0 truncate text-ds-ink">{toast.text}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        {toast.action ? (
          <button
            type="button"
            onClick={() => {
              toast.action?.run()
              dismissToast()
            }}
            className="font-semibold text-accent hover:underline"
          >
            {toast.action.label}
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
  ) : null

  if (snapshot.connections.length === 0) {
    return (
      <div
        data-testid="colab-right-panel"
        className="flex h-full min-h-0 w-full flex-col bg-ds-sidebar text-ds-ink"
      >
        {toastBanner}
        <ColabRuntimeSetup inPanel />
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
          <ColabConnectionsSection workspaceRoot={wsKey} />
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="colab-right-panel"
      className="flex h-full min-h-0 w-full flex-col bg-ds-sidebar text-ds-ink"
    >
      {toastBanner}
      {snapshot.cli.state !== 'ready' && <ColabRuntimeSetup inPanel />}

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        {snapshot.untrackedSessions.map((untracked) => (
          <ColabUntrackedCallout
            key={`${untracked.connectionId}:${untracked.endpoint}`}
            untracked={untracked}
            wsKey={wsKey}
          />
        ))}

        {showSwitcher ? (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <span className="shrink-0 text-[10.5px] font-medium text-ds-faint">
              {t('colab.sessionsLabel')}
            </span>
            {workspaceSessions.map((s) => {
              const active = currentSession?.id === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFocusedSessionId(s.id)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10.5px] transition ${
                    active
                      ? 'border-accent/50 bg-accent/10 text-ds-ink'
                      : 'border-ds-border-muted bg-ds-card text-ds-muted hover:text-ds-ink'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${sessionDotClass(s)}`} />
                  <span className="max-w-[120px] truncate">{s.sessionName}</span>
                </button>
              )
            })}
          </div>
        ) : null}

        <ColabSessionCallouts
          session={currentSession}
          owningConnection={owningConnection}
          activeConnection={activeConnection}
        />

        {currentSession ? (
          <>
            {!isColabSessionRunning(currentSession) ? (
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setFocusedSessionId(null)}
                  className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11.5px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
                >
                  <ArrowLeft className="h-3 w-3" />
                  <span>{t('colab.backToOverview')}</span>
                </button>
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
            <ColabSessionCards
              session={currentSession}
              owningConnection={owningConnection}
              activeConnectionId={activeConnection?.id ?? null}
            />
          </>
        ) : (
          <div data-testid="colab-idle-card" className="rounded-xl border border-ds-border bg-ds-card p-4">
            <div className="flex items-center justify-between gap-2 text-[11.5px] text-ds-muted">
              <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-ds-ink">
                <Cloud className="h-3.5 w-3.5 shrink-0 text-accent" />
                <span className="truncate">
                  {activeConnection ? `${activeConnection.name} · ${activeConnection.email}` : ''}
                </span>
              </span>
              {activeConnection?.balanceCu !== null && activeConnection?.balanceCu !== undefined ? (
                <span className="shrink-0 font-mono">{activeConnection.balanceCu} CU</span>
              ) : null}
            </div>

            <div className="mt-3 text-[13px] font-semibold text-ds-ink">{t('colab.noActiveSession')}</div>
            {lastRun ? (
              <p className="mt-1 truncate font-mono text-[11px] text-ds-faint" title={lastRun.entryCommand}>
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
                disabled={!activeConnection || activeConnection.status === 'expired'}
                onClick={() => void openIdleTerminal()}
                className={`inline-flex items-center justify-center gap-1 rounded-xl border border-ds-border bg-ds-subtle py-1.5 text-[11.5px] font-medium text-ds-ink hover:bg-ds-hover disabled:opacity-45 ${
                  lastRun ? '' : 'col-span-2'
                }`}
              >
                <Terminal className="h-3 w-3" />
                <span>{t('colab.terminalOnly')}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <ColabConnectionsSection workspaceRoot={wsKey} />

      {runDialogOpen ? <ColabRunDialog workspaceRoot={wsKey} onClose={closeRunDialog} /> : null}
    </div>
  )
}
