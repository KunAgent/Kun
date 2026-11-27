import { Fragment, useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  AlertTriangle,
  Cpu,
  FolderOpen,
  Loader2,
  NotebookPen,
  Plug,
  Plus,
  Sparkles,
  X
} from 'lucide-react'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { useChatStore } from '../../store/chat-store'
import { useColabStore } from '../colab-store'
import { ColabDriveAuthCard, formatDriveMountErrorMessage } from './ColabFilesTab'
import type { ColabKunChatHost } from './ColabKunPane'
import { ColabNotebookCell } from './ColabNotebookCell'
import { ColabRightSidebar } from './ColabRightSidebar'
import { NotebookCommandBar } from './NotebookCommandBar'
import { NotebookPullView } from './NotebookPullView'
import { NotebookStatusBar } from './NotebookStatusBar'
import { NotebookTopbar } from './NotebookTopbar'
import { useColabDriveStore } from './colab-drive-store'
import { useColabNotebookStore } from './colab-notebook-store'
import { useNotebookPullStore } from './notebook-pull-store'
import { useColabNotebookAgent } from './use-colab-notebook-agent'
import { useColabNotebookRuntime } from './use-colab-notebook-runtime'

export function closeColabPage(): void {
  const { route, setRoute } = useChatStore.getState()
  if (route === 'colab') setRoute('chat')
}

export function ColabNotebookView({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  chat
}: {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  chat?: ColabKunChatHost
}): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const chooseWorkspace = useChatStore((s) => s.chooseWorkspace)
  const runtime = useColabNotebookRuntime(workspaceRoot)

  const cells = useColabNotebookStore((s) => s.cells)
  const activePath = useColabNotebookStore((s) => s.activePath)
  const loadError = useColabNotebookStore((s) => s.loadError)
  const selectedCellId = useColabNotebookStore((s) => s.selectedCellId)
  const runningCellId = useColabNotebookStore((s) => s.runningCellId)
  const queue = useColabNotebookStore((s) => s.queue)
  const dirty = useColabNotebookStore((s) => s.dirty)
  const saving = useColabNotebookStore((s) => s.saving)
  const kunChangedCellIds = useColabNotebookStore((s) => s.kunChangedCellIds)
  const kunBusy = useColabNotebookStore((s) => s.kunBusy)
  const sidePanelOpen = useColabNotebookStore((s) => s.sidePanelOpen)
  const sidePanelTab = useColabNotebookStore((s) => s.sidePanelTab)
  const connections = useColabStore((s) => s.snapshot.connections)
  const driveState = useColabDriveStore((s) =>
    runtime.activeSessionId ? s.states[runtime.activeSessionId] : undefined
  )
  const mountDrive = useColabDriveStore((s) => s.mount)
  const applyDriveState = useColabDriveStore((s) => s.applyState)

  const pullTask = useNotebookPullStore((s) => s.task)
  const pullVisible = useNotebookPullStore((s) => s.visible)

  const addCell = useColabNotebookStore((s) => s.addCell)
  const createNotebook = useColabNotebookStore((s) => s.createNotebook)
  const importLocalNotebooks = useColabNotebookStore((s) => s.importLocalNotebooks)
  const runCells = useColabNotebookStore((s) => s.runCells)
  const interrupt = useColabNotebookStore((s) => s.interrupt)
  const restartKernel = useColabNotebookStore((s) => s.restartKernel)
  const clearOutputs = useColabNotebookStore((s) => s.clearOutputs)
  const saveNotebook = useColabNotebookStore((s) => s.saveNotebook)
  const selectCell = useColabNotebookStore((s) => s.selectCell)
  const refreshNotebooks = useColabNotebookStore((s) => s.refreshNotebooks)
  const setSidePanelOpen = useColabNotebookStore((s) => s.setSidePanelOpen)
  const setSidePanelTab = useColabNotebookStore((s) => s.setSidePanelTab)
  const setKernelPickerOpen = useColabNotebookStore((s) => s.setKernelPickerOpen)
  const askKunAboutCell = useColabNotebookStore((s) => s.askKunAboutCell)

  const [offlineBannerDismissed, setOfflineBannerDismissed] = useState(false)

  const configureExecution = useCallback((): void => {
    setKernelPickerOpen(true)
  }, [setKernelPickerOpen])

  useEffect(() => {
    useNotebookPullStore.getState().workspaceChanged(runtime.wsKey)
    void refreshNotebooks(runtime.wsKey)
  }, [refreshNotebooks, runtime.wsKey])
  useColabNotebookAgent(runtime)

  const sessionId = runtime.activeSessionId
  const connecting = Boolean(runtime.pending || runtime.connecting || runtime.jupyterConnecting)
  const busy = Boolean(runningCellId) || queue.length > 0
  const queuedSet = useMemo(() => new Set(queue), [queue])
  const kunChangedSet = useMemo(() => new Set(kunChangedCellIds), [kunChangedCellIds])
  const usingJupyter = Boolean(
    sessionId && runtime.jupyterSession && sessionId === runtime.jupyterSession.id
  )

  const codeCellIds = useMemo(
    () => cells.filter((cell) => cell.kind === 'code').map((cell) => cell.id),
    [cells]
  )
  const runningCellNumber = useMemo(() => {
    if (!runningCellId) return null
    const idx = cells.findIndex((cell) => cell.id === runningCellId)
    return idx >= 0 ? idx + 1 : null
  }, [cells, runningCellId])

  const projectLabel = runtime.wsKey ? workspaceLabelFromPath(runtime.wsKey) : ''
  const docStem = useMemo(() => {
    if (!activePath) return ''
    const base = activePath.split('/').pop() || activePath
    return base.replace(/\.ipynb$/i, '')
  }, [activePath])
  const firstCellHasHeading = Boolean(
    cells[0]?.kind === 'markdown' && /^\s*#\s+\S/.test(cells[0].source)
  )
  const docLocation = projectLabel && activePath ? `${projectLabel}/${activePath}` : activePath

  const runCell = useCallback(
    (id: string, advance: boolean) => {
      const { cells: current } = useColabNotebookStore.getState()
      const index = current.findIndex((c) => c.id === id)
      const cell = current[index]
      if (!cell) return
      if (cell.kind === 'markdown') {
        const next = current[index + 1]
        if (next) selectCell(next.id)
        else selectCell(null)
        return
      }
      if (kunBusy) return
      if (!sessionId) {
        setKernelPickerOpen(true)
        return
      }
      runCells(sessionId, [id])
      if (!advance) return
      const next = current[index + 1]
      if (next) selectCell(next.id)
      else addCell('code', id)
    },
    [addCell, kunBusy, runCells, selectCell, sessionId, setKernelPickerOpen]
  )

  const handleRunAll = useCallback(() => {
    if (kunBusy || codeCellIds.length === 0) return
    if (!sessionId) {
      setKernelPickerOpen(true)
      return
    }
    runCells(sessionId, codeCellIds)
  }, [codeCellIds, kunBusy, runCells, sessionId, setKernelPickerOpen])

  // Debounced autosave keeps the .ipynb on disk in step with edits and outputs.
  // Paused while Kun edits the file so a stale local copy never overwrites its writes.
  useEffect(() => {
    if (!dirty || busy || kunBusy) return
    const timer = setTimeout(() => void saveNotebook(), 1500)
    return () => clearTimeout(timer)
  }, [busy, cells, dirty, kunBusy, saveNotebook])

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        void saveNotebook()
      } else if (key === 'j') {
        event.preventDefault()
        setSidePanelOpen(!useColabNotebookStore.getState().sidePanelOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveNotebook, setSidePanelOpen])

  const openKunForNewCell = (): void => {
    setSidePanelTab('kun')
  }

  const driveAccountLabel =
    connections.find((c) => c.id === runtime.session?.connectionId)?.email ??
    runtime.session?.connectionEmail ??
    runtime.connection?.email
  const showInlineDriveNotice = Boolean(
    !usingJupyter && sessionId && !(sidePanelOpen && sidePanelTab === 'files')
  )
  const inlineDriveNotice =
    showInlineDriveNotice && sessionId && driveState?.status === 'needs_auth' ? (
      <div data-colab-drive-auth-banner>
        <ColabDriveAuthCard
          sessionId={sessionId}
          accountLabel={driveAccountLabel}
          authUrl={driveState.authUrl}
          reason={driveState.reason}
          compact
        />
      </div>
    ) : showInlineDriveNotice && sessionId && driveState?.status === 'error' ? (
      <div
        role="alert"
        data-colab-drive-error-banner
        onMouseDown={(e) => e.stopPropagation()}
        className="flex items-start justify-between gap-2 rounded-[10px] border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-left text-[12px] text-red-600 dark:text-red-400"
      >
        <span className="flex min-w-0 items-start gap-1.5">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words leading-relaxed">
            {formatDriveMountErrorMessage(t, driveState, driveAccountLabel)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void mountDrive(sessionId)}
            className="rounded border border-red-500/30 bg-ds-card px-2 py-0.5 text-[11.5px] font-medium text-ds-ink hover:bg-ds-hover"
          >
            {t('colabNb.driveMountRetry')}
          </button>
          <button
            type="button"
            aria-label={t('artifactsClose')}
            onClick={() => applyDriveState({ sessionId, status: 'unmounted' })}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    ) : null

  return (
    <div className="ds-drag relative flex h-full min-h-0 flex-col bg-ds-main" data-colab-notebook>
      <NotebookTopbar
        leftSidebarCollapsed={leftSidebarCollapsed}
        onToggleLeftSidebar={onToggleLeftSidebar}
        onClose={closeColabPage}
        runtime={runtime}
        busy={busy}
        usingJupyter={usingJupyter}
      />

      <div data-colab-notebook-editor className="ds-no-drag flex min-h-0 flex-1 overflow-hidden">
        <div
          className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-ds-surface-subtle/35 pb-16"
          onMouseDown={() => selectedCellId && selectCell(null)}
        >
          {!activePath ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <NotebookPen className="h-8 w-8 text-amber-500" strokeWidth={1.6} />
              <p className="max-w-[380px] text-[13px] text-ds-muted">
                {runtime.wsKey ? t('colabNb.pickNotebook') : t('colabNb.noWorkspace')}
              </p>
              {runtime.wsKey ? (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => void createNotebook(runtime.wsKey)}
                    className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t('colabNb.newNotebook')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void importLocalNotebooks(runtime.wsKey)}
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-card px-3 py-1.5 text-[12.5px] font-medium text-ds-ink hover:bg-ds-hover"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    {t('colabNb.importLocalBtn')}
                  </button>
                  <button
                    type="button"
                    onClick={configureExecution}
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-card px-3 py-1.5 text-[12.5px] font-medium text-ds-ink hover:bg-ds-hover"
                  >
                    <Cpu className="h-3.5 w-3.5 text-accent" />
                    {t('colabNb.connectRuntimeBtn')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    void chooseWorkspace({ createThreadAfter: false, selectThreadAfter: false })
                  }
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-card px-3.5 py-1.5 text-[12.5px] font-medium text-ds-ink hover:bg-ds-hover"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t('colabNb.chooseProject')}
                </button>
              )}
              {inlineDriveNotice ? (
                <div className="mt-2 w-full max-w-[520px] text-left">{inlineDriveNotice}</div>
              ) : null}
            </div>
          ) : loadError ? (
            <div className="mx-auto max-w-[720px] px-7 py-10 text-[13px] text-red-500">
              {t('colabNb.loadFailed', { message: loadError })}
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="mx-auto w-full max-w-[960px] px-7">
                <NotebookCommandBar
                  cellCount={cells.length}
                  hasCodeCells={codeCellIds.length > 0}
                  hasRuntime={Boolean(sessionId)}
                  busy={busy}
                  kunBusy={kunBusy}
                  dirty={dirty}
                  saving={saving}
                  runningCellNumber={runningCellNumber}
                  queueLength={queue.length}
                  onAddCode={() => addCell('code')}
                  onAddText={() => addCell('markdown')}
                  onRunAll={handleRunAll}
                  onInterrupt={() => void interrupt()}
                  onRestart={() => sessionId && void restartKernel(sessionId)}
                  onClearOutputs={clearOutputs}
                  onSave={() => void saveNotebook()}
                />

                {!sessionId && !connecting && !offlineBannerDismissed ? (
                  <div
                    role="status"
                    data-colab-offline-banner
                    onMouseDown={(event) => event.stopPropagation()}
                    className="mb-4 ml-[52px] mt-0.5 flex flex-wrap items-center gap-3 rounded-[12px] border border-accent-tint/25 bg-accent-tint/[0.05] px-3.5 py-2.5"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-accent-tint/20 bg-ds-card text-accent">
                      <Plug className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1 text-[12px] leading-relaxed text-ds-muted">
                      <div className="text-[13px] font-semibold text-ds-ink">
                        {t('colabNb.offlineBannerTitle')}
                      </div>
                      <div>{t('colabNb.offlineBannerDesc')}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        data-colab-offline-later
                        onClick={() => setOfflineBannerDismissed(true)}
                        className="inline-flex h-7 items-center rounded-[8px] px-2.5 text-[12.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      >
                        {t('colabNb.offlineBannerLater')}
                      </button>
                      <button
                        type="button"
                        data-colab-offline-connect
                        onClick={configureExecution}
                        className="inline-flex h-7 items-center rounded-[8px] bg-accent px-3 text-[12.5px] font-medium text-white transition hover:opacity-90"
                      >
                        {t('colabNb.connectRuntimeBtn')}
                      </button>
                    </div>
                  </div>
                ) : null}

                {!usingJupyter &&
                runtime.session &&
                runtime.session.guardWarnings &&
                runtime.session.guardWarnings.length > 0 ? (
                  <div
                    role="status"
                    data-colab-guard-warning
                    onMouseDown={(event) => event.stopPropagation()}
                    className="mb-3 ml-[52px] flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-amber-500/35 bg-amber-500/10 px-3.5 py-2 text-[12px] text-amber-900 dark:text-amber-200"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span className="truncate">
                        {runtime.session.guardWarnings.includes('runtime_nearing')
                          ? t('colabNb.guardWarnRuntime')
                          : runtime.session.guardWarnings.includes('spend_nearing')
                            ? t('colabNb.guardWarnSpend', { cu: runtime.session.maxSpendCu ?? 0 })
                            : runtime.session.guardWarnings.includes('balance_nearing')
                              ? t('colabNb.guardWarnBalance', {
                                  cu: runtime.session.minBalanceCu ?? 0
                                })
                              : t('colabNb.guardWarnStaleBalance')}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {runtime.session.guardWarnings.includes('runtime_nearing') ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void runtime.extendSession(30)}
                            className="rounded-md bg-accent px-2.5 py-0.5 text-[11.5px] font-semibold text-white hover:opacity-90"
                          >
                            {t('colabNb.extend30m')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void runtime.extendSession(60)}
                            className="rounded-md border border-ds-border bg-ds-card px-2 py-0.5 text-[11.5px] font-medium text-ds-ink hover:bg-ds-hover"
                          >
                            {t('colabNb.extend1h')}
                          </button>
                        </>
                      ) : runtime.session.guardWarnings.includes('balance_stale') ? (
                        <button
                          type="button"
                          onClick={() =>
                            void window.kunGui.colabRefreshBalances({
                              connectionId: runtime.session!.connectionId
                            })
                          }
                          className="rounded-md border border-ds-border bg-ds-card px-2.5 py-0.5 text-[11.5px] font-medium text-ds-ink hover:bg-ds-hover"
                        >
                          {t('colabNb.refresh')}
                        </button>
                      ) : null}
                    </span>
                  </div>
                ) : null}

                {inlineDriveNotice ? (
                  <div className="mb-3 ml-[52px]">{inlineDriveNotice}</div>
                ) : null}

                {kunBusy ? (
                  <div
                    className="mb-3 ml-[52px] flex items-center gap-2 rounded-[10px] border border-accent-tint/30 bg-accent-tint/[0.06] px-3.5 py-2 text-[12.5px] text-accent"
                    data-colab-kun-lock
                  >
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    <span className="min-w-0 flex-1">{t('colabNb.kunEditingLock')}</span>
                  </div>
                ) : null}

                <div className="mb-4 ml-[52px] mt-1">
                  {!firstCellHasHeading && docStem ? (
                    <h2 className="text-[21px] font-semibold tracking-[-0.015em] text-ds-ink">
                      {docStem}
                    </h2>
                  ) : null}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ds-faint">
                    <span>
                      {usingJupyter && runtime.jupyterSession
                        ? runtime.jupyterSession.kernelName
                        : 'Python 3'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{t('colabNb.cellsCount', { count: cells.length })}</span>
                    {docLocation ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{docLocation}</span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="flex flex-col">
                {cells.map((cell, index) => (
                  <Fragment key={cell.id}>
                    <ColabNotebookCell
                      cell={cell}
                      index={index}
                      total={cells.length}
                      selected={cell.id === selectedCellId}
                      running={cell.id === runningCellId}
                      queued={queuedSet.has(cell.id)}
                      canRun={Boolean(sessionId) && !kunBusy}
                      kunChanged={kunChangedSet.has(cell.id)}
                      onRun={runCell}
                    />
                    {index < cells.length - 1 ? (
                      <div
                        className="group/insert mx-auto flex h-5 w-full max-w-[960px] items-center px-7"
                        onMouseDown={(event) => event.stopPropagation()}
                      >
                        <div className="ml-[52px] flex flex-1 items-center gap-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover/insert:opacity-100">
                          <span className="h-px flex-1 bg-accent-tint/25" aria-hidden="true" />
                          <button
                            type="button"
                            disabled={kunBusy}
                            onClick={() => addCell('code', cell.id)}
                            className="inline-flex items-center gap-1 rounded-full border border-ds-border bg-ds-card px-2 py-[1px] text-[11px] text-ds-muted transition hover:border-ds-border-strong hover:text-ds-ink disabled:opacity-40"
                          >
                            <Plus className="h-2.5 w-2.5" aria-hidden="true" />
                            <span>{t('colabNb.addCode')}</span>
                          </button>
                          <button
                            type="button"
                            disabled={kunBusy}
                            onClick={() => addCell('markdown', cell.id)}
                            className="inline-flex items-center gap-1 rounded-full border border-ds-border bg-ds-card px-2 py-[1px] text-[11px] text-ds-muted transition hover:border-ds-border-strong hover:text-ds-ink disabled:opacity-40"
                          >
                            <Plus className="h-2.5 w-2.5" aria-hidden="true" />
                            <span>{t('colabNb.addText')}</span>
                          </button>
                          <button
                            type="button"
                            disabled={kunBusy}
                            onClick={() => askKunAboutCell(cell.id)}
                            className="inline-flex items-center gap-1 rounded-full border border-accent-tint/30 bg-ds-card px-2 py-[1px] text-[11px] text-accent transition hover:bg-accent-tint/10 disabled:opacity-40"
                          >
                            <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                            <span>{t('colabNb.askKunShortInsert')}</span>
                          </button>
                          <span className="h-px flex-1 bg-accent-tint/25" aria-hidden="true" />
                        </div>
                      </div>
                    ) : null}
                  </Fragment>
                ))}
              </div>

              <div className="mx-auto w-full max-w-[960px] px-7">
                <div
                  className="ml-[52px] mt-3.5 flex flex-wrap gap-2"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    disabled={kunBusy}
                    onClick={() => addCell('code', cells[cells.length - 1]?.id ?? null)}
                    className="inline-flex items-center gap-1.5 rounded-[9px] border border-dashed border-ds-border-strong px-3 py-1.5 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40"
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" />
                    <span>{t('colabNb.addCodeCellLong')}</span>
                  </button>
                  <button
                    type="button"
                    disabled={kunBusy}
                    onClick={() => addCell('markdown', cells[cells.length - 1]?.id ?? null)}
                    className="inline-flex items-center gap-1.5 rounded-[9px] border border-dashed border-ds-border-strong px-3 py-1.5 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40"
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" />
                    <span>{t('colabNb.addTextCellLong')}</span>
                  </button>
                  <button
                    type="button"
                    disabled={kunBusy}
                    onClick={openKunForNewCell}
                    className="inline-flex items-center gap-1.5 rounded-[9px] border border-dashed border-accent-tint/40 px-3 py-1.5 text-[12px] text-accent transition hover:bg-accent-tint/[0.08] disabled:opacity-40"
                  >
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                    <span>{t('colabNb.addCellWithKunLong')}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <ColabRightSidebar runtime={runtime} chat={chat} />
      </div>

      <NotebookStatusBar runtime={runtime} busy={busy} />

      {pullTask && pullVisible ? (
        <NotebookPullView
          task={pullTask}
          workspaceRoot={runtime.wsKey}
          onConfigureExecution={configureExecution}
        />
      ) : null}
    </div>
  )
}
