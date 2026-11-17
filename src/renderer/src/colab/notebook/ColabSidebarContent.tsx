import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Download,
  Ellipsis,
  File,
  Folder,
  FolderOpen,
  Loader2,
  NotebookPen,
  Plus,
  RefreshCw,
  Settings,
  Upload
} from 'lucide-react'
import { COLAB_ACCELERATORS, COLAB_ACCELERATOR_SPECS, type ColabAccelerator } from '@shared/colab/colab-types'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { useChatStore } from '../../store/chat-store'
import {
  formatColabBytes,
  formatColabDuration,
  isColabSessionRunning,
  selectWorkspaceSessions,
  useColabStore,
  useColabSubscription
} from '../colab-store'
import { ColabConnectionsSection } from '../ColabConnectionsSection'
import { ColabRuntimeSetup } from '../ColabRuntimeSetup'
import { COLAB_REMOTE_ROOT, useColabNotebookStore } from './colab-notebook-store'
import { useColabNotebookRuntime, type ColabNotebookRuntime } from './use-colab-notebook-runtime'

const sectionTitle = 'flex items-center justify-between px-2.5 pb-1 pt-3.5 text-[11.5px] font-semibold text-ds-faint'
const iconButton =
  'flex h-6 w-6 items-center justify-center rounded-md text-ds-faint hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40'

function Meter({ label, pct }: { label: string; pct: number | null }): ReactElement {
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-[10.5px] text-ds-muted">{label}</div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-ds-hover">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} />
      </div>
    </div>
  )
}

function RuntimeCard({ runtime }: { runtime: ColabNotebookRuntime }): ReactElement {
  const { t } = useTranslation('common')
  const accelerator = useColabNotebookStore((s) => s.accelerator)
  const setAccelerator = useColabNotebookStore((s) => s.setAccelerator)
  const { connection, session, pending, failed } = runtime
  const live = session ?? pending
  const selected: ColabAccelerator = live?.accelerator ?? accelerator
  const busy = runtime.connecting || Boolean(pending)
  const error = runtime.error ?? failed?.errorMessage ?? null
  const ramPct = session && session.ramGb > 0 && session.ramUsedGb != null ? (session.ramUsedGb / session.ramGb) * 100 : null
  const vramPct =
    session && session.vramGb && session.vramUsedGb != null ? (session.vramUsedGb / session.vramGb) * 100 : null

  return (
    <div className="mx-1 rounded-[10px] border border-ds-border bg-ds-card p-2.5">
      <div className="flex items-center gap-2 text-[12.5px]">
        <span
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{ background: connection?.avatarColor || 'var(--color-accent, #4f6bed)' }}
        >
          {(connection?.name || '?').slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold text-ds-ink">{connection?.name}</span>
        <span className="shrink-0 font-mono text-[12px] font-semibold text-ds-ink">
          {connection?.balanceCu != null ? `${connection.balanceCu} CU` : '—'}
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-4 gap-1" role="radiogroup" aria-label={t('colabNb.runtime')}>
        {COLAB_ACCELERATORS.map((id) => {
          const spec = COLAB_ACCELERATOR_SPECS[id]
          const on = selected === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={Boolean(live)}
              onClick={() => setAccelerator(id)}
              className={`rounded-[7px] border py-1 text-center text-[12px] font-semibold transition disabled:cursor-default ${
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
      {session ? (
        <div className="mt-2.5 flex gap-2">
          <Meter
            label={t('colabNb.ram', { used: (session.ramUsedGb ?? 0).toFixed(1), total: session.ramGb })}
            pct={ramPct}
          />
          {session.vramGb != null ? (
            <Meter
              label={t('colabNb.gpuMeter', { used: (session.vramUsedGb ?? 0).toFixed(1), total: session.vramGb })}
              pct={vramPct}
            />
          ) : null}
          <Meter label={t('colabNb.disk', { pct: session.diskUsedPct ?? 0 })} pct={session.diskUsedPct ?? 0} />
        </div>
      ) : null}
      {error ? <p className="mt-2 line-clamp-3 text-[11px] text-red-500">{t('colabNb.connectFailed', { message: error })}</p> : null}
      <div className="mt-2.5 flex gap-1.5">
        {session ? (
          <div className="flex min-w-0 flex-1 items-center justify-center rounded-[7px] bg-accent px-2 py-1.5 text-[12px] font-semibold text-white">
            <span className="truncate">{t('colabNb.connected', { elapsed: formatColabDuration(session.elapsedSeconds) })}</span>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy || !runtime.wsKey || connection?.status !== 'connected'}
            onClick={() => void runtime.connect(selected)}
            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[7px] bg-accent px-2 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            <span className="truncate">{busy ? t('colabNb.connecting') : t('colabNb.connect', { gpu: selected })}</span>
          </button>
        )}
        {live ? (
          <button
            type="button"
            onClick={() => void runtime.disconnect()}
            className="shrink-0 rounded-[7px] border border-ds-border px-2.5 py-1.5 text-[12px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
          >
            {t('colabNb.disconnect')}
          </button>
        ) : null}
      </div>
      {session && session.consumedCu > 0 ? (
        <div className="mt-1.5 text-right text-[10.5px] text-ds-faint">{t('colabNb.consumed', { cu: session.consumedCu.toFixed(2) })}</div>
      ) : null}
    </div>
  )
}

function RemoteTree({ sessionId, path, depth }: { sessionId: string; path: string; depth: number }): ReactElement | null {
  const { t } = useTranslation('common')
  const dir = useColabNotebookStore((s) => s.remoteDirs[path])
  const expandedDirs = useColabNotebookStore((s) => s.expandedDirs)
  const toggle = useColabNotebookStore((s) => s.toggleRemoteDir)
  const pad = { paddingLeft: 10 + depth * 14 }
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

/** Compact status pill for the sidebar Colab entry while a runtime is live. */
export function ColabNavBadge({ workspaceRoot }: { workspaceRoot: string }): ReactElement | null {
  useColabSubscription()
  const { t } = useTranslation('common')
  const snapshot = useColabStore((s) => s.snapshot)
  const live = selectWorkspaceSessions(snapshot, workspaceRoot).find(isColabSessionRunning)
  if (!live) return null
  return (
    <span className="rounded-full bg-emerald-500/15 px-1.5 text-[10.5px] font-semibold text-emerald-600">
      {t('colabNb.gpuRunning', { gpu: live.accelerator })}
    </span>
  )
}

export function ColabSidebarContent({
  workspaceRoot,
  onOpenSettings
}: {
  workspaceRoot: string
  onOpenSettings?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const runtime = useColabNotebookRuntime(workspaceRoot)
  const cliState = useColabStore((s) => s.snapshot.cli.state)
  const connectionsExpanded = useColabStore((s) => s.connectionsExpanded)
  const setConnectionsExpanded = useColabStore((s) => s.setConnectionsExpanded)
  const chooseWorkspace = useChatStore((s) => s.chooseWorkspace)
  const notebooks = useColabNotebookStore((s) => s.notebooks)
  const activePath = useColabNotebookStore((s) => s.activePath)
  const dirty = useColabNotebookStore((s) => s.dirty)
  const openNotebook = useColabNotebookStore((s) => s.openNotebook)
  const createNotebook = useColabNotebookStore((s) => s.createNotebook)
  const saveNotebook = useColabNotebookStore((s) => s.saveNotebook)
  const loadRemoteDir = useColabNotebookStore((s) => s.loadRemoteDir)
  const [syncing, setSyncing] = useState(false)
  const sessionId = runtime.session?.id ?? null
  const showAccounts = !runtime.connection || runtime.connection.status !== 'connected' || connectionsExpanded
  const projectLabel = workspaceLabelFromPath(runtime.wsKey) || 'Project'

  useEffect(() => {
    if (sessionId) void loadRemoteDir(sessionId, COLAB_REMOTE_ROOT)
  }, [loadRemoteDir, sessionId])

  if (!runtime.wsKey) {
    return (
      <div className="ds-no-drag flex flex-col gap-2.5 px-3 py-4">
        <p className="text-[12px] leading-relaxed text-ds-muted">{t('colabNb.noWorkspace')}</p>
        <button
          type="button"
          onClick={() => void chooseWorkspace({ createThreadAfter: false, selectThreadAfter: false })}
          className="inline-flex items-center justify-center gap-1.5 rounded-[7px] border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-medium text-ds-ink hover:bg-ds-hover"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          {t('colabNb.chooseProject')}
        </button>
      </div>
    )
  }

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
      await loadRemoteDir(sessionId, COLAB_REMOTE_ROOT)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="ds-no-drag flex min-h-0 flex-1 flex-col" data-colab-sidebar>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
        <div className={sectionTitle}>
          <span>{t('colabNb.runtime')}</span>
          {runtime.connection ? (
            <button
              type="button"
              className={iconButton}
              aria-expanded={connectionsExpanded}
              title={t('colabNb.manageAccounts')}
              aria-label={t('colabNb.manageAccounts')}
              onClick={() => setConnectionsExpanded(!connectionsExpanded)}
            >
              <Ellipsis className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        {runtime.connection && cliState !== 'ready' ? <ColabRuntimeSetup inPanel /> : null}
        {runtime.connection ? <RuntimeCard runtime={runtime} /> : null}
        {showAccounts ? (
          <div className="mt-2 px-1">
            <ColabConnectionsSection workspaceRoot={runtime.wsKey} />
          </div>
        ) : null}

        <div className={sectionTitle}>
          <span>{t('colabNb.notebooks')}</span>
          <button type="button" className={iconButton} title={t('colabNb.newNotebook')} aria-label={t('colabNb.newNotebook')}
            onClick={() => void createNotebook(runtime.wsKey)}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {notebooks.length === 0 ? (
          <p className="px-2.5 py-1 text-[12px] text-ds-faint">{t('colabNb.noNotebooks')}</p>
        ) : notebooks.map((path) => {
          const active = path === activePath
          return (
            <button
              key={path}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => void openNotebook(path)}
              className={`mx-1 flex items-center gap-2 rounded-[7px] px-2 py-1 text-left text-[12.5px] ${
                active ? 'bg-ds-card font-medium text-ds-ink shadow-sm' : 'text-ds-ink hover:bg-ds-hover'
              }`}
            >
              <NotebookPen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span className="min-w-0 flex-1 truncate" title={path}>{path}</span>
              {active ? <span className="shrink-0 text-[11px] text-ds-faint">{dirty ? t('colabNb.unsaved') : t('colabNb.saved')}</span> : null}
            </button>
          )
        })}

        <div className={sectionTitle}>
          <span className="truncate">{t('colabNb.remoteFiles')} <span className="font-mono font-normal">{COLAB_REMOTE_ROOT}</span></span>
          <span className="flex shrink-0 items-center">
            <button type="button" className={iconButton} disabled={!sessionId} title={t('colabNb.upload')} aria-label={t('colabNb.upload')}
              onClick={() => {
                if (!sessionId) return
                void window.kunGui.colabUploadToSession({ sessionId }).then(() => loadRemoteDir(sessionId, COLAB_REMOTE_ROOT))
              }}>
              <Upload className="h-3.5 w-3.5" />
            </button>
            <button type="button" className={iconButton} disabled={!sessionId} title={t('colabNb.refresh')} aria-label={t('colabNb.refresh')}
              onClick={() => sessionId && void loadRemoteDir(sessionId, COLAB_REMOTE_ROOT)}>
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
        {sessionId ? (
          <div className="px-1"><RemoteTree sessionId={sessionId} path={COLAB_REMOTE_ROOT} depth={0} /></div>
        ) : (
          <p className="px-2.5 py-1 text-[12px] text-ds-faint">{t('colabNb.remoteOffline')}</p>
        )}
      </div>

      <div className="mx-1 flex items-center gap-1.5 border-t border-ds-border px-1.5 py-1.5 text-[11.5px] text-ds-muted">
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
        {onOpenSettings ? (
          <button
            type="button"
            className={iconButton}
            onClick={onOpenSettings}
            title={t('colabNb.openSettings')}
            aria-label={t('colabNb.openSettings')}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
