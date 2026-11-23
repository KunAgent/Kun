import { useCallback, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Cloud, Download, FileCode2, Loader2, Server } from 'lucide-react'
import { selectWorkspaceActiveConnection, useColabStore } from '../colab-store'
import { useColabDismiss } from '../use-colab-dismiss'
import { useColabNotebookStore } from './colab-notebook-store'
import { useNotebookPullStore } from './notebook-pull-store'
import type { ColabNotebookRuntime } from './use-colab-notebook-runtime'

/** Topbar unified Import menu: Local .ipynb, Google Drive, or Jupyter Server. */
export function NotebookImportMenu({ runtime }: { runtime: ColabNotebookRuntime }): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useColabDismiss(open, close, containerRef)

  const snapshot = useColabStore((s) => s.snapshot)
  const importLocalNotebooks = useColabNotebookStore((s) => s.importLocalNotebooks)
  const setKernelPickerOpen = useColabNotebookStore((s) => s.setKernelPickerOpen)
  const pullTask = useNotebookPullStore((s) => s.task)
  const pullVisible = useNotebookPullStore((s) => s.visible)

  const hasBackgroundPull = Boolean(
    pullTask && !pullVisible && pullTask.workspaceRoot === runtime.wsKey
  )
  const pullRunning = Boolean(
    pullTask && ['reading', 'importing'].includes(pullTask.phase)
  )

  const openDrivePull = (): void => {
    setOpen(false)
    const activeConn =
      selectWorkspaceActiveConnection(snapshot, runtime.wsKey) ?? snapshot.connections[0] ?? null
    useNotebookPullStore.getState().open(
      {
        kind: 'drive',
        connectionId: activeConn?.id ?? '',
        label: activeConn?.name ?? 'Google Colab'
      },
      runtime.wsKey
    )
  }

  const openJupyterPull = (serverId: string, label: string): void => {
    setOpen(false)
    useNotebookPullStore.getState().open({ kind: 'jupyter', serverId, label }, runtime.wsKey)
  }

  const servers = runtime.jupyterServers
  const preferJupyter =
    runtime.backend === 'jupyter' ||
    Boolean(runtime.jupyterSession && runtime.activeSessionId === runtime.jupyterSession.id) ||
    (servers.length > 0 && snapshot.connections.length === 0)

  const jupyterMenuSection =
    servers.length <= 1 ? (
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          if (servers[0]) {
            openJupyterPull(servers[0].id, servers[0].name)
          } else {
            setOpen(false)
            setKernelPickerOpen(true, { addJupyter: true })
          }
        }}
        className="mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-ds-ink hover:bg-ds-hover"
      >
        <Server className="h-3.5 w-3.5 shrink-0 text-ds-muted" aria-hidden="true" />
        <span className="truncate">{t('colabNb.importFromJupyterMenu')}</span>
      </button>
    ) : (
      <div className="pt-0.5">
        <div className="px-4 py-1 text-[11px] font-semibold text-ds-faint">
          {t('colabNb.importFromJupyterMenu')}
        </div>
        {servers.map((server) => (
          <button
            key={server.id}
            type="button"
            role="menuitem"
            onClick={() => openJupyterPull(server.id, server.name)}
            className="mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 pl-5 text-left text-ds-ink hover:bg-ds-hover"
          >
            <Server className="h-3.5 w-3.5 shrink-0 text-ds-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{server.name}</span>
          </button>
        ))}
      </div>
    )

  const driveMenuButton = (
    <button
      type="button"
      role="menuitem"
      onClick={openDrivePull}
      className="mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-ds-ink hover:bg-ds-hover"
    >
      <Cloud className="h-3.5 w-3.5 shrink-0 text-ds-muted" aria-hidden="true" />
      <span className="truncate">{t('colabNb.importFromDriveMenu')}</span>
    </button>
  )

  return (
    <div ref={containerRef} className="ds-no-drag relative shrink-0">
      <button
        type="button"
        data-colab-import-trigger
        disabled={!runtime.wsKey}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] font-medium transition disabled:opacity-40 ${
          open
            ? 'bg-accent-tint/10 text-accent'
            : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
        }`}
      >
        {pullRunning && hasBackgroundPull ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" aria-hidden="true" />
        ) : (
          <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        <span>{t('colabNb.importBtn')}</span>
        {hasBackgroundPull && !pullRunning ? (
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        ) : null}
        <ChevronDown
          className={`h-3 w-3 shrink-0 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          role="menu"
          data-colab-import-menu
          className="absolute right-0 top-full z-40 mt-2 w-56 rounded-[12px] border border-ds-border bg-ds-card py-1.5 text-[12.5px] shadow-xl"
        >
          {hasBackgroundPull ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  useNotebookPullStore.getState().show()
                }}
                className="mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-[8px] bg-accent-tint/[0.08] px-2.5 py-2 text-left font-medium text-accent hover:bg-accent-tint/15"
              >
                {pullRunning ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                ) : (
                  <Cloud className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                <span className="truncate">{t('colabNb.importResumePull')}</span>
              </button>
              <div className="my-1 border-t border-ds-border/70" />
            </>
          ) : null}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void importLocalNotebooks(runtime.wsKey)
            }}
            className="mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-ds-ink hover:bg-ds-hover"
          >
            <FileCode2 className="h-3.5 w-3.5 shrink-0 text-ds-muted" aria-hidden="true" />
            <span className="truncate">{t('colabNb.importLocalMenu')}</span>
          </button>

          {preferJupyter ? (
            <>
              {jupyterMenuSection}
              {driveMenuButton}
            </>
          ) : (
            <>
              {driveMenuButton}
              {jupyterMenuSection}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
