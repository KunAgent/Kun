import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Download,
  File,
  Folder,
  Loader2,
  RefreshCw,
  Upload
} from 'lucide-react'
import { COLAB_ACCELERATORS, COLAB_ACCELERATOR_SPECS, type ColabAccelerator, type ColabConnectionView } from '@shared/colab/colab-types'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { formatColabBytes, formatColabDuration, useColabStore } from '../colab-store'
import { ColabRuntimeSetup } from '../ColabRuntimeSetup'
import { useColabNotebookStore } from './colab-notebook-store'
import type { ColabNotebookRuntime } from './use-colab-notebook-runtime'

const iconButton =
  'flex h-6 w-6 items-center justify-center rounded-md text-ds-faint hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40'

function Group({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }): ReactElement {
  return (
    <section className="mb-4">
      <div className="mb-1.5 flex min-h-6 items-center justify-between px-0.5 text-[11.5px] font-semibold text-ds-faint">
        <span className="min-w-0 truncate">{title}</span>
        {actions ? <span className="flex shrink-0 items-center">{actions}</span> : null}
      </div>
      {children}
    </section>
  )
}

function Meter({ label, value, pct }: { label: string; value: string; pct: number | null }): ReactElement {
  return (
    <div className="flex items-center gap-2 py-1 text-[12px]">
      <span className="w-11 shrink-0 text-ds-muted">{label}</span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ds-hover">
        <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} />
      </span>
      <span className="w-[76px] shrink-0 text-right font-mono text-[11px] text-ds-muted">{value}</span>
    </div>
  )
}

export function ColabComputeControls({ runtime, account }: {
  runtime: ColabNotebookRuntime
  account: ColabConnectionView
}): ReactElement {
  const { t } = useTranslation('common')
  const accelerator = useColabNotebookStore((s) => s.accelerator)
  const setAccelerator = useColabNotebookStore((s) => s.setAccelerator)
  const cliState = useColabStore((s) => s.snapshot.cli.state)
  const active = runtime.session ?? runtime.pending
  const owned = active?.connectionId === account.id
  const session = owned ? runtime.session : null
  const pending = owned ? runtime.pending : null
  const failed = runtime.failed?.connectionId === account.id ? runtime.failed : null
  const live = session ?? pending
  const kernelBusy = useColabNotebookStore((s) => Boolean(s.runningCellId || s.queue.length || s.kunBusy))
  const selected: ColabAccelerator = live?.accelerator ?? accelerator
  const busy = runtime.connecting || Boolean(pending)
  const error = runtime.error ?? failed?.errorMessage ?? null

  return (
    <div className="rounded-[12px] border border-ds-border bg-ds-card p-3">
      <div className="flex items-center gap-2 text-[12.5px]">
        <span
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{ background: account.avatarColor }}
        >
          {account.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold text-ds-ink" title={account.name}>{account.name}</span>
        <span className="shrink-0 font-mono text-[12px] font-semibold text-ds-ink">
          {account.balanceCu != null ? `${account.balanceCu} CU` : '—'}
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={t('colabNb.runtime')}>
        {COLAB_ACCELERATORS.map((id) => {
          const spec = COLAB_ACCELERATOR_SPECS[id]
          const on = selected === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={Boolean(active)}
              onClick={() => setAccelerator(id)}
              className={`rounded-[8px] border py-1 text-center text-[12px] font-semibold transition disabled:cursor-default ${
                on ? 'border-accent bg-accent/10 text-accent' : 'border-ds-border text-ds-ink hover:bg-ds-hover'
              } ${live && !on ? 'opacity-40' : ''}`}
            >
              {spec.label}
              <span className="block text-[10px] font-normal text-ds-faint">
                {t('colabNb.perHour', { cu: spec.estimatedCuPerHour })}
              </span>
            </button>
          )
        })}
      </div>
      {cliState !== 'ready' && !active ? <div className="mt-2"><ColabRuntimeSetup inPanel /></div> : null}
      {active && !owned ? <p className="mt-2 text-[11px] text-ds-muted">{t('colabNb.stopOtherColab', { name: active.connectionName })}</p> : null}
      {error ? <p className="mt-2 line-clamp-3 text-[11px] text-red-500">{t('colabNb.connectFailed', { message: error })}</p> : null}
      <div className="mt-2.5 flex gap-1.5">
        {session && runtime.activeSessionId !== session.id ? (
          <button type="button" disabled={kernelBusy} onClick={() => runtime.setBackend('colab')}
            className="min-w-0 flex-1 rounded-lg bg-accent px-2 py-1.5 text-[12px] font-semibold text-white disabled:opacity-45">
            {t('colabNb.useExecutionKernel')}
          </button>
        ) : session ? (
          <div className="flex min-w-0 flex-1 items-center justify-center rounded-[8px] bg-accent px-2 py-1.5 text-[12px] font-semibold text-white">
            <span className="truncate">{t('colabNb.connected', { elapsed: formatColabDuration(session.elapsedSeconds) })}</span>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy || kernelBusy || Boolean(active) || !runtime.wsKey || account.status !== 'connected' || cliState !== 'ready'}
            onClick={() => void runtime.connect(selected, account)}
            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-accent px-2 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            <span className="truncate">{busy ? t('colabNb.connecting') : t('colabNb.connect', { gpu: selected })}</span>
          </button>
        )}
        {live ? (
          <button
            type="button"
            onClick={() => void runtime.disconnect()}
            className="shrink-0 rounded-[8px] border border-ds-border px-2.5 py-1.5 text-[12px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
          >
            {t('colabNb.disconnect')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function ResourceCard({ runtime }: { runtime: ColabNotebookRuntime }): ReactElement | null {
  const { t } = useTranslation('common')
  const session = runtime.session
  if (!session) return null
  const ramPct = session.ramGb > 0 && session.ramUsedGb != null ? (session.ramUsedGb / session.ramGb) * 100 : null
  const vramPct = session.vramGb && session.vramUsedGb != null ? (session.vramUsedGb / session.vramGb) * 100 : null
  return (
    <div className="rounded-[12px] border border-ds-border bg-ds-card px-3 py-2">
      <Meter label="RAM" value={`${(session.ramUsedGb ?? 0).toFixed(1)}/${session.ramGb}G`} pct={ramPct} />
      {session.vramGb != null ? (
        <Meter label="GPU" value={`${(session.vramUsedGb ?? 0).toFixed(1)}/${session.vramGb}G`} pct={vramPct} />
      ) : null}
      <Meter label={t('colabNb.diskLabel')} value={`${session.diskUsedPct ?? 0}%`} pct={session.diskUsedPct ?? 0} />
      {session.consumedCu > 0 ? (
        <div className="flex justify-between pt-1 text-[12px] text-ds-muted">
          <span>{t('colabNb.sessionCost')}</span>
          <span className="font-mono text-ds-ink">{session.consumedCu.toFixed(2)} CU</span>
        </div>
      ) : null}
    </div>
  )
}

function RemoteTree({ sessionId, path, depth }: { sessionId: string; path: string; depth: number }): ReactElement | null {
  const { t } = useTranslation('common')
  const dir = useColabNotebookStore((s) => s.remoteDirs[path])
  const expandedDirs = useColabNotebookStore((s) => s.expandedDirs)
  const toggle = useColabNotebookStore((s) => s.toggleRemoteDir)
  const pad = { paddingLeft: 6 + depth * 14 }
  if (!dir || (dir.status === 'loading' && dir.entries.length === 0)) {
    return <div className="py-1 text-[11.5px] text-ds-faint" style={pad}><Loader2 className="inline h-3 w-3 animate-spin" /></div>
  }
  if (dir.status === 'error') return <div className="py-1 text-[11.5px] text-red-500" style={pad}>{dir.error}</div>
  if (dir.entries.length === 0) return <div className="py-1 text-[11.5px] text-ds-faint" style={pad}>{t('colabNb.emptyDir')}</div>
  return (
    <>
      {dir.entries.map((entry) => {
        const open = entry.isDir && expandedDirs.includes(entry.path)
        return (
          <div key={entry.path}>
            <div
              className="group flex items-center gap-1.5 rounded-[7px] py-[3px] pr-1.5 text-[12.5px] text-ds-ink hover:bg-ds-hover"
              style={pad}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                onClick={() => (entry.isDir ? toggle(sessionId, entry.path) : undefined)}
                title={entry.path}
              >
                {entry.isDir ? (
                  open ? <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" /> : <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" />
                ) : <span className="w-3 shrink-0" />}
                {entry.isDir ? <Folder className="h-3.5 w-3.5 shrink-0 text-ds-muted" /> : <File className="h-3.5 w-3.5 shrink-0 text-ds-muted" />}
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              </button>
              {!entry.isDir ? (
                <>
                  <span className="shrink-0 text-[11px] text-ds-faint group-hover:hidden">{formatColabBytes(entry.size)}</span>
                  <button
                    type="button"
                    className={`${iconButton} hidden group-hover:flex`}
                    title={t('colabNb.download')}
                    aria-label={t('colabNb.download')}
                    onClick={() => void window.kunGui.colabDownloadFromSession({ sessionId, remotePath: entry.path })}
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

/** Kernel inspection and project sync, opened explicitly from the left sidebar. */
export function ColabRuntimePane({ runtime }: { runtime: ColabNotebookRuntime }): ReactElement {
  const { t } = useTranslation('common')
  const activePath = useColabNotebookStore((s) => s.activePath)
  const dirty = useColabNotebookStore((s) => s.dirty)
  const saveNotebook = useColabNotebookStore((s) => s.saveNotebook)
  const loadRemoteDir = useColabNotebookStore((s) => s.loadRemoteDir)
  const variables = useColabNotebookStore((s) => s.variables)
  const variablesLoading = useColabNotebookStore((s) => s.variablesLoading)
  const loadVariables = useColabNotebookStore((s) => s.loadVariables)
  const [syncing, setSyncing] = useState(false)
  const sessionId = runtime.activeSessionId
  const remoteRoot = runtime.remoteRoot
  const projectLabel = workspaceLabelFromPath(runtime.wsKey) || 'Project'

  useEffect(() => {
    if (!sessionId) return
    void loadRemoteDir(sessionId, remoteRoot)
    void loadVariables(sessionId)
  }, [loadRemoteDir, loadVariables, remoteRoot, sessionId])

  const syncActiveNotebook = async (): Promise<void> => {
    if (!sessionId || syncing) return
    setSyncing(true)
    try {
      if (dirty) await saveNotebook()
      if (activePath) {
        const resolved = await window.kunGui.resolveWorkspaceFile({ path: activePath, workspaceRoot: runtime.wsKey })
        if (resolved.ok) {
          await window.kunGui.colabUploadToSession({ sessionId, localPaths: [resolved.path] })
        }
      } else {
        await window.kunGui.colabUploadToSession({ sessionId })
      }
      await loadRemoteDir(sessionId, remoteRoot)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-colab-runtime-pane>
      <div className="px-2 pt-2">
        {runtime.session && sessionId === runtime.session.id ? (
          <Group title={t('colabNb.resourcesTitle')}>
            <ResourceCard runtime={runtime} />
          </Group>
        ) : null}

        <Group
          title={<>{t('colabNb.remoteFiles')} <span className="font-mono font-normal">{remoteRoot}</span></>}
          actions={(
            <>
              <button type="button" className={iconButton} disabled={!sessionId} title={t('colabNb.upload')} aria-label={t('colabNb.upload')}
                onClick={() => {
                  if (!sessionId) return
                  void window.kunGui.colabUploadToSession({ sessionId }).then(() => loadRemoteDir(sessionId, remoteRoot))
                }}>
                <Upload className="h-3.5 w-3.5" />
              </button>
              <button type="button" className={iconButton} disabled={!sessionId} title={t('colabNb.refresh')} aria-label={t('colabNb.refresh')}
                onClick={() => sessionId && void loadRemoteDir(sessionId, remoteRoot)}>
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        >
          <div className="rounded-[12px] border border-ds-border bg-ds-card p-1.5">
            {sessionId ? (
              <RemoteTree sessionId={sessionId} path={remoteRoot} depth={0} />
            ) : (
              <p className="px-1.5 py-1 text-[12px] text-ds-faint">{t('colabNb.remoteOffline')}</p>
            )}
          </div>
        </Group>

        <Group
          title={(
            <>
              {t('colabNb.variablesTitle')}
              {variables.length > 0 ? (
                <span className="ml-1.5 rounded bg-ds-hover px-1.5 py-0.5 font-mono text-[10px] font-medium text-ds-muted">
                  {variables.length}
                </span>
              ) : null}
            </>
          )}
          actions={(
            <button
              type="button"
              className={iconButton}
              disabled={!sessionId || variablesLoading}
              title={t('colabNb.refresh')}
              aria-label={t('colabNb.refresh')}
              onClick={() => sessionId && void loadVariables(sessionId)}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${variablesLoading ? 'animate-spin' : ''}`} />
            </button>
          )}
        >
          <div className="rounded-[12px] border border-ds-border bg-ds-card px-2.5 py-1.5">
            {!sessionId ? (
              <p className="py-1 text-[12px] text-ds-faint">{t('colabNb.variablesOffline')}</p>
            ) : variables.length === 0 ? (
              <p className="py-1 text-[12px] text-ds-faint">{t('colabNb.variablesEmpty')}</p>
            ) : (
              <div className="divide-y divide-ds-border/60">
                {variables.map((item) => (
                  <div key={item.name} className="flex items-center justify-between gap-2 py-1 text-[12px]">
                    <span className="min-w-0 truncate font-mono text-ds-ink" title={item.name}>{item.name}</span>
                    <span className="shrink-0 truncate font-mono text-[11px] text-ds-muted">
                      {item.summary ? `${item.typeName} · ${item.summary}` : item.typeName}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Group>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-t border-ds-border px-3 py-1.5 text-[11.5px] text-ds-muted">
        <button
          type="button"
          disabled={!sessionId || syncing}
          onClick={() => void syncActiveNotebook()}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-ds-hover hover:text-ds-ink disabled:cursor-default disabled:hover:bg-transparent"
          title={t('colabNb.syncProject', { project: projectLabel })}
        >
          {syncing ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <ArrowLeftRight className="h-3 w-3 shrink-0" />}
          <span className="truncate">
            {syncing ? t('colabNb.syncingProject') : t('colabNb.syncProject', { project: projectLabel })}
          </span>
        </button>
        </div>
    </div>
  )
}
