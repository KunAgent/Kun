import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Eraser,
  ExternalLink,
  FolderOpen,
  Loader2,
  NotebookPen,
  Play,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Square,
  X
} from 'lucide-react'
import type { ColabNotebookOutput } from '@shared/colab/colab-notebook-types'
import { SidebarTitlebarToggleButton } from '../../components/sidebar/SidebarPrimitives'
import { useChatStore } from '../../store/chat-store'
import { ColabNotebookCell } from './ColabNotebookCell'
import { useColabNotebookStore } from './colab-notebook-store'
import { useColabNotebookRuntime } from './use-colab-notebook-runtime'

const barButton =
  'inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[12.5px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40 disabled:hover:bg-transparent'

export function closeColabPage(): void {
  const { route, setRoute } = useChatStore.getState()
  if (route === 'colab') setRoute('chat')
}

function summarizeOutputs(outputs: ColabNotebookOutput[]): string {
  return outputs
    .map((o) => {
      if (o.type === 'stream') return o.text
      if (o.type === 'error') return o.traceback || `${o.ename}: ${o.evalue}`
      return '[image/png]'
    })
    .join('\n')
    .slice(0, 2000)
}

export function ColabNotebookView({
  leftSidebarCollapsed,
  onToggleLeftSidebar
}: {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
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
  const addCell = useColabNotebookStore((s) => s.addCell)
  const applyAssistCell = useColabNotebookStore((s) => s.applyAssistCell)
  const createNotebook = useColabNotebookStore((s) => s.createNotebook)
  const runCells = useColabNotebookStore((s) => s.runCells)
  const interrupt = useColabNotebookStore((s) => s.interrupt)
  const restartKernel = useColabNotebookStore((s) => s.restartKernel)
  const clearOutputs = useColabNotebookStore((s) => s.clearOutputs)
  const saveNotebook = useColabNotebookStore((s) => s.saveNotebook)
  const selectCell = useColabNotebookStore((s) => s.selectCell)
  const refreshNotebooks = useColabNotebookStore((s) => s.refreshNotebooks)

  const [assistOpen, setAssistOpen] = useState(false)
  const [assistPrompt, setAssistPrompt] = useState('')
  const [assistBusy, setAssistBusy] = useState(false)
  const [assistError, setAssistError] = useState<string | null>(null)
  const [replaceSelected, setReplaceSelected] = useState(false)
  const assistInputRef = useRef<HTMLInputElement>(null)
  const assistBarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void refreshNotebooks(runtime.wsKey)
  }, [refreshNotebooks, runtime.wsKey])

  const session = runtime.session
  const sessionId = session?.id ?? null
  const busy = Boolean(runningCellId) || queue.length > 0
  const queuedSet = new Set(queue)
  const isMac = typeof window !== 'undefined' && window.kunGui?.platform === 'darwin'

  const openAssist = useCallback((preferReplace: boolean) => {
    setAssistError(null)
    setReplaceSelected(preferReplace)
    setAssistOpen(true)
    requestAnimationFrame(() => {
      assistBarRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      assistInputRef.current?.focus()
    })
  }, [])

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
      if (!sessionId) return
      runCells(sessionId, [id])
      if (!advance) return
      const next = current[index + 1]
      if (next) selectCell(next.id)
      else addCell('code', id)
    },
    [addCell, runCells, selectCell, sessionId]
  )

  const submitAssist = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const prompt = assistPrompt.trim()
    if (!prompt || assistBusy || !window.kunGui?.colabNotebookAssist) return
    setAssistBusy(true)
    setAssistError(null)
    try {
      const useReplace = replaceSelected && Boolean(selectedCellId)
      const res = await window.kunGui.colabNotebookAssist({
        prompt,
        mode: useReplace ? 'replace' : 'insert',
        cells: cells.map((cell) => ({
          kind: cell.kind,
          source: cell.source,
          output: summarizeOutputs(cell.outputs),
          selected: cell.id === selectedCellId
        }))
      })
      if (!res.ok) {
        setAssistError(res.message)
        return
      }
      applyAssistCell({ kind: res.kind, source: res.source, replaceSelected: useReplace })
      setAssistPrompt('')
      setAssistOpen(false)
    } finally {
      setAssistBusy(false)
    }
  }

  // Debounced autosave keeps the .ipynb on disk in step with edits and outputs.
  useEffect(() => {
    if (!dirty || busy) return
    const timer = setTimeout(() => void saveNotebook(), 1500)
    return () => clearTimeout(timer)
  }, [busy, cells, dirty, saveNotebook])

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        void saveNotebook()
      } else if (key === 'k' && activePath && !loadError) {
        event.preventDefault()
        openAssist(Boolean(selectedCellId))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activePath, loadError, openAssist, saveNotebook, selectedCellId])

  const status = session
    ? {
        tone: 'bg-emerald-500/10 text-emerald-600',
        dot: busy ? 'bg-amber-500' : 'bg-emerald-500',
        label: t(busy ? 'colabNb.kernelBusy' : 'colabNb.kernelIdle', { gpu: session.accelerator })
      }
    : runtime.pending
      ? { tone: 'bg-amber-500/10 text-amber-600', dot: 'bg-amber-500 animate-pulse', label: t('colabNb.kernelConnecting') }
      : { tone: 'bg-ds-hover text-ds-muted', dot: 'bg-ds-faint', label: t('colabNb.kernelOffline') }

  return (
    <div className="ds-drag flex h-full min-h-0 flex-col bg-ds-main" data-colab-notebook>
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
                <h1 className="truncate text-[14px] font-semibold text-ds-ink">{activePath}</h1>
                <span className="shrink-0 text-[11.5px] text-ds-faint">
                  {saving ? t('colabNb.saving') : dirty ? t('colabNb.unsaved') : t('colabNb.saved')}
                </span>
              </>
            ) : null}
          </div>
          <div className="ds-no-drag flex shrink-0 items-center gap-1">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${status.tone}`}>
              <span className={`h-[7px] w-[7px] rounded-full ${status.dot}`} />
              {status.label}
            </span>
            <button type="button" className={barButton} disabled={!session || !runtime.connection}
              onClick={() => runtime.connection && void window.kunGui.colabOpenBrowser({ connectionId: runtime.connection.id, sessionId: session?.id })}>
              <ExternalLink className="h-3.5 w-3.5" />{t('colabNb.openInColab')}
            </button>
            <button type="button" onClick={closeColabPage} aria-label={t('artifactsClose')} title={t('artifactsClose')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </header>
      </div>

      {activePath && !loadError ? (
        <div className="ds-no-drag mx-auto mt-2 flex w-full max-w-[1016px] flex-wrap items-center gap-1 border-b border-ds-border/70 px-7 pb-2">
          <button type="button" className={barButton} onClick={() => addCell('code')}><Plus className="h-3.5 w-3.5" />{t('colabNb.addCode')}</button>
          <button type="button" className={barButton} onClick={() => addCell('markdown')}><Plus className="h-3.5 w-3.5" />{t('colabNb.addText')}</button>
          <span className="mx-1 h-4 w-px bg-ds-border" />
          <button type="button" disabled={!sessionId || busy}
            onClick={() => sessionId && runCells(sessionId, cells.filter((c) => c.kind === 'code').map((c) => c.id))}
            className="inline-flex h-7 items-center gap-1.5 rounded-[7px] bg-ds-ink px-2.5 text-[12.5px] font-medium text-ds-main hover:opacity-90 disabled:opacity-40">
            <Play className="h-3.5 w-3.5 fill-current" />{t('colabNb.runAll')}
          </button>
          <button type="button" className={barButton} disabled={!busy} title={t('colabNb.interruptHint')} onClick={() => void interrupt()}>
            <Square className="h-3 w-3 fill-current" />{t('colabNb.interrupt')}
          </button>
          <button type="button" className={barButton} disabled={!sessionId} onClick={() => sessionId && void restartKernel(sessionId)}>
            <RotateCcw className="h-3.5 w-3.5" />{t('colabNb.restart')}
          </button>
          <button type="button" className={barButton} onClick={clearOutputs}><Eraser className="h-3.5 w-3.5" />{t('colabNb.clearOutputs')}</button>
          <span className="flex-1" />
          {dirty ? (
            <button type="button" className={barButton} disabled={saving} onClick={() => void saveNotebook()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}{t('colabNb.save')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => openAssist(Boolean(selectedCellId))}
            className="inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[12.5px] font-medium text-accent hover:bg-accent/10"
          >
            <Sparkles className="h-3.5 w-3.5" />{t('colabNb.askKunBtn')}
          </button>
        </div>
      ) : null}

      <div
        className="ds-no-drag min-h-0 flex-1 overflow-y-auto pb-16 pt-4"
        onMouseDown={() => selectedCellId && selectCell(null)}
      >
        {!activePath ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <NotebookPen className="h-8 w-8 text-amber-500/80" strokeWidth={1.6} />
            <p className="max-w-[360px] text-[13px] text-ds-muted">
              {runtime.wsKey ? t('colabNb.pickNotebook') : t('colabNb.noWorkspace')}
            </p>
            {runtime.wsKey ? (
              <button
                type="button"
                onClick={() => void createNotebook(runtime.wsKey)}
                className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" />{t('colabNb.newNotebook')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void chooseWorkspace({ createThreadAfter: false, selectThreadAfter: false })}
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-card px-3.5 py-1.5 text-[12.5px] font-medium text-ds-ink hover:bg-ds-hover"
              >
                <FolderOpen className="h-3.5 w-3.5" />{t('colabNb.chooseProject')}
              </button>
            )}
          </div>
        ) : loadError ? (
          <div className="mx-auto max-w-[720px] px-7 py-10 text-[13px] text-red-500">{t('colabNb.loadFailed', { message: loadError })}</div>
        ) : (
          <div className="flex flex-col gap-3">
            {!session ? (
              <div
                className="mx-auto w-full max-w-[904px] rounded-[10px] border border-dashed border-ds-border px-4 py-2.5 text-[12.5px] text-ds-muted"
                style={{ width: 'calc(100% - 112px)' }}
              >
                {t('colabNb.needRuntime')}
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
                canRun={Boolean(sessionId)}
                onRun={runCell}
              />
            ))}
            <div className="flex justify-center gap-2 pt-1" onMouseDown={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => addCell('code', cells[cells.length - 1]?.id ?? null)}
                className="inline-flex items-center gap-1 rounded-full border border-ds-border px-3 py-0.5 text-[12px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
                <Plus className="h-3 w-3" />{t('colabNb.addCode')}
              </button>
              <button type="button" onClick={() => addCell('markdown', cells[cells.length - 1]?.id ?? null)}
                className="inline-flex items-center gap-1 rounded-full border border-ds-border px-3 py-0.5 text-[12px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
                <Plus className="h-3 w-3" />{t('colabNb.addText')}
              </button>
            </div>

            <div
              ref={assistBarRef}
              onMouseDown={(e) => e.stopPropagation()}
              className="mx-auto mt-2 w-full max-w-[904px]"
              style={{ width: 'calc(100% - 112px)' }}
            >
              {assistOpen ? (
                <form
                  onSubmit={(e) => void submitAssist(e)}
                  className="flex flex-col gap-1.5 rounded-[10px] border border-accent/40 bg-accent/[0.04] px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-semibold text-accent">
                      <Sparkles className="h-3.5 w-3.5" />Kun
                    </span>
                    <input
                      ref={assistInputRef}
                      type="text"
                      value={assistPrompt}
                      disabled={assistBusy}
                      onChange={(e) => setAssistPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          setAssistOpen(false)
                        }
                      }}
                      placeholder={
                        replaceSelected && selectedCellId
                          ? t('colabNb.askKunReplacePlaceholder')
                          : t('colabNb.askKunPlaceholder')
                      }
                      className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ds-ink outline-none placeholder:text-ds-faint"
                    />
                    {selectedCellId ? (
                      <button
                        type="button"
                        onClick={() => setReplaceSelected((v) => !v)}
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] transition ${
                          replaceSelected
                            ? 'border-accent bg-accent/15 text-accent'
                            : 'border-ds-border text-ds-muted hover:text-ds-ink'
                        }`}
                      >
                        {replaceSelected ? `#${cells.findIndex((c) => c.id === selectedCellId) + 1}` : `+ ${t('colabNb.addCode')}`}
                      </button>
                    ) : null}
                    <button
                      type="submit"
                      disabled={assistBusy || !assistPrompt.trim()}
                      className="inline-flex shrink-0 items-center gap-1 rounded-[7px] bg-accent px-2.5 py-1 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {assistBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      {assistBusy ? t('colabNb.askKunGenerating') : t('colabNb.askKunSend')}
                    </button>
                  </div>
                  {assistError ? <p className="text-[11.5px] text-red-500">{assistError}</p> : null}
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => openAssist(false)}
                  className="flex w-full items-center gap-2 rounded-[10px] border border-dashed border-accent/35 bg-accent/[0.03] px-3 py-2 text-left text-[12.5px] text-ds-muted transition hover:border-accent/60 hover:bg-accent/[0.06]"
                >
                  <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-accent">
                    <Sparkles className="h-3.5 w-3.5" />Kun
                  </span>
                  <span className="min-w-0 flex-1 truncate">{t('colabNb.askKunPlaceholder')}</span>
                  <kbd className="shrink-0 font-sans text-[11.5px] text-ds-faint">{isMac ? '⌘K' : 'Ctrl+K'}</kbd>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
