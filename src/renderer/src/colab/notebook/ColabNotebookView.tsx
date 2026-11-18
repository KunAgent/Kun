import { useCallback, useEffect, useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CloudDownload,
  Eraser,
  ExternalLink,
  FolderOpen,
  Loader2,
  NotebookPen,
  Play,
  Plus,
  RotateCcw,
  Save,
  Square,
  X
} from 'lucide-react'
import { SidebarTitlebarToggleButton } from '../../components/sidebar/SidebarPrimitives'
import { useChatStore } from '../../store/chat-store'
import type { ColabKunChatHost } from './ColabKunPane'
import { ColabNotebookCell } from './ColabNotebookCell'
import { ColabRightSidebar } from './ColabRightSidebar'
import { NotebookPullView } from './NotebookPullView'
import { useNotebookPullStore } from './notebook-pull-store'
import { useColabNotebookStore } from './colab-notebook-store'
import { useColabNotebookAgent } from './use-colab-notebook-agent'
import { useColabNotebookRuntime } from './use-colab-notebook-runtime'

const barButton =
  'inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[12.5px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40 disabled:hover:bg-transparent'

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
  const pullTask = useNotebookPullStore((s) => s.task)
  const pullVisible = useNotebookPullStore((s) => s.visible)
  const kunChangedCellIds = useColabNotebookStore((s) => s.kunChangedCellIds)
  const kunBusy = useColabNotebookStore((s) => s.kunBusy)
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
  const configureExecution = (): void => {
    if (leftSidebarCollapsed) onToggleLeftSidebar()
    useColabNotebookStore.getState().focusConnections()
  }

  useEffect(() => {
    useNotebookPullStore.getState().workspaceChanged(runtime.wsKey)
    void refreshNotebooks(runtime.wsKey)
  }, [refreshNotebooks, runtime.wsKey])
  useColabNotebookAgent(runtime)

  const sessionId = runtime.activeSessionId
  const busy = Boolean(runningCellId) || queue.length > 0
  const queuedSet = useMemo(() => new Set(queue), [queue])
  const kunChangedSet = useMemo(() => new Set(kunChangedCellIds), [kunChangedCellIds])
  const usingJupyter = Boolean(sessionId && runtime.jupyterSession && sessionId === runtime.jupyterSession.id)

  const runCell = useCallback(
    (id: string, advance: boolean) => {
      const { cells: current } = useColabNotebookStore.getState()
      const index = current.findIndex((c) => c.id === id)
      const target = current[index]
      if (!target) return
      if (target.kind === 'markdown') {
        if (!advance) {
          selectCell(null)
          return
        }
        const next = current[index + 1]
        if (next) selectCell(next.id)
        else selectCell(null)
        return
      }
      if (!sessionId || kunBusy) return
      runCells(sessionId, [id])
      if (!advance) return
      const next = current[index + 1]
      if (next) selectCell(next.id)
      else addCell('code', id)
    },
    [addCell, kunBusy, runCells, selectCell, sessionId]
  )

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

  const status = sessionId && runtime.activeRuntimeLabel
    ? {
        tone: 'bg-emerald-500/10 text-emerald-600',
        dot: busy ? 'bg-amber-500' : 'bg-emerald-500',
        label: usingJupyter
          ? t(busy ? 'colabNb.jupyterKernelBusy' : 'colabNb.jupyterKernelIdle', { label: runtime.activeRuntimeLabel })
          : t(busy ? 'colabNb.kernelBusy' : 'colabNb.kernelIdle', { gpu: runtime.activeRuntimeLabel })
      }
    : runtime.pending || runtime.jupyterConnecting
      ? { tone: 'bg-amber-500/10 text-amber-600', dot: 'bg-amber-500 animate-pulse', label: t('colabNb.kernelConnecting') }
      : { tone: 'bg-ds-hover text-ds-muted', dot: 'bg-ds-faint', label: t('colabNb.kernelOffline') }

  return (
    <div className="ds-drag flex h-full min-h-0 bg-ds-main" data-colab-notebook>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="ds-stage-inset shrink-0">
          <header className="ds-topbar-surface relative z-10 mt-3 flex min-h-[46px] w-full items-center justify-between gap-3 rounded-[24px] px-3">
            <div className={`flex min-w-0 items-center gap-2 ${leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''}`}>
              <SidebarTitlebarToggleButton
                onClick={onToggleLeftSidebar}
                title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              />
              <span className="text-[13.5px] text-ds-muted">{t('colabNb.navLabel')}</span>
              {activePath ? (
                <>
                  <span className="text-ds-faint">›</span>
                  <h1 className="min-w-0 truncate text-[14px] font-semibold text-ds-ink" title={activePath}>{activePath}</h1>
                  <span className="shrink-0 text-[11.5px] text-ds-faint">
                    {saving ? t('colabNb.saving') : dirty ? t('colabNb.unsaved') : t('colabNb.saved')}
                  </span>
                </>
              ) : null}
            </div>
            <div className="ds-no-drag flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={configureExecution}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold transition hover:opacity-85 ${status.tone}`}
              >
                <span className={`h-[7px] w-[7px] rounded-full ${status.dot}`} />
                {status.label}
              </button>
              <button
                type="button"
                className={barButton}
                disabled={usingJupyter ? !runtime.jupyterSession : (!runtime.session || !runtime.connection)}
                onClick={runtime.openExternalNotebookUi}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {usingJupyter ? t('colabNb.jupyterOpenLab') : t('colabNb.openInColab')}
              </button>
              <button
                type="button"
                onClick={closeColabPage}
                aria-label={t('artifactsClose')}
                title={t('artifactsClose')}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </header>
        </div>

        {pullTask ? (
          <nav className="ds-no-drag flex shrink-0 flex-wrap items-center gap-1 border-b border-ds-border px-4 py-2" aria-label={t('colabNb.navLabel')}>
            <button type="button" className={`${barButton} ${!pullVisible ? 'bg-ds-hover font-semibold text-ds-ink' : ''}`}
              aria-current={!pullVisible ? 'page' : undefined} onClick={() => useNotebookPullStore.getState().hide()}>
              <NotebookPen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('colabNb.pullEditorTab')}
            </button>
            <button type="button" className={`${barButton} ${pullVisible ? 'bg-accent/10 font-semibold text-accent' : ''}`}
              aria-current={pullVisible ? 'page' : undefined} onClick={() => useNotebookPullStore.getState().show()}>
              <CloudDownload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t(pullTask.source.kind === 'drive' ? 'colabNb.pullFromDrive' : 'colabNb.jupyterBrowseNotebooks')}
            </button>
          </nav>
        ) : null}
        {pullTask && pullVisible ? <NotebookPullView task={pullTask} workspaceRoot={runtime.wsKey}
          onConfigureExecution={configureExecution} /> : null}

        <div data-colab-notebook-editor hidden={Boolean(pullTask && pullVisible)}
          className={pullTask && pullVisible ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
          {activePath && !loadError ? (
            <div className="ds-no-drag mx-auto mt-2 flex w-full max-w-[1016px] flex-wrap items-center gap-1 border-b border-ds-border/70 px-7 pb-2">
              <button type="button" className={barButton} disabled={kunBusy} onClick={() => addCell('code')}>
                <Plus className="h-3.5 w-3.5" />
                {t('colabNb.addCode')}
              </button>
              <button type="button" className={barButton} disabled={kunBusy} onClick={() => addCell('markdown')}>
                <Plus className="h-3.5 w-3.5" />
                {t('colabNb.addText')}
              </button>
              <span className="mx-1 h-4 w-px bg-ds-border" />
              <button
                type="button"
                disabled={!sessionId || busy || kunBusy}
                onClick={() => sessionId && runCells(sessionId, cells.filter((c) => c.kind === 'code').map((c) => c.id))}
                className="inline-flex h-7 items-center gap-1.5 rounded-[7px] bg-ds-ink px-2.5 text-[12.5px] font-medium text-ds-main hover:opacity-90 disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                {t('colabNb.runAll')}
              </button>
              <button type="button" className={barButton} disabled={!busy} title={t('colabNb.interruptHint')} onClick={() => void interrupt()}>
                <Square className="h-3 w-3 fill-current" />
                {t('colabNb.interrupt')}
              </button>
              <button type="button" className={barButton} disabled={!sessionId} onClick={() => sessionId && void restartKernel(sessionId)}>
                <RotateCcw className="h-3.5 w-3.5" />
                {t('colabNb.restart')}
              </button>
              <button type="button" className={barButton} disabled={kunBusy} onClick={clearOutputs}>
                <Eraser className="h-3.5 w-3.5" />
                {t('colabNb.clearOutputs')}
              </button>
              <span className="flex-1" />
              {dirty ? (
                <button type="button" className={barButton} disabled={saving} onClick={() => void saveNotebook()}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {t('colabNb.save')}
                </button>
              ) : null}
            </div>
          ) : null}

          <div
            className="ds-no-drag min-h-0 flex-1 overflow-y-auto pb-16 pt-4"
            onMouseDown={() => selectedCellId && selectCell(null)}
          >
            {!activePath ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <NotebookPen className="h-8 w-8 text-amber-500/80" strokeWidth={1.6} />
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
                      onClick={configureExecution}
                      className="inline-flex items-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-card px-3 py-1.5 text-[12.5px] font-medium text-ds-ink hover:bg-ds-hover"
                    >
                      <CloudDownload className="h-3.5 w-3.5 text-accent" />
                      {t('colabNb.accountsAndConnections')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void importLocalNotebooks(runtime.wsKey)}
                      className="inline-flex items-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-card px-3 py-1.5 text-[12.5px] font-medium text-ds-ink hover:bg-ds-hover"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      {t('colabNb.importLocalBtn')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void chooseWorkspace({ createThreadAfter: false, selectThreadAfter: false })}
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-card px-3.5 py-1.5 text-[12.5px] font-medium text-ds-ink hover:bg-ds-hover"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    {t('colabNb.chooseProject')}
                  </button>
                )}
              </div>
            ) : loadError ? (
              <div className="mx-auto max-w-[720px] px-7 py-10 text-[13px] text-red-500">{t('colabNb.loadFailed', { message: loadError })}</div>
            ) : (
              <div className="flex flex-col gap-3">
                {kunBusy ? (
                  <div
                    className="mx-auto flex w-full max-w-[904px] items-center gap-2 rounded-[10px] border border-accent/30 bg-accent/[0.06] px-4 py-2 text-[12.5px] text-accent"
                    style={{ width: 'calc(100% - 112px)' }}
                    data-colab-kun-lock
                  >
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    <span className="min-w-0 flex-1">{t('colabNb.kunEditingLock')}</span>
                  </div>
                ) : null}
                {!sessionId ? (
                  <div
                    className="mx-auto flex w-full max-w-[904px] items-center gap-3 rounded-[10px] border border-dashed border-ds-border px-4 py-2.5 text-[12.5px] text-ds-muted"
                    style={{ width: 'calc(100% - 112px)' }}
                  >
                    <span className="min-w-0 flex-1">{t('colabNb.needRuntime')}</span>
                    <button
                      type="button"
                      onClick={configureExecution}
                      className="shrink-0 rounded-[7px] border border-ds-border bg-ds-card px-2.5 py-1 text-[12px] font-medium text-ds-ink hover:bg-ds-hover"
                    >
                      {t('colabNb.openRuntimeTab')}
                    </button>
                  </div>
                ) : null}
                {cells.map((cell, index) => (
                  <ColabNotebookCell
                    key={cell.id}
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
                ))}
                <div className="flex justify-center gap-2 pt-1" onMouseDown={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    disabled={kunBusy}
                    onClick={() => addCell('code', cells[cells.length - 1]?.id ?? null)}
                    className="inline-flex items-center gap-1 rounded-full border border-ds-border px-3 py-0.5 text-[12px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
                  >
                    <Plus className="h-3 w-3" />
                    {t('colabNb.addCode')}
                  </button>
                  <button
                    type="button"
                    disabled={kunBusy}
                    onClick={() => addCell('markdown', cells[cells.length - 1]?.id ?? null)}
                    className="inline-flex items-center gap-1 rounded-full border border-ds-border px-3 py-0.5 text-[12px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
                  >
                    <Plus className="h-3 w-3" />
                    {t('colabNb.addText')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ColabRightSidebar runtime={runtime} chat={chat} />
    </div>
  )
}
