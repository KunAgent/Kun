import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  File,
  Folder,
  Laptop,
  Loader2,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Upload
} from 'lucide-react'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { formatColabBytes, formatColabDuration, useColabStore } from '../colab-store'
import { RuntimeUploadStatus } from '../RuntimeUploadStatus'
import { useRuntimeUploads } from '../runtime-upload-store'
import { formatJupyterAuthLabel, isLocalJupyterUrl } from './JupyterRuntimeSection'
import { useColabNotebookStore } from './colab-notebook-store'
import { useNotebookPullStore } from './notebook-pull-store'
import type { ColabNotebookRuntime } from './use-colab-notebook-runtime'

const iconButton =
  'flex h-6 w-6 items-center justify-center rounded-md text-ds-faint hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40'

function OfflineState({ message }: { message: string }): ReactElement {
  const { t } = useTranslation('common')
  const setKernelPickerOpen = useColabNotebookStore((s) => s.setKernelPickerOpen)
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <p className="text-[12.5px] text-ds-muted">{message}</p>
      <button
        type="button"
        onClick={() => setKernelPickerOpen(true)}
        className="rounded-[8px] border border-ds-border bg-ds-main px-3 py-1.5 text-[12px] font-medium text-ds-ink hover:bg-ds-hover"
      >
        {t('colabNb.connectRuntimeBtn')}
      </button>
    </div>
  )
}

function Meter({
  label,
  value,
  pct,
  barClass = 'bg-accent'
}: {
  label: string
  value: string
  pct: number | null
  barClass?: string
}): ReactElement {
  return (
    <div className="space-y-1 py-1.5 text-[12px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ds-muted">{label}</span>
        <span className="font-mono text-[11.5px] text-ds-ink">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ds-hover">
        <span
          className={`block h-full rounded-full ${barClass}`}
          style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }}
        />
      </div>
    </div>
  )
}

function RemoteTree({
  sessionId,
  path,
  depth
}: {
  sessionId: string
  path: string
  depth: number
}): ReactElement | null {
  const { t } = useTranslation('common')
  const dir = useColabNotebookStore((s) => s.remoteDirs[path])
  const expandedDirs = useColabNotebookStore((s) => s.expandedDirs)
  const toggle = useColabNotebookStore((s) => s.toggleRemoteDir)
  const pad = { paddingLeft: 6 + depth * 14 }
  if (!dir || (dir.status === 'loading' && dir.entries.length === 0)) {
    return (
      <div className="py-1 text-[11.5px] text-ds-faint" style={pad}>
        <Loader2 className="inline h-3 w-3 animate-spin" />
      </div>
    )
  }
  if (dir.status === 'error') {
    return (
      <div className="py-1 text-[11.5px] text-red-500" style={pad}>
        {dir.error}
      </div>
    )
  }
  if (dir.entries.length === 0) {
    return (
      <div className="py-1 text-[11.5px] text-ds-faint" style={pad}>
        {t('colabNb.emptyDir')}
      </div>
    )
  }
  return (
    <>
      {dir.entries.map((entry) => {
        const open = entry.isDir && expandedDirs.includes(entry.path)
        return (
          <div key={entry.path}>
            <div
              className="group flex items-center gap-1.5 rounded-[7px] py-1 pr-1.5 text-[12.5px] text-ds-ink hover:bg-ds-hover"
              style={pad}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                onClick={() => (entry.isDir ? toggle(sessionId, entry.path) : undefined)}
                title={entry.path}
              >
                {entry.isDir ? (
                  open ? (
                    <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" />
                  ) : (
                    <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" />
                  )
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                {entry.isDir ? (
                  <Folder className="h-3.5 w-3.5 shrink-0 text-ds-muted" />
                ) : (
                  <File className="h-3.5 w-3.5 shrink-0 text-ds-muted" />
                )}
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              </button>
              {!entry.isDir ? (
                <>
                  <span className="shrink-0 text-[11px] text-ds-faint group-hover:hidden">
                    {formatColabBytes(entry.size)}
                  </span>
                  <button
                    type="button"
                    className={`${iconButton} hidden group-hover:flex`}
                    title={t('colabNb.download')}
                    aria-label={t('colabNb.download')}
                    onClick={() =>
                      void window.kunGui.colabDownloadFromSession({
                        sessionId,
                        remotePath: entry.path
                      })
                    }
                  >
                    <Download className="h-3 w-3" />
                  </button>
                </>
              ) : null}
            </div>
            {open ? <RemoteTree sessionId={sessionId} path={entry.path} depth={depth + 1} /> : null}
          </div>
        )
      })}
    </>
  )
}

export function ColabVariablesTab({ runtime }: { runtime: ColabNotebookRuntime }): ReactElement {
  const { t } = useTranslation('common')
  const variables = useColabNotebookStore((s) => s.variables)
  const variablesLoading = useColabNotebookStore((s) => s.variablesLoading)
  const loadVariables = useColabNotebookStore((s) => s.loadVariables)
  const sessionId = runtime.activeSessionId

  useEffect(() => {
    if (sessionId) void loadVariables(sessionId)
  }, [loadVariables, sessionId])

  if (!sessionId) {
    return <OfflineState message={t('colabNb.variablesOffline')} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-colab-tab-pane="variables">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-ds-border/70 px-3.5 text-[12px]">
        <span className="font-medium text-ds-muted">
          {t('colabNb.variablesTitle')}
          {variables.length > 0 ? (
            <span className="ml-1.5 rounded bg-ds-hover px-1.5 py-0.5 font-mono text-[10.5px] text-ds-ink">
              {variables.length}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className={iconButton}
          disabled={variablesLoading}
          title={t('colabNb.refresh')}
          aria-label={t('colabNb.refresh')}
          onClick={() => void loadVariables(sessionId)}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${variablesLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-2">
        {variables.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-ds-faint">{t('colabNb.variablesEmpty')}</p>
        ) : (
          <div className="divide-y divide-ds-border/60">
            {variables.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between gap-2 py-2 text-[12px]"
              >
                <span className="min-w-0 truncate font-mono font-medium text-ds-ink" title={item.name}>
                  {item.name}
                </span>
                <span className="max-w-[58%] shrink-0 truncate font-mono text-[11px] text-ds-muted">
                  {item.summary ? `${item.typeName} · ${item.summary}` : item.typeName}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function ColabFilesTab({ runtime }: { runtime: ColabNotebookRuntime }): ReactElement {
  const { t } = useTranslation('common')
  const activePath = useColabNotebookStore((s) => s.activePath)
  const dirty = useColabNotebookStore((s) => s.dirty)
  const saveNotebook = useColabNotebookStore((s) => s.saveNotebook)
  const loadRemoteDir = useColabNotebookStore((s) => s.loadRemoteDir)
  const sessionId = runtime.activeSessionId
  const transfer = useRuntimeUploads((s) => sessionId ? s.sessions[sessionId] : undefined)
  const completed = transfer && !transfer.busy ? transfer.result : undefined
  const upload = useRuntimeUploads((s) => s.start)
  const remoteRoot = runtime.remoteRoot
  const projectLabel = workspaceLabelFromPath(runtime.wsKey) || 'Project'

  useEffect(() => {
    if (sessionId) void loadRemoteDir(sessionId, remoteRoot)
  }, [loadRemoteDir, remoteRoot, sessionId, completed])

  if (!sessionId) {
    return <OfflineState message={t('colabNb.remoteOffline')} />
  }

  const syncActiveNotebook = async (): Promise<void> => {
    await upload(sessionId, activePath ?? undefined, async () => {
      if (dirty && !(await saveNotebook())) throw new Error(t('colabNb.uploadSaveFailed'))
    })
  }

  const usingJupyter = Boolean(
    sessionId && runtime.jupyterSession && sessionId === runtime.jupyterSession.id
  )
  const filesRootLabel =
    usingJupyter && runtime.jupyterSession
      ? `${runtime.jupyterSession.serverName} : ${remoteRoot}`
      : remoteRoot

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-colab-tab-pane="files">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-ds-border/70 px-3.5 text-[12px]">
        <span className="min-w-0 truncate font-mono text-ds-muted" title={filesRootLabel}>
          {filesRootLabel}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
            title={t('colabNb.upload')}
            disabled={transfer?.busy}
            onClick={() => void upload(sessionId)}
          >
            <Upload className="h-3.5 w-3.5" />{t('colabNb.upload')}
          </button>
          <button
            type="button"
            className={iconButton}
            title={t('colabNb.refresh')}
            aria-label={t('colabNb.refresh')}
            onClick={() => void loadRemoteDir(sessionId, remoteRoot)}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      <p className="px-3.5 pt-2 text-[11.5px] text-ds-muted">
        {t(usingJupyter ? 'colabNb.uploadJupyterHint' : 'colabNb.uploadColabHint')}
      </p>
      <RuntimeUploadStatus sessionId={sessionId} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <RemoteTree sessionId={sessionId} path={remoteRoot} depth={0} />
      </div>
      <div className="flex shrink-0 items-center border-t border-ds-border px-3 py-2 text-[11.5px] text-ds-muted">
        <button
          type="button"
          disabled={transfer?.busy}
          onClick={() => void syncActiveNotebook()}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
          title={t('colabNb.syncProject', { project: projectLabel })}
        >
          <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t('colabNb.syncProject', { project: projectLabel })}</span>
        </button>
      </div>
    </div>
  )
}

function JupyterResourcesCard({ runtime }: { runtime: ColabNotebookRuntime }): ReactElement {
  const { t } = useTranslation('common')
  const restartKernel = useColabNotebookStore((s) => s.restartKernel)
  const kernelBusy = useColabNotebookStore((s) => Boolean(s.runningCellId || s.queue.length || s.kunBusy))
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const jpy = runtime.jupyterSession!
  const server = runtime.jupyterServers.find((item) => item.id === jpy.serverId)
  const local = isLocalJupyterUrl(jpy.baseUrl)
  const startedMs = Date.parse(jpy.startedAt)

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const elapsedSec = Number.isFinite(startedMs) ? Math.max(0, Math.floor((nowMs - startedMs) / 1000)) : 0
  const availableKernels = server?.availableKernels ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3.5" data-colab-tab-pane="resources">
      <div className="space-y-3 rounded-[12px] border border-ds-border bg-ds-main/50 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {local ? (
              <Laptop className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
            ) : (
              <Server className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
            )}
            <span className="min-w-0 truncate text-[13px] font-semibold text-ds-ink">
              {jpy.serverName}
            </span>
            <span className="shrink-0 rounded bg-ds-hover px-1.5 py-0.5 text-[10px] font-medium text-ds-muted">
              {t(local ? 'colabNb.jupyterLocalBadge' : 'colabNb.jupyterRemoteBadge')}
            </span>
          </div>
          <span className="shrink-0 font-mono text-[11.5px] text-ds-muted">
            {formatColabDuration(elapsedSec)}
          </span>
        </div>

        <dl className="space-y-2 border-t border-ds-border/70 pt-2.5 text-[12px]">
          <div className="flex items-center justify-between gap-2">
            <dt className="shrink-0 text-ds-muted">{t('colabNb.jupyterKernelLabel')}</dt>
            <dd className="min-w-0">
              {availableKernels.length > 1 ? (
                <select
                  aria-label={t('colabNb.jupyterSwitchKernel')}
                  disabled={kernelBusy || runtime.jupyterConnecting}
                  value={jpy.kernelName}
                  onChange={(event) => {
                    const next = event.target.value
                    if (next && next !== jpy.kernelName) {
                      void runtime.connectJupyter({ serverId: jpy.serverId, kernelName: next })
                    }
                  }}
                  className="max-w-[160px] rounded-[7px] border border-ds-border bg-ds-card px-2 py-0.5 font-mono text-[11.5px] text-ds-ink focus:border-accent focus:outline-none disabled:opacity-50"
                >
                  {availableKernels.map((kernel) => (
                    <option key={kernel} value={kernel}>
                      {kernel}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-mono text-ds-ink">{jpy.kernelName}</span>
              )}
            </dd>
          </div>
          {server ? (
            <div className="flex justify-between gap-2">
              <dt className="shrink-0 text-ds-muted">Auth</dt>
              <dd className="text-ds-ink">{formatJupyterAuthLabel(server, t)}</dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <dt className="shrink-0 text-ds-muted">URL</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate font-mono text-[11.5px] text-ds-muted" title={jpy.baseUrl}>
                {jpy.baseUrl}
              </span>
              <button
                type="button"
                aria-label={t('colabNb.copyUrlShort')}
                title={copiedUrl ? t('colabNb.copiedShort') : t('colabNb.copyUrlShort')}
                onClick={async () => {
                  await navigator.clipboard?.writeText(jpy.baseUrl)
                  setCopiedUrl(true)
                  setTimeout(() => setCopiedUrl(false), 1500)
                }}
                className={iconButton}
              >
                {copiedUrl ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              </button>
            </dd>
          </div>
        </dl>

        <div className="grid grid-cols-2 gap-1.5 pt-1">
          <button
            type="button"
            disabled={kernelBusy}
            onClick={() => void restartKernel(jpy.id)}
            className="inline-flex items-center justify-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12px] font-medium text-ds-ink hover:bg-ds-hover disabled:opacity-45"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="truncate">{t('colabNb.restart')}</span>
          </button>
          {runtime.wsKey ? (
            <button
              type="button"
              onClick={() =>
                useNotebookPullStore
                  .getState()
                  .open({ kind: 'jupyter', serverId: jpy.serverId, label: jpy.serverName }, runtime.wsKey)
              }
              className="inline-flex items-center justify-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12px] font-medium text-ds-ink hover:bg-ds-hover"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="truncate">{t('colabNb.jupyterImportFromThis')}</span>
            </button>
          ) : null}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={runtime.openExternalNotebookUi}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12px] font-medium text-ds-ink hover:bg-ds-hover"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>{t('colabNb.jupyterOpenLab')}</span>
          </button>
          <button
            type="button"
            onClick={() => void runtime.disconnectJupyter()}
            className="rounded-[8px] border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-500/10 dark:text-red-400"
          >
            {t('colabNb.disconnect')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ColabResourcesTab({ runtime }: { runtime: ColabNotebookRuntime }): ReactElement {
  const { t } = useTranslation('common')
  const connections = useColabStore((s) => s.snapshot.connections)
  const sessionId = runtime.activeSessionId
  const usingJupyter = Boolean(
    sessionId && runtime.jupyterSession && sessionId === runtime.jupyterSession.id
  )

  if (!sessionId) {
    return <OfflineState message={t('colabNb.resourcesOffline')} />
  }

  if (usingJupyter && runtime.jupyterSession) {
    return <JupyterResourcesCard runtime={runtime} />
  }

  const session = runtime.session
  if (!session) {
    return <OfflineState message={t('colabNb.resourcesOffline')} />
  }

  const account = connections.find((c) => c.id === session.connectionId)
  const ramPct =
    session.ramGb > 0 && session.ramUsedGb != null ? (session.ramUsedGb / session.ramGb) * 100 : null
  const vramPct =
    session.vramGb && session.vramUsedGb != null ? (session.vramUsedGb / session.vramGb) * 100 : null
  const remainingSec =
    session.maxRuntimeHours > 0
      ? Math.max(0, Math.round(session.maxRuntimeHours * 3600 - session.elapsedSeconds))
      : null
  const hasGuard =
    session.maxRuntimeHours > 0 ||
    (session.idleAutoStopMinutes != null && session.idleAutoStopMinutes > 0) ||
    (session.maxSpendCu != null && session.maxSpendCu > 0) ||
    (session.minBalanceCu != null && session.minBalanceCu > 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3.5" data-colab-tab-pane="resources">
      <div className="space-y-3 rounded-[12px] border border-ds-border bg-ds-main/50 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-ds-ink">
              Colab · {session.accelerator === 'CPU' ? 'CPU' : `${session.accelerator} GPU`}
            </span>
            {session.highMem ? (
              <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                {t('colabNb.guardsSummaryHighMem')}
              </span>
            ) : null}
          </div>
          <span className="font-mono text-[11.5px] text-ds-muted">
            {formatColabDuration(session.elapsedSeconds)}
          </span>
        </div>

        <div className="divide-y divide-ds-border/60">
          <Meter
            label="RAM"
            value={`${(session.ramUsedGb ?? 0).toFixed(1)} / ${session.ramGb} GB`}
            pct={ramPct}
            barClass="bg-accent"
          />
          {session.vramGb != null ? (
            <Meter
              label="GPU VRAM"
              value={`${(session.vramUsedGb ?? 0).toFixed(1)} / ${session.vramGb} GB`}
              pct={vramPct}
              barClass="bg-amber-500"
            />
          ) : null}
          <Meter
            label={t('colabNb.diskLabel')}
            value={`${session.diskUsedPct ?? 0}%`}
            pct={session.diskUsedPct ?? 0}
            barClass="bg-emerald-500"
          />
        </div>

        <dl className="space-y-1.5 border-t border-ds-border/70 pt-2.5 text-[12px]">
          <div className="flex justify-between gap-2">
            <dt className="text-ds-muted">{t('colabNb.sessionCost')}</dt>
            <dd className="font-mono font-medium text-ds-ink">
              ≈ {session.consumedCu.toFixed(2)} CU
              {session.maxSpendCu ? ` / ${session.maxSpendCu} CU` : ''}
            </dd>
          </div>
          {account ? (
            <div className="flex justify-between gap-2">
              <dt className="text-ds-muted">{account.name}</dt>
              <dd className="font-mono text-ds-muted">
                {account.balanceCu != null ? `${account.balanceCu} CU` : t('colabNb.balanceUnknown')}
                {session.minBalanceCu ? ` (≥${session.minBalanceCu})` : ''}
              </dd>
            </div>
          ) : null}
        </dl>

        {hasGuard ? (
          <div className="space-y-2 rounded-[9px] border border-ds-border/80 bg-ds-card px-2.5 py-2 text-[11.5px]">
            <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate font-medium">
                {t(
                  session.watchdogActive
                    ? 'colabNb.watchdogActiveBadge'
                    : 'colabNb.watchdogAppOnlyBadge'
                )}
              </span>
            </div>
            {remainingSec !== null ? (
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-ds-muted">
                  {t('colabNb.autoStopRemaining', { time: formatColabDuration(remainingSec) })}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void runtime.extendSession(30)}
                    className="rounded-md border border-ds-border bg-ds-main px-2 py-0.5 text-[11px] font-medium text-ds-ink hover:bg-ds-hover"
                  >
                    {t('colabNb.extend30m')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void runtime.extendSession(60)}
                    className="rounded-md border border-ds-border bg-ds-main px-2 py-0.5 text-[11px] font-medium text-ds-ink hover:bg-ds-hover"
                  >
                    {t('colabNb.extend1h')}
                  </button>
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={runtime.openExternalNotebookUi}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12px] font-medium text-ds-ink hover:bg-ds-hover"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>{t('colabNb.openInColab')}</span>
          </button>
          <button
            type="button"
            onClick={() => void runtime.disconnect()}
            className="rounded-[8px] border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-500/10 dark:text-red-400"
          >
            {t('colabNb.disconnect')}
          </button>
        </div>
      </div>
    </div>
  )
}
