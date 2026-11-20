import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BarChart3,
  Bug,
  ChevronRight,
  Loader2,
  Sparkles,
  Target,
  Wand2
} from 'lucide-react'
import type { DesignComposerContext } from '../../design/design-composer-context'
import { FloatingComposer } from '../../components/chat/FloatingComposer'
import { LazyMessageTimeline } from '../../components/chat/LazyMessageTimeline'
import type { WorkbenchChatStageProps } from '../../components/workbench/WorkbenchChatStage'
import { useWorkComposerReferenceProps } from '../../components/write/use-work-composer-references'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { useChatStore } from '../../store/chat-store'
import { useWorkComposerReferences } from '../../write/work-composer-references'
import { NotebookKunDiffCard } from './NotebookKunDiffCard'
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

export type ColabKunSessionControl = {
  draftFresh: boolean
  setDraftFresh: (fresh: boolean) => void
  colabThreadIds: string[]
  setColabThreadIds: (ids: string[]) => void
  effectiveThreadId: string | null
}

const CHIP_NOTEBOOK_ID = 'colab-active-notebook'
const CHIP_CELL_ID = 'colab-selected-cell'

/** Code-mode Kun session pane docked inside the Colab right sidebar. */
export function ColabKunPane({
  chat,
  runtime,
  sessionControl
}: {
  chat?: ColabKunChatHost
  runtime: ColabNotebookRuntime
  sessionControl?: ColabKunSessionControl
}): ReactElement {
  const { t } = useTranslation('common')
  const threads = useChatStore((s) => s.threads)
  const activePath = useColabNotebookStore((s) => s.activePath)
  const cells = useColabNotebookStore((s) => s.cells)
  const dirty = useColabNotebookStore((s) => s.dirty)
  const selectedCellId = useColabNotebookStore((s) => s.selectedCellId)
  const kunCellRequest = useColabNotebookStore((s) => s.kunCellRequest)
  const kunBaselineCells = useColabNotebookStore((s) => s.kunBaselineCells)
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

  const [localDraftFresh, setLocalDraftFresh] = useState(false)
  const [localColabThreadIds, setLocalColabThreadIds] = useState<string[]>(() =>
    readColabKunThreadIds()
  )
  const [notebookChipDetached, setNotebookChipDetached] = useState(false)
  const [cellChipDetached, setCellChipDetached] = useState(false)

  const draftFresh = sessionControl ? sessionControl.draftFresh : localDraftFresh
  const setDraftFresh = sessionControl ? sessionControl.setDraftFresh : setLocalDraftFresh
  const colabThreadIds = sessionControl ? sessionControl.colabThreadIds : localColabThreadIds
  const setColabThreadIds = sessionControl
    ? sessionControl.setColabThreadIds
    : setLocalColabThreadIds

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

  const localEffectiveThreadId = useMemo(() => {
    if (draftFresh || !chat?.activeThreadId || !colabThreadIds.includes(chat.activeThreadId)) {
      return null
    }
    const thread = threads.find((th) => th.id === chat.activeThreadId)
    if (!thread) return null
    const root = normalizeWorkspaceRoot(runtime.wsKey)
    return !root || normalizeWorkspaceRoot(thread.workspace ?? '') === root ? thread.id : null
  }, [chat?.activeThreadId, colabThreadIds, draftFresh, runtime.wsKey, threads])

  const effectiveThreadId = sessionControl
    ? sessionControl.effectiveThreadId
    : localEffectiveThreadId
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
        kind: 'canvas-selection',
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

  const locateChangedCell = (): void => {
    const firstId = kunChangedCellIds[0]
    if (!firstId) return
    selectCell(firstId)
    const el = document.querySelector(`[data-cell-id="${CSS.escape(firstId)}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const hasTimeline =
    showing &&
    (chat.blocks.length > 0 ||
      chat.liveAssistant.trim().length > 0 ||
      chat.liveReasoning.trim().length > 0)

  const explainTitle =
    selectedCellNumber != null
      ? t('colabNb.quickExplainSelectedCell', { num: selectedCellNumber })
      : t('colabNb.quickExplainCell')

  const quickSuggestions = [
    {
      icon: Target,
      title: explainTitle,
      desc: t('colabNb.quickExplainDesc'),
      prompt: explainTitle
    },
    {
      icon: Bug,
      title: t('colabNb.quickFixError'),
      desc: t('colabNb.quickFixErrorDesc'),
      prompt: t('colabNb.quickFixError')
    },
    {
      icon: BarChart3,
      title: t('colabNb.quickEvalPlot'),
      desc: t('colabNb.quickEvalPlotDesc'),
      prompt: t('colabNb.quickEvalPlot')
    },
    {
      icon: Wand2,
      title: t('colabNb.quickCleanNotebook'),
      desc: t('colabNb.quickCleanNotebookDesc'),
      prompt: t('colabNb.quickCleanNotebook')
    }
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-colab-kun-pane>
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
          <div
            data-colab-kun-empty
            className="flex flex-1 flex-col overflow-y-auto px-4 pb-4 pt-5"
          >
            <div className="flex items-start gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#6d84f5] to-[#4f6bed] text-white shadow-sm">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-ds-ink">
                  {t('colabNb.kunEmptyTitle')}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-ds-muted">
                  {t('colabNb.kunEmptySubtitle')}
                </p>
              </div>
            </div>

            <div className="mb-2 mt-5 text-[11.5px] font-semibold text-ds-faint">
              {t('colabNb.kunSectionForNotebook')}
            </div>

            <div className="flex flex-col gap-1.5">
              {quickSuggestions.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => composer.setInput(item.prompt)}
                    className="group flex items-center gap-2.5 rounded-[10px] border border-ds-border-muted bg-ds-card px-2.5 py-2 text-left transition hover:border-accent-tint/40 hover:bg-ds-hover"
                  >
                    <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] bg-ds-surface-subtle text-ds-muted transition group-hover:bg-accent-tint/10 group-hover:text-accent">
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-ds-ink">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-ds-faint">
                        {item.desc}
                      </span>
                    </span>
                    <ChevronRight
                      className="h-3.5 w-3.5 shrink-0 text-ds-faint opacity-60 transition group-hover:translate-x-0.5 group-hover:text-ds-muted"
                      aria-hidden="true"
                    />
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 px-3 pb-2.5 pt-1.5">
        {kunChangedCellIds.length > 0 && !busy ? (
          <NotebookKunDiffCard
            baseline={kunBaselineCells}
            cells={cells}
            changedCellIds={kunChangedCellIds}
            onLocate={locateChangedCell}
            onUndo={() => void undoKunChanges()}
            onKeep={dismissKunChanges}
          />
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
      </div>
    </div>
  )
}
