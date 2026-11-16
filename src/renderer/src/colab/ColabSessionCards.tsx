import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  CheckCircle2,
  Circle,
  Download,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Square,
  Terminal,
  Upload
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  ColabConnectionView,
  ColabMetricPoint,
  ColabProvisioningStep,
  ColabSessionView
} from '@shared/colab/colab-types'
import { openTerminal } from '../components/terminal/terminal-open'
import { formatColabBytes, formatColabDuration, isColabSessionRunning } from './colab-store'
import { useColabDismiss } from './use-colab-dismiss'

function buildPolylinePoints(values: number[], width: number, height: number): string {
  if (values.length === 0) return ''
  if (values.length === 1) return `0,${height / 2} ${width},${height / 2}`
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return values
    .map((v, idx) => {
      const x = (idx / (values.length - 1)) * width
      const y = height - 4 - ((v - min) / span) * (height - 8)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

const PROVISIONING_ORDER: ColabProvisioningStep[] = ['assign', 'upload', 'install', 'start']

export function ColabSessionCards({
  session,
  owningConnection,
  activeConnectionId
}: {
  session: ColabSessionView
  owningConnection?: ColabConnectionView | null
  activeConnectionId?: string | null
}): ReactElement {
  const { t } = useTranslation('common')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  useColabDismiss(menuOpen, closeMenu, menuRef)
  const metricKeys = useMemo(() => Object.keys(session.metrics), [session.metrics])
  const [selectedMetric, setSelectedMetric] = useState<string>('loss')
  const logContainerRef = useRef<HTMLDivElement>(null)
  const logPinnedRef = useRef(true)

  useEffect(() => {
    if (metricKeys.length > 0 && !metricKeys.includes(selectedMetric)) {
      setSelectedMetric(metricKeys[0]!)
    }
  }, [metricKeys, selectedMetric])

  // Follow new output only while the user is at the bottom; reading history must not jump.
  useEffect(() => {
    const el = logContainerRef.current
    if (el && logPinnedRef.current) el.scrollTop = el.scrollHeight
  }, [session.logTail])

  useEffect(() => {
    logPinnedRef.current = true
  }, [session.id])

  const billedElsewhere =
    Boolean(activeConnectionId) && activeConnectionId !== session.connectionId

  const running = isColabSessionRunning(session)
  const phaseLabel =
    session.phase === 'provisioning'
      ? t('colab.phaseProvisioning')
      : session.phase === 'uploading'
        ? t('colab.phaseUploading')
        : session.phase === 'installing'
          ? t('colab.phaseInstalling')
          : session.phase === 'running'
            ? t('colab.phaseRunning')
            : session.phase === 'completed'
              ? t('colab.phaseCompleted')
              : session.phase === 'failed'
                ? t('colab.phaseFailed')
                : session.phase === 'disconnected'
                  ? t('colab.phaseDisconnected')
                  : t('colab.phaseStopped')

  const dotClass =
    session.phase === 'running'
      ? 'bg-emerald-500 animate-pulse'
      : ['provisioning', 'uploading', 'installing'].includes(session.phase)
        ? 'bg-amber-500 animate-pulse'
        : session.phase === 'failed' || session.phase === 'disconnected'
          ? 'bg-red-500'
          : 'bg-ds-faint'

  const balanceCu = owningConnection?.balanceCu ?? null
  const estHoursLeft =
    balanceCu !== null && session.burnRateCuPerHour > 0
      ? (balanceCu / session.burnRateCuPerHour).toFixed(1)
      : null

  const activeMetricSeries: ColabMetricPoint[] = session.metrics[selectedMetric] ?? []
  const metricPolyline = buildPolylinePoints(
    activeMetricSeries.map((p) => p.value),
    260,
    64
  )
  const gpuPolyline = buildPolylinePoints(
    session.gpuHistory.length > 0 ? session.gpuHistory : [0],
    110,
    28
  )

  const launchSshTerminal = async (): Promise<void> => {
    const res = await window.kunGui.colabPrepareTerminalLaunch({
      sessionId: session.id,
      connectionId: session.connectionId,
      workspaceRoot: session.workspaceRoot
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

  return (
    <div className="space-y-2.5">
      {/* 1. Active Session Card */}
      <div className="rounded-xl border border-ds-border bg-ds-card p-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-semibold text-ds-ink">
            {session.sessionName}
          </span>
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ds-border-muted bg-ds-subtle px-2 py-0.5 text-[10.5px] font-medium text-ds-ink"
            title={session.connectionEmail}
          >
            <span
              className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold text-white"
              style={{ backgroundColor: session.connectionAvatarColor }}
            >
              {session.connectionName.slice(0, 1).toUpperCase()}
            </span>
            <span className="max-w-[72px] truncate">{session.connectionName}</span>
          </span>
          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-md p-1 text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-lg border border-ds-border bg-ds-elevated py-1 text-[11.5px] shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    void window.kunGui.colabOpenBrowser({
                      connectionId: session.connectionId,
                      sessionId: session.id
                    })
                  }}
                  className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-ds-ink hover:bg-ds-hover"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>{t('colab.menuOpenColab')}</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ds-muted">
          <span className="font-medium text-ds-ink">{session.accelerator}</span>
          {session.vramGb ? <span>· {session.vramGb} GB VRAM</span> : null}
          <span>· {session.ramGb} GB RAM</span>
          <span>· {phaseLabel}</span>
          <span className="ml-auto font-mono text-ds-faint">
            {formatColabDuration(session.elapsedSeconds)}
          </span>
        </div>
        {billedElsewhere ? (
          <div className="mt-1 text-[10.5px] text-ds-faint">
            {session.burnRateCuPerHour > 0 ? `${session.burnRateCuPerHour} CU/h · ` : ''}
            {t('colab.billedToHint', { name: owningConnection?.name ?? session.connectionName })}
          </div>
        ) : null}

        <div className="mt-2.5 grid grid-cols-4 gap-1.5">
          <button
            type="button"
            disabled={!running}
            onClick={() => void window.kunGui.colabUploadToSession({ sessionId: session.id })}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-ds-border bg-ds-subtle px-2 py-1.5 text-[11px] font-medium text-ds-ink hover:bg-ds-hover disabled:opacity-45"
          >
            <Upload className="h-3 w-3" />
            <span>{t('colab.uploadBtn')}</span>
          </button>
          <button
            type="button"
            onClick={() => void window.kunGui.colabDownloadFromSession({ sessionId: session.id })}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-ds-border bg-ds-subtle px-2 py-1.5 text-[11px] font-medium text-ds-ink hover:bg-ds-hover"
          >
            <Download className="h-3 w-3" />
            <span>{t('colab.downloadBtn')}</span>
          </button>
          <button
            type="button"
            disabled={!running}
            onClick={() => void launchSshTerminal()}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-ds-border bg-ds-subtle px-2 py-1.5 text-[11px] font-medium text-ds-ink hover:bg-ds-hover disabled:opacity-45"
          >
            <Terminal className="h-3 w-3" />
            <span>{t('colab.terminalBtn')}</span>
          </button>
          <button
            type="button"
            disabled={!running}
            onClick={() => void window.kunGui.colabStopSession({ sessionId: session.id })}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] font-medium text-red-600 hover:bg-red-500/20 disabled:opacity-45 dark:text-red-300"
          >
            <Square className="h-3 w-3 fill-current" />
            <span>{t('colab.stopBtn')}</span>
          </button>
        </div>
      </div>

      {/* 2. Provisioning Checklist */}
      {['provisioning', 'uploading', 'installing'].includes(session.phase) ? (
        <div className="rounded-xl border border-ds-border bg-ds-card p-3 text-[11.5px]">
          <div className="grid grid-cols-4 gap-1.5">
            {PROVISIONING_ORDER.map((step, index) => {
              const currentIndex = PROVISIONING_ORDER.indexOf(session.provisioningStep)
              const done = index < currentIndex
              const active = index === currentIndex
              const label =
                step === 'assign'
                  ? t('colab.stepAssign')
                  : step === 'upload'
                    ? t('colab.stepUpload')
                    : step === 'install'
                      ? t('colab.stepInstall')
                      : t('colab.stepStart')
              return (
                <div
                  key={step}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1.5 ${
                    active ? 'bg-accent/10 font-medium text-accent' : 'text-ds-muted'
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : active ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 shrink-0 text-ds-faint" />
                  )}
                  <span className="truncate">{label}</span>
                </div>
              )
            })}
          </div>
          {session.uploadTotalBytes > 0 && session.provisioningStep === 'upload' ? (
            <div className="mt-2 font-mono text-[10.5px] text-ds-faint">
              {formatColabBytes(session.uploadTransferredBytes)} /{' '}
              {formatColabBytes(session.uploadTotalBytes)}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 3. Two-Column CU & GPU Telemetry */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-ds-border bg-ds-card p-2.5">
          <div className="text-[11px] font-medium text-ds-muted">{t('colab.cuBalanceCard')}</div>
          <div className="mt-1 font-mono text-[16px] font-semibold text-ds-ink">
            {balanceCu !== null ? `${balanceCu} CU` : '--'}
          </div>
          <div className="mt-0.5 text-[10.5px] text-ds-faint">
            {running && estHoursLeft
              ? t('colab.cuBurnRate', { rate: session.burnRateCuPerHour, hours: estHoursLeft })
              : t('colab.cuIdleHint')}
          </div>
        </div>

        <div className="rounded-xl border border-ds-border bg-ds-card p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-ds-muted">{t('colab.gpuUtilCard')}</span>
            <svg width="56" height="18" viewBox="0 0 110 28" className="overflow-visible">
              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-emerald-500"
                points={gpuPolyline}
              />
            </svg>
          </div>
          <div className="mt-1 font-mono text-[16px] font-semibold text-ds-ink">
            {session.gpuUtilizationPct !== null ? `${session.gpuUtilizationPct}%` : '--'}
          </div>
          <div className="mt-0.5 text-[10.5px] text-ds-faint">
            {session.vramGb
              ? t('colab.vramSummary', {
                  used: session.vramUsedGb ?? 0,
                  total: session.vramGb
                })
              : `${session.ramGb} GB RAM`}
          </div>
        </div>
      </div>

      {/* 4. Training Metrics Chart */}
      <div className="rounded-xl border border-ds-border bg-ds-card p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11.5px] font-semibold text-ds-ink">{t('colab.metricsCard')}</span>
          <div className="flex items-center gap-1">
            {(metricKeys.length > 0 ? metricKeys : ['loss', 'acc']).slice(0, 4).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedMetric(key)}
                className={`rounded-md px-2 py-0.5 font-mono text-[10.5px] transition ${
                  selectedMetric === key
                    ? 'bg-accent text-white'
                    : 'bg-ds-subtle text-ds-muted hover:text-ds-ink'
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
        {activeMetricSeries.length > 0 ? (
          <div className="mt-2">
            <svg viewBox="0 0 260 64" className="h-16 w-full overflow-visible">
              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-accent"
                points={metricPolyline}
              />
            </svg>
            <div className="mt-1 flex justify-between font-mono text-[10.5px] text-ds-faint">
              <span>step {activeMetricSeries[0]?.step ?? 0}</span>
              <span>
                {selectedMetric}={activeMetricSeries.at(-1)?.value}
              </span>
            </div>
          </div>
        ) : (
          <p className="mt-2 py-3 text-center text-[11px] text-ds-faint">
            {t('colab.metricsEmpty')}
          </p>
        )}
      </div>

      {/* 5. Streaming Monospace Log Viewer */}
      <div className="rounded-xl border border-ds-border bg-[#0f131a] p-2.5 text-[#d8dee9]">
        <div className="mb-1.5 flex items-center justify-between text-[10.5px] text-[#8b96a8]">
          <span>{t('colab.logsCard')}</span>
          {session.progressSummary ? (
            <span className="font-mono text-emerald-400">{session.progressSummary}</span>
          ) : null}
        </div>
        <div
          ref={logContainerRef}
          onScroll={(e) => {
            const el = e.currentTarget
            logPinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
          className="max-h-40 overflow-y-auto font-mono text-[11px] leading-relaxed"
        >
          {session.logTail.length > 0 ? (
            session.logTail.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {line}
              </div>
            ))
          ) : (
            <div className="text-[#6e7889]">{t('colab.logsWaiting')}</div>
          )}
        </div>
      </div>

      {/* 6. Artifacts Card (above Connections) */}
      <div className="rounded-xl border border-ds-border bg-ds-card p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11.5px] font-semibold text-ds-ink">
            {t('colab.artifactsCard', { dir: session.outputRemoteDir || 'outputs/' })}
          </span>
          {session.artifacts.length > 0 ? (
            <button
              type="button"
              onClick={() => void window.kunGui.colabDownloadFromSession({ sessionId: session.id })}
              className="text-[11px] font-medium text-accent hover:underline"
            >
              {t('colab.downloadBtn')}
            </button>
          ) : null}
        </div>
        {session.artifacts.length > 0 ? (
          <div className="mt-2 space-y-1">
            {session.artifacts.map((art) => (
              <div
                key={art.remotePath}
                className="flex items-center justify-between gap-2 rounded-lg bg-ds-subtle px-2.5 py-1.5 text-[11.5px]"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-ds-ink">{art.name}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-ds-faint">
                  {formatColabBytes(art.sizeBytes)}
                </span>
                <button
                  type="button"
                  aria-label={`${t('colab.downloadBtn')} ${art.name}`}
                  onClick={() =>
                    void window.kunGui.colabDownloadFromSession({
                      sessionId: session.id,
                      remotePath: art.remotePath
                    })
                  }
                  className="rounded p-1 text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-1.5 text-[11px] text-ds-faint">{t('colab.artifactsEmpty')}</p>
        )}
      </div>
    </div>
  )
}
