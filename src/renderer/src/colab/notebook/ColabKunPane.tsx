import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ExternalLink, FileCode2, History, Loader2, Sparkles, SquarePen } from 'lucide-react'
import type { DesignComposerContext } from '../../design/design-composer-context'
import { FloatingComposer } from '../../components/chat/FloatingComposer'
import { LazyMessageTimeline } from '../../components/chat/LazyMessageTimeline'
import type { WorkbenchChatStageProps } from '../../components/workbench/WorkbenchChatStage'
import { useWorkComposerReferenceProps } from '../../components/write/use-work-composer-references'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { useChatStore } from '../../store/chat-store'
import { useWorkComposerReferences } from '../../write/work-composer-references'
import { readColabKunThreadIds, rememberColabKunThread } from './colab-kun-threads'
import { sendColabKunTurn } from './colab-kun-turn'
import { useColabNotebookStore } from './colab-notebook-store'
import type { ColabNotebookRuntime } from './use-colab-notebook-runtime'

export type ColabKunChatHost = Pick<
  WorkbenchChatStageProps,
  | 'blocks'
  | 'liveReasoning'
  | 'liveAssistant'
  | 'activeThreadId'
  | 'busy'
  | 'runtimeConnection'
  | 'composerProps'
  | 'onRetryConnection'
  | 'onOpenSettings'
>

const CHIP_NOTEBOOK_ID = 'colab-active-notebook'
const CHIP_CELL_ID = 'colab-selected-cell'

/** Code-mode Kun session pane docked inside the Colab right sidebar. */
export function ColabKunPane({
  chat,
  runtime
}: {
  chat?: ColabKunChatHost
  runtime: ColabNotebookRuntime
}): ReactElement {
  const { t } = useTranslation('common')
  const threads = useChatStore((s) => s.threads)
  const activePath = useColabNotebookStore((s) => s.activePath)
  const cells = useColabNotebookStore((s) => s.cells)
  const dirty = useColabNotebookStore((s) => s.dirty)
  const selectedCellId = useColabNotebookStore((s) => s.selectedCellId)
  const kunCellRequest = useColabNotebookStore((s) => s.kunCellRequest)
  const kunChangedCellIds = useColabNotebookStore((s) => s.kunChangedCellIds)
  const saveNotebook = useColabNotebookStore((s) => s.saveNotebook)
  const selectCell = useColabNotebookStore((s) => s.selectCell)
  const consumeKunCellRequest = useColabNotebookStore((s) => s.consumeKunCellRequest)
  const captureKunBaseline = useColabNotebookStore((s) => s.captureKunBaseline)
  const undoKunChanges = useColabNotebookStore((s) => s.undoKunChanges)
  const dismissKunChanges = useColabNotebookStore((s) => s.dismissKunChanges)
  const reloadActiveNotebook = useColabNotebookStore((s) => s.reloadActiveNotebook)
  const refreshNotebooks = useColabNotebookStore((s) => s.refreshNotebooks)
  const setKunBusy = useColabNotebookStore((s) => s.setKunBusy)

  const [draftFresh, setDraftFresh] = useState(false)
  const [colabThreadIds, setColabThreadIds] = useState<string[]>(() => readColabKunThreadIds())
  const [notebookChipDetached, setNotebookChipDetached] = useState(false)
  const [cellChipDetached, setCellChipDetached] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyRef = useRef<HTMLDivElement>(null)

  const referenceProps = useWorkComposerReferenceProps(runtime.wsKey)

  useEffect(() => {
    setNotebookChipDetached(false)
  }, [activePath])

  useEffect(() => {
    setCellChipDetached(false)
  }, [selectedCellId])

  useEffect(() => {
    if (!kunCellRequest) return
    setCellChipDetached(false)
    consumeKunCellRequest()
  }, [consumeKunCellRequest, kunCellRequest])

  useEffect(() => {
    if (!historyOpen) return
    const onDown = (e: MouseEvent): void => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) setHistoryOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [historyOpen])

  const workspaceThreads = useMemo(() => {
    const root = normalizeWorkspaceRoot(runtime.wsKey)
    const colabSet = new Set(colabThreadIds)
    const inWorkspace = threads.filter(
      (th) => !th.archived && (!root || normalizeWorkspaceRoot(th.workspace ?? '') === root)
    )
    // Notebook conversations first, then other threads of this project.
    return [...inWorkspace.filter((th) => colabSet.has(th.id)), ...inWorkspace.filter((th) => !colabSet.has(th.id))].slice(0, 20)
  }, [colabThreadIds, runtime.wsKey, threads])

  const activeThread = useMemo(() => {
    if (draftFresh || !chat?.activeThreadId || !colabThreadIds.includes(chat.activeThreadId)) return null
    const thread = threads.find((th) => th.id === chat.activeThreadId)
    if (!thread) return null
    const root = normalizeWorkspaceRoot(runtime.wsKey)
    return !root || normalizeWorkspaceRoot(thread.workspace ?? '') === root ? thread : null
  }, [chat?.activeThreadId, colabThreadIds, draftFresh, runtime.wsKey, threads])
  const effectiveThreadId = activeThread?.id ?? null
  const showing = Boolean(effectiveThreadId && chat?.activeThreadId === effectiveThreadId)
  const busy = Boolean(showing && chat?.busy)

  useEffect(() => {
    setKunBusy(busy)
  }, [busy, setKunBusy])
  useEffect(() => () => setKunBusy(false), [setKunBusy])

  // Reload the open .ipynb while Kun edits files on disk and right after the turn settles.
  const prevBusyRef = useRef(busy)
  useEffect(() => {
    if (busy) {
      const timer = setInterval(() => void reloadActiveNotebook(), 1800)
      prevBusyRef.current = true
      return () => clearInterval(timer)
    }
    if (prevBusyRef.current) {
      prevBusyRef.current = false
      void reloadActiveNotebook()
      if (runtime.wsKey) void refreshNotebooks(runtime.wsKey)
    }
    return undefined
  }, [busy, refreshNotebooks, reloadActiveNotebook, runtime.wsKey])

  const selectedCellNumber = useMemo(() => {
    if (!selectedCellId || cellChipDetached) return null
    const idx = cells.findIndex((c) => c.id === selectedCellId)
    return idx >= 0 ? idx + 1 : null
  }, [cellChipDetached, cells, selectedCellId])

  const contextChips = useMemo<DesignComposerContext[]>(() => {
    const chips: DesignComposerContext[] = []
    if (activePath && !notebookChipDetached) {
      chips.push({
        id: CHIP_NOTEBOOK_ID,
        kind: 'design-target',
        label: activePath.split('/').pop() || activePath,
        removable: true
      })
    }
    if (selectedCellNumber != null) {
      chips.push({
        id: CHIP_CELL_ID,
        kind: 'document-quote',
        label: `[${selectedCellNumber}]`,
        removable: true
      })
    }
    return chips
  }, [activePath, notebookChipDetached, selectedCellNumber])

  const removeChip = (id: string): void => {
    if (id === CHIP_NOTEBOOK_ID) setNotebookChipDetached(true)
    else if (id === CHIP_CELL_ID) setCellChipDetached(true)
  }

  if (!chat) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-[12.5px] text-ds-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-accent" />
        {t('colabNb.kunLoading')}
      </div>
    )
  }

  const composer = chat.composerProps

  const send = async (): Promise<void> => {
    const request = composer.input.trim()
    if (!request) return
    if (dirty) await saveNotebook()
    captureKunBaseline()
    const sentRefs = referenceProps.fileReferences
    if (sentRefs.length > 0) useWorkComposerReferences.getState().consume(sentRefs)
    composer.setInput('')
    const res = await sendColabKunTurn({
      workspaceRoot: runtime.wsKey,
      threadId: effectiveThreadId,
      request,
      activePath,
      cells,
      selectedCellNumber,
      includeNotebook: Boolean(activePath && !notebookChipDetached),
      session: runtime.session,
      jupyterSession: runtime.jupyterSession,
      fileReferences: sentRefs,
      mode: composer.mode,
      onThreadReady: (threadId) => {
        setColabThreadIds(rememberColabKunThread(threadId))
        setDraftFresh(false)
      }
    })
    if (!res.sent) {
      composer.setInput(request)
      if (sentRefs.length > 0) useWorkComposerReferences.getState().restore(sentRefs)
      return
    }
    if (res.threadId) setColabThreadIds(rememberColabKunThread(res.threadId))
    setDraftFresh(false)
  }

  const openInCode = (): void => {
    const store = useChatStore.getState()
    store.setRoute('chat')
    if (effectiveThreadId) void store.selectThread(effectiveThreadId)
  }

  const locateChangedCell = (): void => {
    const firstId = kunChangedCellIds[0]
    if (!firstId) return
    selectCell(firstId)
    const el = document.querySelector(`[data-cell-id="${CSS.escape(firstId)}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const hasTimeline =
    showing &&
    (chat.blocks.length > 0 || chat.liveAssistant.trim().length > 0 || chat.liveReasoning.trim().length > 0)

  const quickPrompts = [
    t('colabNb.quickExplainCell'),
    t('colabNb.quickFixError'),
    t('colabNb.quickEvalPlot'),
    t('colabNb.quickCleanNotebook')
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-colab-kun-pane>
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-ds-border/70 px-3.5">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ds-ink">
          {activeThread?.title?.trim() || t('colabNb.kunNewSession')}
        </span>
        <div ref={historyRef} className="relative">
          <button
            type="button"
            disabled={workspaceThreads.length === 0}
            onClick={() => setHistoryOpen((v) => !v)}
            title={t('colabNb.kunHistory')}
            aria-label={t('colabNb.kunHistory')}
            className="inline-flex h-7 items-center gap-0.5 rounded-md px-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40"
          >
            <History className="h-3.5 w-3.5" />
            <ChevronDown className="h-3 w-3" />
          </button>
          {historyOpen ? (
            <div className="absolute right-0 top-8 z-30 max-h-64 w-64 overflow-y-auto rounded-[10px] border border-ds-border bg-ds-card p-1 shadow-xl">
              {workspaceThreads.map((th) => {
                const isCurrent = !draftFresh && th.id === effectiveThreadId
                return (
                  <button
                    key={th.id}
                    type="button"
                    onClick={() => {
                      setDraftFresh(false)
                      setHistoryOpen(false)
                      setColabThreadIds(rememberColabKunThread(th.id))
                      void useChatStore.getState().selectThread(th.id)
                    }}
                    className={`flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-[12px] ${
                      isCurrent ? 'bg-accent/10 font-semibold text-accent' : 'text-ds-ink hover:bg-ds-hover'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{th.title?.trim() || t('colabNb.kunNewSession')}</span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setDraftFresh(true)}
          title={t('colabNb.kunNewSession')}
          aria-label={t('colabNb.kunNewSession')}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
        >
          <SquarePen className="h-3.5 w-3.5" />
        </button>
        {effectiveThreadId ? (
          <button
            type="button"
            onClick={openInCode}
            title={t('colabNb.kunOpenInCode')}
            aria-label={t('colabNb.kunOpenInCode')}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {hasTimeline ? (
          <LazyMessageTimeline
            blocks={chat.blocks}
            liveReasoning={chat.liveReasoning}
            live={chat.liveAssistant}
            activeThreadId={chat.activeThreadId}
            runtimeConnection={chat.runtimeConnection}
            onRetryConnection={chat.onRetryConnection}
            onOpenSettings={chat.onOpenSettings}
            onSelectSuggestion={(text) => composer.setInput(text)}
            compactCards
          />
        ) : (
          <div className="flex flex-1 flex-col justify-center gap-3 overflow-y-auto px-5 py-6">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/12 text-accent">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <div className="text-[13.5px] font-semibold text-ds-ink">{t('colabNb.kunEmptyTitle')}</div>
                <div className="text-[11.5px] text-ds-muted">{t('colabNb.kunEmptySubtitle')}</div>
              </div>
            </div>
            <div className="mt-1 flex flex-col gap-1.5">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => composer.setInput(prompt)}
                  className="rounded-[9px] border border-ds-border bg-ds-main/70 px-3 py-2 text-left text-[12.5px] text-ds-ink transition hover:border-accent/40 hover:bg-ds-hover"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 px-3 pb-2.5 pt-1.5">
        {kunChangedCellIds.length > 0 && !busy ? (
          <div className="mb-2 flex items-center gap-2 rounded-[10px] border border-ds-border bg-ds-main px-2.5 py-1.5 text-[12px]">
            <FileCode2 className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate font-medium text-ds-ink">
              {t('colabNb.kunModifiedCellsCount', { total: kunChangedCellIds.length })}
            </span>
            <button
              type="button"
              onClick={locateChangedCell}
              className="shrink-0 text-[11.5px] text-ds-muted hover:text-ds-ink"
            >
              {t('colabNb.kunLocateCell')}
            </button>
            <button
              type="button"
              onClick={() => void undoKunChanges()}
              className="shrink-0 rounded-md border border-ds-border bg-ds-card px-2 py-0.5 text-[11px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('colabNb.kunUndo')}
            </button>
            <button
              type="button"
              onClick={dismissKunChanges}
              className="shrink-0 rounded-md bg-ds-ink px-2 py-0.5 text-[11px] font-medium text-ds-main hover:opacity-90"
            >
              {t('colabNb.kunKeep')}
            </button>
          </div>
        ) : null}

        <FloatingComposer
          variant="compact"
          agentSwitcher
          {...referenceProps}
          workspaceRootOverride={runtime.wsKey}
          input={composer.input}
          setInput={composer.setInput}
          mode={composer.mode}
          setMode={composer.setMode}
          busy={busy}
          runtimeReady={chat.runtimeConnection === 'ready'}
          hasActiveThread={showing}
          composerModel={composer.composerModel}
          composerProviderId={composer.composerProviderId}
          composerPickList={composer.composerPickList}
          composerModelGroups={composer.composerModelGroups}
          skillCommands={composer.skillCommands}
          disabledSkillIds={composer.disabledSkillIds}
          composerReasoningEffort={composer.composerReasoningEffort}
          composerFastMode={composer.composerFastMode}
          onComposerModelChange={composer.onComposerModelChange}
          onComposerReasoningEffortChange={composer.onComposerReasoningEffortChange}
          onComposerFastModeChange={composer.onComposerFastModeChange}
          onConfigureProviders={composer.onConfigureProviders}
          modelPickerMode="combobox"
          modelControlVariant="split"
          placeholderOverride={t('colabNb.kunComposerPlaceholder')}
          executionSettings={composer.executionSettings}
          executionSettingsApplying={composer.executionSettingsApplying}
          onExecutionSettingsChange={composer.onExecutionSettingsChange}
          queuedMessages={showing ? composer.queuedMessages : []}
          onRemoveQueuedMessage={composer.onRemoveQueuedMessage}
          onGuideQueuedMessage={composer.onGuideQueuedMessage}
          attachments={composer.attachments}
          attachmentUploadEnabled={composer.attachmentUploadEnabled}
          attachmentUploadBusy={composer.attachmentUploadBusy}
          attachmentUploadError={composer.attachmentUploadError}
          onPickAttachments={composer.onPickAttachments}
          onPasteClipboardImage={composer.onPasteClipboardImage}
          onPasteLongText={composer.onPasteLongText}
          onRemoveAttachment={composer.onRemoveAttachment}
          contextChips={contextChips}
          onRemoveContextChip={removeChip}
          onSend={() => void send()}
          onInterrupt={composer.onInterrupt}
        />

        <div className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-ds-muted">
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                runtime.activeSessionId
                  ? 'bg-emerald-500'
                  : runtime.pending || runtime.jupyterConnecting
                    ? 'bg-amber-500 animate-pulse'
                    : 'bg-ds-faint'
              }`}
            />
            <span className="font-mono">
              {runtime.activeRuntimeLabel
                ? t('colabNb.gpuRunning', { gpu: runtime.activeRuntimeLabel })
                : t('colabNb.kernelOffline')}
            </span>
          </span>
          {activePath ? <span className="truncate font-mono text-ds-faint">{activePath}</span> : null}
        </div>
      </div>
    </div>
  )
}
