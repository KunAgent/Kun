import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudCheck,
  Copy,
  Download,
  File,
  Folder,
  HardDrive,
  Loader2,
  RefreshCw,
  Unplug,
  Upload,
  X
} from 'lucide-react'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { formatColabBytes, useColabStore } from '../colab-store'
import { RuntimeUploadStatus } from '../RuntimeUploadStatus'
import { useRuntimeUploads } from '../runtime-upload-store'
import { ColabDriveAuthCard, formatDriveMountErrorMessage } from './ColabDriveAuthCard'
import { useColabDriveStore } from './colab-drive-store'
import { useColabNotebookStore } from './colab-notebook-store'
import type { ColabNotebookRuntime } from './use-colab-notebook-runtime'

export { ColabDriveAuthCard, formatDriveMountErrorMessage } from './ColabDriveAuthCard'

const iconButton =
  'flex h-6 w-6 items-center justify-center rounded-md text-ds-faint hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40'

function isDriveFolderPath(path: string, mountPath?: string): boolean {
  if (
    path === '/content/drive' ||
    path === '/content/drive/MyDrive' ||
    path === '/content/drive/My Drive'
  ) {
    return true
  }
  return Boolean(
    mountPath &&
      path !== '/content' &&
      (path === mountPath || mountPath.startsWith(`${path}/`))
  )
}

function RemoteTree({
  sessionId,
  path,
  depth,
  uploadBusy,
  mountedDrivePath,
  onUploadToDir
}: {
  sessionId: string
  path: string
  depth: number
  uploadBusy: boolean
  mountedDrivePath?: string
  onUploadToDir: (dirPath: string) => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const dir = useColabNotebookStore((s) => s.remoteDirs[path])
  const expandedDirs = useColabNotebookStore((s) => s.expandedDirs)
  const toggle = useColabNotebookStore((s) => s.toggleRemoteDir)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const pad = { paddingLeft: 6 + depth * 14 }

  const copyEntryPath = async (entryPath: string): Promise<void> => {
    await navigator.clipboard?.writeText(entryPath)
    setCopiedPath(entryPath)
    setTimeout(() => {
      setCopiedPath((cur) => (cur === entryPath ? null : cur))
    }, 1400)
  }

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
        const prefix = path === '/' ? '/' : `${path}/`
        const canExpand = entry.isDir && depth < 16 && entry.path !== path && entry.path.startsWith(prefix)
        const open = canExpand && expandedDirs.includes(entry.path)
        const isDriveNode = entry.isDir && isDriveFolderPath(entry.path, mountedDrivePath)
        const copied = copiedPath === entry.path
        return (
          <div key={entry.path}>
            <div
              className="group flex items-center gap-1 rounded-[7px] py-1 pr-1.5 text-[12.5px] text-ds-ink hover:bg-ds-hover"
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
                {isDriveNode ? (
                  <HardDrive className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                ) : entry.isDir ? (
                  <Folder className="h-3.5 w-3.5 shrink-0 text-ds-muted" />
                ) : (
                  <File className="h-3.5 w-3.5 shrink-0 text-ds-muted" />
                )}
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              </button>

              {entry.isDir ? (
                <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  <button
                    type="button"
                    data-colab-upload-dir={entry.path}
                    disabled={uploadBusy}
                    className={iconButton}
                    title={t('colabNb.uploadToFolder')}
                    aria-label={t('colabNb.uploadToFolder')}
                    onClick={() => onUploadToDir(entry.path)}
                  >
                    <Upload className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    title={copied ? t('colabNb.copiedShort') : t('colabNb.copyPathShort')}
                    aria-label={t('colabNb.copyPathShort')}
                    onClick={() => void copyEntryPath(entry.path)}
                  >
                    {copied ? (
                      <Check className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                </span>
              ) : (
                <>
                  <span className="shrink-0 text-[11px] text-ds-faint group-hover:hidden">
                    {formatColabBytes(entry.size)}
                  </span>
                  <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                    <button
                      type="button"
                      className={iconButton}
                      title={copied ? t('colabNb.copiedShort') : t('colabNb.copyPathShort')}
                      aria-label={t('colabNb.copyPathShort')}
                      onClick={() => void copyEntryPath(entry.path)}
                    >
                      {copied ? (
                        <Check className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                    <button
                      type="button"
                      className={iconButton}
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
                  </span>
                </>
              )}
            </div>
            {open ? (
              <RemoteTree
                sessionId={sessionId}
                path={entry.path}
                depth={depth + 1}
                uploadBusy={uploadBusy}
                mountedDrivePath={mountedDrivePath}
                onUploadToDir={onUploadToDir}
              />
            ) : null}
          </div>
        )
      })}
    </>
  )
}

export function ColabFilesTab({
  runtime,
  offlineFallback
}: {
  runtime: ColabNotebookRuntime
  offlineFallback: ReactElement
}): ReactElement {
  const { t } = useTranslation('common')
  const activePath = useColabNotebookStore((s) => s.activePath)
  const dirty = useColabNotebookStore((s) => s.dirty)
  const rootDirState = useColabNotebookStore((s) => s.remoteDirs[runtime.remoteRoot])
  const saveNotebook = useColabNotebookStore((s) => s.saveNotebook)
  const loadRemoteDir = useColabNotebookStore((s) => s.loadRemoteDir)
  const revealRemotePaths = useColabNotebookStore((s) => s.revealRemotePaths)

  const sessionId = runtime.activeSessionId
  const connections = useColabStore((s) => s.snapshot.connections)
  const driveState = useColabDriveStore((s) => (sessionId ? s.states[sessionId] : undefined))
  const probed = useColabDriveStore((s) => (sessionId ? Boolean(s.probedSessions[sessionId]) : false))
  const syncDriveStatus = useColabDriveStore((s) => s.syncStatus)
  const mountDrive = useColabDriveStore((s) => s.mount)
  const unmountDrive = useColabDriveStore((s) => s.unmount)
  const applyDriveState = useColabDriveStore((s) => s.applyState)

  const transfer = useRuntimeUploads((s) => (sessionId ? s.sessions[sessionId] : undefined))
  const completed = transfer && !transfer.busy ? transfer.result : undefined
  const lastTargetDir = transfer && !transfer.busy ? transfer.targetRemoteDir : undefined
  const upload = useRuntimeUploads((s) => s.start)

  const [copiedMountPath, setCopiedMountPath] = useState(false)
  const [copiedCkptPath, setCopiedCkptPath] = useState(false)
  const revealedMountKeyRef = useRef<string | null>(null)

  const usingJupyter = Boolean(
    sessionId && runtime.jupyterSession && sessionId === runtime.jupyterSession.id
  )
  const remoteRoot = runtime.remoteRoot
  const projectLabel = workspaceLabelFromPath(runtime.wsKey) || 'Project'

  useEffect(() => {
    if (!sessionId) return
    void loadRemoteDir(sessionId, remoteRoot)
    if (lastTargetDir && lastTargetDir !== remoteRoot) {
      void revealRemotePaths(sessionId, [lastTargetDir])
    }
  }, [completed, lastTargetDir, loadRemoteDir, remoteRoot, revealRemotePaths, sessionId])

  // Sync cached mount state and probe if `/content/drive` already exists on the VM.
  useEffect(() => {
    if (!sessionId || usingJupyter) return
    void syncDriveStatus(sessionId)
  }, [sessionId, syncDriveStatus, usingJupyter])

  useEffect(() => {
    if (!sessionId || usingJupyter || probed) return
    if (
      driveState?.status === 'mounting' ||
      driveState?.status === 'needs_auth' ||
      driveState?.status === 'unmounting'
    ) {
      return
    }
    if (rootDirState?.status === 'ready' && rootDirState.entries.some((e) => e.isDir && e.name === 'drive')) {
      void syncDriveStatus(sessionId, { probe: true })
    }
  }, [driveState?.status, probed, rootDirState, sessionId, syncDriveStatus, usingJupyter])

  // Auto-expand and load mounted Drive path right when Drive mounts.
  useEffect(() => {
    if (!sessionId || usingJupyter || driveState?.status !== 'mounted') {
      revealedMountKeyRef.current = null
      return
    }
    const key = `${sessionId}:${driveState.mountPath}`
    if (revealedMountKeyRef.current === key) return
    revealedMountKeyRef.current = key
    void revealRemotePaths(sessionId, [remoteRoot, driveState.mountPath])
  }, [driveState, remoteRoot, revealRemotePaths, sessionId, usingJupyter])

  if (!sessionId) {
    return offlineFallback
  }

  const account = runtime.session
    ? connections.find((c) => c.id === runtime.session?.connectionId)
    : runtime.connection
  const accountLabel = account?.email || account?.name

  const isMounted = !usingJupyter && driveState?.status === 'mounted'
  const isMountBusy =
    !usingJupyter &&
    (driveState?.status === 'mounting' || driveState?.status === 'unmounting')

  const syncActiveNotebook = async (targetDir?: string): Promise<void> => {
    await upload(
      sessionId,
      activePath ?? undefined,
      async () => {
        if (dirty && !(await saveNotebook())) throw new Error(t('colabNb.uploadSaveFailed'))
      },
      targetDir
    )
  }

  const handleRefresh = (): void => {
    void loadRemoteDir(sessionId, remoteRoot)
    if (!usingJupyter) {
      if (driveState?.status === 'mounted') {
        void revealRemotePaths(sessionId, [driveState.mountPath])
      } else {
        void syncDriveStatus(sessionId, { probe: true })
      }
    }
  }

  const handleUnmount = async (): Promise<void> => {
    revealedMountKeyRef.current = null
    const res = await unmountDrive(sessionId)
    if (res.ok) void loadRemoteDir(sessionId, remoteRoot)
  }

  const filesRootLabel =
    usingJupyter && runtime.jupyterSession
      ? `${runtime.jupyterSession.serverName} : ${remoteRoot}`
      : remoteRoot

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-colab-tab-pane="files">
      <div className="flex h-9 shrink-0 items-center justify-between gap-1 border-b border-ds-border/70 px-3 text-[12px]">
        <span className="min-w-0 truncate font-mono text-ds-muted" title={filesRootLabel}>
          {filesRootLabel}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {!usingJupyter ? (
            isMounted ? (
              <button
                type="button"
                data-colab-drive-mounted
                title={driveState.mountPath}
                onClick={() =>
                  void revealRemotePaths(sessionId, [remoteRoot, driveState.mountPath])
                }
                className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 font-medium text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
              >
                <CloudCheck className="h-3.5 w-3.5 shrink-0" />
                <span>{t('colabNb.driveMountedShort')}</span>
              </button>
            ) : (
              <button
                type="button"
                data-colab-mount-drive
                disabled={isMountBusy}
                title={t('colabNb.mountDriveTooltip')}
                onClick={() => void mountDrive(sessionId)}
                className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 font-medium text-accent hover:bg-accent-tint/10 disabled:opacity-50"
              >
                {isMountBusy ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                ) : (
                  <HardDrive className="h-3.5 w-3.5 shrink-0" />
                )}
                <span>
                  {driveState?.status === 'mounting'
                    ? t('colabNb.mountingDriveShort')
                    : driveState?.status === 'unmounting'
                      ? t('colabNb.unmountingDriveShort')
                      : t('colabNb.mountDriveShort')}
                </span>
              </button>
            )
          ) : null}

          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
            title={t('colabNb.upload')}
            disabled={transfer?.busy}
            onClick={() => void upload(sessionId)}
          >
            <Upload className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t('colabNb.uploadShort')}</span>
          </button>

          <button
            type="button"
            className={iconButton}
            title={t('colabNb.refresh')}
            aria-label={t('colabNb.refresh')}
            onClick={handleRefresh}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      {!usingJupyter && driveState?.status === 'needs_auth' ? (
        <ColabDriveAuthCard
          sessionId={sessionId}
          accountLabel={accountLabel}
          authUrl={driveState.authUrl}
          reason={driveState.reason}
        />
      ) : null}

      {!usingJupyter && driveState?.status === 'error' ? (
        <div
          role="alert"
          data-colab-drive-error
          className="mx-3 mt-2 flex items-start justify-between gap-2 rounded-[9px] border border-red-500/30 bg-red-500/[0.06] px-2.5 py-2 text-[11.5px] text-red-600 dark:text-red-400"
        >
          <span className="flex min-w-0 items-start gap-1.5">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words">
              {formatDriveMountErrorMessage(t, driveState, accountLabel)}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => void mountDrive(sessionId)}
              className="rounded border border-red-500/30 bg-ds-card px-2 py-0.5 text-[11px] font-medium text-ds-ink hover:bg-ds-hover"
            >
              {t('colabNb.driveMountRetry')}
            </button>
            <button
              type="button"
              aria-label={t('artifactsClose')}
              onClick={() => applyDriveState({ sessionId, status: 'unmounted' })}
              className={iconButton}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      ) : null}

      {isMounted ? (
        <div
          data-colab-drive-status-bar
          className="mx-3 mt-2 flex items-center justify-between gap-2 rounded-[8px] border border-emerald-500/25 bg-emerald-500/[0.06] px-2.5 py-1.5 text-[11.5px]"
        >
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-emerald-800 dark:text-emerald-200"
            title={driveState.mountPath}
          >
            {driveState.mountPath}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              data-colab-copy-ckpt-path
              title={`${driveState.mountPath}/checkpoints`}
              onClick={async () => {
                await navigator.clipboard?.writeText(`${driveState.mountPath}/checkpoints`)
                setCopiedCkptPath(true)
                setTimeout(() => setCopiedCkptPath(false), 1400)
              }}
              className="inline-flex items-center gap-1 rounded border border-emerald-500/25 bg-ds-card/80 px-1.5 py-0.5 text-[10.5px] font-medium text-ds-ink hover:bg-ds-hover"
            >
              {copiedCkptPath ? (
                <Check className="h-3 w-3 text-emerald-500" />
              ) : (
                <Copy className="h-3 w-3 text-ds-muted" />
              )}
              <span>{copiedCkptPath ? t('colabNb.copiedShort') : t('colabNb.copyCheckpointDirShort')}</span>
            </button>
            <button
              type="button"
              title={copiedMountPath ? t('colabNb.copiedShort') : t('colabNb.copyPathShort')}
              aria-label={t('colabNb.copyPathShort')}
              onClick={async () => {
                await navigator.clipboard?.writeText(driveState.mountPath)
                setCopiedMountPath(true)
                setTimeout(() => setCopiedMountPath(false), 1400)
              }}
              className={iconButton}
            >
              {copiedMountPath ? (
                <Check className="h-3 w-3 text-emerald-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
            <button
              type="button"
              data-colab-unmount-drive
              disabled={isMountBusy}
              title={t('colabNb.unmountDriveTooltip')}
              onClick={() => void handleUnmount()}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45"
            >
              <Unplug className="h-3 w-3" />
              <span>{t('colabNb.unmountDriveShort')}</span>
            </button>
          </span>
        </div>
      ) : usingJupyter ? (
        <p className="px-3.5 pt-2 text-[11.5px] leading-relaxed text-ds-muted">
          {t('colabNb.uploadJupyterHint')}
        </p>
      ) : driveState?.status !== 'needs_auth' && driveState?.status !== 'error' ? (
        <div
          data-colab-drive-unmounted-callout
          className="mx-3 mt-2 rounded-[9px] border border-ds-border/80 bg-ds-main/50 px-2.5 py-2 text-[11.5px]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-ds-ink">
              <HardDrive className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="truncate">{t('colabNb.driveCheckpointCalloutTitle')}</span>
            </span>
            <button
              type="button"
              data-colab-mount-drive-callout
              disabled={isMountBusy}
              onClick={() => void mountDrive(sessionId)}
              className="inline-flex shrink-0 items-center gap-1 rounded-[6px] bg-accent px-2 py-0.5 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {isMountBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              <span>
                {driveState?.status === 'mounting'
                  ? t('colabNb.mountingDriveShort')
                  : t('colabNb.mountDriveShort')}
              </span>
            </button>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ds-muted">
            {t('colabNb.uploadColabHint')}
          </p>
        </div>
      ) : null}

      <RuntimeUploadStatus sessionId={sessionId} />

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <RemoteTree
          sessionId={sessionId}
          path={remoteRoot}
          depth={0}
          uploadBusy={Boolean(transfer?.busy)}
          mountedDrivePath={isMounted ? driveState.mountPath : undefined}
          onUploadToDir={(dirPath) => void upload(sessionId, undefined, undefined, dirPath)}
        />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-ds-border px-2.5 py-2 text-[11.5px] text-ds-muted">
        <button
          type="button"
          disabled={transfer?.busy || !activePath}
          onClick={() => void syncActiveNotebook()}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
          title={t('colabNb.syncProject', { project: projectLabel })}
        >
          <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t('colabNb.syncProject', { project: projectLabel })}</span>
        </button>

        {isMounted && activePath ? (
          <button
            type="button"
            data-colab-save-to-drive
            disabled={transfer?.busy}
            onClick={() =>
              void syncActiveNotebook(`${driveState.mountPath}/Colab Notebooks`)
            }
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-ds-border bg-ds-main px-2 py-1 font-medium text-ds-ink hover:bg-ds-hover disabled:opacity-50"
            title={t('colabNb.saveNotebookToDriveTooltip', {
              path: `${driveState.mountPath}/Colab Notebooks`
            })}
          >
            <Cloud className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span>{t('colabNb.saveNotebookToDrive')}</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
