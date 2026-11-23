import { useCallback, useRef, useState, type ReactElement } from 'react'
import { Check, ChevronDown, Cloud, ExternalLink, Plus, Settings2, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ToolPresentation } from '@shared/tool-presentation'
import { headerTextButtonClass, HEADER_ICON_CLASS, HEADER_ICON_STROKE } from '../components/workbench/header-action-button'
import { isRemoteWeb } from '../lib/remote-mobile'
import { requestColabConnectionSwitch } from './colab-connection-switch'
import {
  formatColabDuration,
  isColabSessionRunning,
  normalizeColabWorkspaceKey,
  openColabPanel,
  selectAllRunningSessions,
  selectWorkspaceActiveConnection,
  selectWorkspaceSessions,
  useColabStore,
  useColabSubscription
} from './colab-store'
import { useColabDismiss } from './use-colab-dismiss'

export function ColabTopbarCapsule({ workspaceRoot }: { workspaceRoot: string }): ReactElement | null {
  useColabSubscription()
  const { t } = useTranslation(['common', 'settings'])
  const snapshot = useColabStore((s) => s.snapshot)
  if (isRemoteWeb()) return null
  const allRunning = selectAllRunningSessions(snapshot)
  if (allRunning.length === 0) {
    return (
      <button
        type="button"
        onClick={() => openColabPanel()}
        className={headerTextButtonClass()}
        title={t('settings:colabManageInPanelBtn')}
      >
        <Cloud className={HEADER_ICON_CLASS} strokeWidth={HEADER_ICON_STROKE} aria-hidden="true" />
        <span>{t('rightPanelColab')}</span>
      </button>
    )
  }

  const wsRunning = selectWorkspaceSessions(snapshot, workspaceRoot).filter(isColabSessionRunning)
  const primary = wsRunning[0] ?? allRunning[0]!
  const label =
    allRunning.length === 1
      ? t('colab.topbarSingleRunning', {
          accelerator: primary.accelerator,
          elapsed: formatColabDuration(primary.elapsedSeconds)
        })
      : t('colab.topbarMultiRunning', { total: allRunning.length })

  return (
    <button
      type="button"
      onClick={() => openColabPanel({ focusSessionId: primary.id })}
      className="ds-no-drag inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/12 px-2.5 py-0.5 text-[11.5px] font-medium text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-300"
      title={label}
    >
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
      <span className="max-w-[200px] truncate">{label}</span>
    </button>
  )
}

export function ColabComposerChip({
  workspaceRoot,
  compact = false
}: {
  workspaceRoot: string
  compact?: boolean
}): ReactElement | null {
  useColabSubscription()
  const { t } = useTranslation('common')
  const snapshot = useColabStore((s) => s.snapshot)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const closeMenu = useCallback(() => setOpen(false), [])
  useColabDismiss(open, closeMenu, containerRef)

  const activeConn = selectWorkspaceActiveConnection(snapshot, workspaceRoot)
  const wsSessions = selectWorkspaceSessions(snapshot, workspaceRoot)
  const runningSession = wsSessions.find(isColabSessionRunning)

  // Show chip in Code composer when at least one connection exists (or session is running)
  if (snapshot.connections.length === 0 && !runningSession) return null

  const acceleratorLabel =
    runningSession?.accelerator ??
    snapshot.lastRunsByWorkspace[normalizeColabWorkspaceKey(workspaceRoot)]?.accelerator ??
    'T4'

  return (
    <div ref={containerRef} className="ds-no-drag relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`inline-flex items-center gap-1.5 rounded-full border border-ds-border-muted bg-ds-subtle text-[12px] font-medium text-ds-muted transition hover:border-ds-border hover:bg-ds-hover hover:text-ds-ink ${
          compact ? 'h-7 px-2' : 'h-8 px-2.5'
        }`}
      >
        <Cloud className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.9} />
        <span className="max-w-[110px] truncate">
          {activeConn ? `${activeConn.name} · ${acceleratorLabel}` : t('colab.composerUnconnected')}
        </span>
        {activeConn?.status === 'expired' ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
        ) : null}
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
      </button>

      {open ? (
        <div
          role="menu"
          className="ds-card-strong absolute bottom-full left-0 z-50 mb-2 w-64 overflow-hidden rounded-xl border border-ds-border py-1.5 text-[12px] shadow-xl"
        >
          <div className="border-b border-ds-border-muted px-3 pb-1.5 pt-1 text-[10.5px] font-semibold text-ds-faint">
            {t('colab.composerPopoverTitle')}
          </div>
          {snapshot.connections.map((conn) => {
            const selected = activeConn?.id === conn.id
            const expired = conn.status === 'expired'
            return (
              <button
                key={conn.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  setOpen(false)
                  const result = requestColabConnectionSwitch(workspaceRoot, conn, t)
                  // Re-login and the running-session confirmation both live in the panel.
                  if (result === 'reauth' || result === 'confirm') {
                    openColabPanel({ expandConnections: true })
                  }
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-ds-ink hover:bg-ds-hover"
              >
                <span
                  className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9.5px] font-bold text-white ${
                    expired ? 'opacity-50' : ''
                  }`}
                  style={{ backgroundColor: conn.avatarColor }}
                >
                  {conn.name.slice(0, 1).toUpperCase()}
                </span>
                <span className={`min-w-0 flex-1 truncate ${expired ? 'text-ds-muted' : ''}`}>
                  {conn.name}
                </span>
                {expired ? (
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
                    {t('colab.expiredBadge')}
                  </span>
                ) : conn.balanceCu !== null ? (
                  <span className="shrink-0 font-mono text-[10.5px] text-ds-faint">
                    {conn.balanceCu} CU
                  </span>
                ) : null}
                {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" /> : null}
              </button>
            )
          })}
          <div className="my-1 border-t border-ds-border-muted" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              openColabPanel({ expandConnections: true, openAddAccount: true })
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t('colab.addAccountMenu')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              openColabPanel({ expandConnections: true })
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span>{t('colab.manageConnectionsMenu')}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

export type ColabToolMarker = {
  sessionId: string
  sessionName: string
  connectionLabel: string
  accelerator: string
  entryCommand: string
  phase: string
  progressSummary?: string
  consumedCu?: number
  estimatedTotalCu?: number
  errorMessage?: string
}

export function colabToolData(presentation: ToolPresentation): ColabToolMarker | null {
  if (presentation.source !== 'native' || presentation.name !== 'colab_run') return null
  const out = presentation.output
  if (!out || typeof out !== 'object' || Array.isArray(out)) return null
  const raw = (out as Record<string, unknown>).colabRun
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  if (rec.kind !== 'colab_run' || typeof rec.sessionId !== 'string') return null
  return {
    sessionId: rec.sessionId,
    sessionName: typeof rec.sessionName === 'string' ? rec.sessionName : rec.sessionId,
    connectionLabel: typeof rec.connectionLabel === 'string' ? rec.connectionLabel : 'Colab',
    accelerator: typeof rec.accelerator === 'string' ? rec.accelerator : 'T4',
    entryCommand: typeof rec.entryCommand === 'string' ? rec.entryCommand : '',
    phase: typeof rec.phase === 'string' ? rec.phase : 'running',
    progressSummary: typeof rec.progressSummary === 'string' ? rec.progressSummary : undefined,
    consumedCu: typeof rec.consumedCu === 'number' ? rec.consumedCu : undefined,
    estimatedTotalCu: typeof rec.estimatedTotalCu === 'number' ? rec.estimatedTotalCu : undefined,
    errorMessage: typeof rec.errorMessage === 'string' ? rec.errorMessage : undefined
  }
}

export function ColabToolCard({ marker }: { marker: ColabToolMarker }): ReactElement {
  useColabSubscription()
  const { t } = useTranslation('common')
  // The tool result is a snapshot taken when the tool returned; prefer the live session so
  // the chat card and the panel stay two views of the same state.
  const live = useColabStore((s) => s.snapshot.sessions.find((x) => x.id === marker.sessionId))
  const phase = live?.phase ?? marker.phase
  const progressSummary = live?.progressSummary ?? marker.progressSummary
  const consumedCu = live?.consumedCu ?? marker.consumedCu
  const estimatedTotalCu = live?.estimatedTotalCu ?? marker.estimatedTotalCu
  const errorMessage = live ? live.errorMessage : marker.errorMessage
  const isRunning = live
    ? isColabSessionRunning(live)
    : ['provisioning', 'uploading', 'installing', 'running'].includes(phase)
  const phaseKey: Record<string, string> = {
    provisioning: 'colab.phaseProvisioning',
    uploading: 'colab.phaseUploading',
    installing: 'colab.phaseInstalling',
    running: 'colab.phaseRunning',
    completed: 'colab.phaseCompleted',
    failed: 'colab.phaseFailed',
    disconnected: 'colab.phaseDisconnected',
    stopped: 'colab.phaseStopped'
  }
  const phaseLabel = phaseKey[phase] ? t(phaseKey[phase]) : phase
  const cuText =
    consumedCu !== undefined
      ? estimatedTotalCu
        ? ` · ${consumedCu} / ~${estimatedTotalCu} CU`
        : ` · ${consumedCu} CU`
      : ''

  return (
    <div
      data-testid="colab-tool-card"
      className="rounded-xl border border-ds-border bg-ds-card p-3.5 text-[12px]"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Cloud className="h-4 w-4 shrink-0 text-accent" />
          <span className="shrink-0 font-semibold text-ds-ink">{t('colab.toolCardTitle')}</span>
          <span className="truncate font-mono text-[11px] text-ds-muted">{marker.sessionName}</span>
        </div>
        <span className="shrink-0 whitespace-nowrap rounded-full bg-ds-subtle px-2 py-0.5 font-mono text-[10.5px] font-medium text-ds-ink">
          {marker.accelerator} · {phaseLabel}
        </span>
      </div>

      <div className="mt-1.5 text-[11px] text-ds-muted">
        {marker.connectionLabel}
        {cuText}
      </div>

      {marker.entryCommand ? (
        <div className="mt-1.5 truncate rounded-lg bg-ds-subtle px-2.5 py-1 font-mono text-[11px] text-ds-ink">
          $ {marker.entryCommand}
        </div>
      ) : null}

      {progressSummary ? (
        <div className="mt-1.5 font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
          {progressSummary}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="mt-1.5 text-[11px] text-red-500">{errorMessage}</div>
      ) : null}

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => openColabPanel({ focusSessionId: marker.sessionId })}
          className="inline-flex items-center gap-1 rounded-lg border border-ds-border bg-ds-subtle px-2.5 py-1 text-[11.5px] font-medium text-ds-ink hover:bg-ds-hover"
        >
          <ExternalLink className="h-3 w-3" />
          <span>{t('colab.viewInPanel')}</span>
        </button>
        {isRunning ? (
          <button
            type="button"
            onClick={() => void window.kunGui.colabStopSession({ sessionId: marker.sessionId })}
            className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11.5px] font-medium text-red-600 hover:bg-red-500/20 dark:text-red-300"
          >
            <Square className="h-3 w-3 fill-current" />
            <span>{t('colab.stopBtn')}</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
