import type {
  MutableRefObject,
  ReactElement,
  RefObject
} from 'react'
import { ArrowRight, FileText, Loader2, Palette, Save, X } from 'lucide-react'
import type { WriteInfographicKind } from '@shared/write-infographic'
import type { SddDesignContext } from '../../sdd/sdd-draft-store'
import { saveActiveSddDraftToDisk } from '../../sdd/sdd-draft-actions'
import type { WriteBlockType } from '../../write/block-type'
import type { WriteInlineFormatKind } from '../../write/inline-format'
import type { WriteRecentEdit } from '../../write/recent-edits'
import type { ResolvedWriteQuickAction } from '../../write/quick-actions'
import type {
  WriteEditorSelectionState,
  WriteMarkdownEditorHandle
} from '../write/WriteMarkdownEditor'
import { WriteMarkdownEditor } from '../write/WriteMarkdownEditor'
import type { WriteRichEditorHandle } from '../../write/tiptap/WriteRichEditor'
import { WriteRichEditor } from '../../write/tiptap/WriteRichEditor'
import { WRITE_SAFE_MARKDOWN_RENDER_MAX_CHARS } from '../../write/write-render-safety'
import { WriteInlineAgent } from '../write/WriteInlineAgent'
import type {
  WriteInlineAgentPosition,
  WriteNotice
} from '../write/write-workspace-view-utils'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import {
  SddAssistantToggleButton,
  SddDesignContextBar,
  SddRequirementProgress
} from './SddDraftEditorParts'

type Translate = (key: string, values?: Record<string, unknown>) => string

type SddDraftEditorContentProps = {
  leftSidebarCollapsed: boolean
  assistantOpen: boolean
  onToggleLeftSidebar: () => void
  onToggleAssistant: () => void
  onExploreInDesign?: () => void
  onNext: () => void
  onClose: () => void
  nextDisabled: boolean
  t: Translate
  activeDraft: {
    relativePath: string
    workspaceRoot: string
    designContext?: SddDesignContext
  }
  content: string
  saveStatus: string
  error: string | null
  notice: WriteNotice | null
  readOnly: boolean
  upgrading: boolean
  statusLabel: string
  saveTimerRef: MutableRefObject<number | null>
  updateDesignContext: (patch: Partial<SddDesignContext>) => void
  editorPaneRef: RefObject<HTMLDivElement | null>
  editorFilePath: string
  unitImageDir: string | null
  richHandleRef: MutableRefObject<WriteRichEditorHandle | null>
  markdownHandleRef: MutableRefObject<WriteMarkdownEditorHandle | null>
  inlineCompletion: {
    model: string
    enabled: boolean
    debounceMs: number
    minAcceptScore: number
    longCompletionEnabled: boolean
    longDebounceMs: number
    longMinAcceptScore: number
  }
  inlineCompletionApiReady: boolean
  recentEdits: WriteRecentEdit[]
  setContent: (content: string) => void
  recordRecentEdits: (edits: WriteRecentEdit[]) => void
  setSelection: (selection: WriteEditorSelectionState) => void
  setOperationStatus: (status: 'idle' | 'upgrading' | 'error', error?: string) => void
  selectionAction: WriteInlineAgentPosition | null
  quoteSelectionToAssistant: () => void
  applyInlineFormat: (kind: WriteInlineFormatKind) => void
  selection: WriteEditorSelectionState
  applyBlockType: (type: WriteBlockType) => void
  inlineQuickActions: ResolvedWriteQuickAction[]
  runQuickAction: (action: ResolvedWriteQuickAction) => void
  imageGenReady: boolean
  generateImage: (kind: WriteInfographicKind) => void
  prototypeReady: boolean
  generatePrototype: () => void
  imageSelectionActive: boolean
}

export function SddDraftEditorContent({
  leftSidebarCollapsed,
  assistantOpen,
  onToggleLeftSidebar,
  onToggleAssistant,
  onExploreInDesign,
  onNext,
  onClose,
  nextDisabled,
  t,
  activeDraft,
  content,
  saveStatus,
  error,
  notice,
  readOnly,
  upgrading,
  statusLabel,
  saveTimerRef,
  updateDesignContext,
  editorPaneRef,
  editorFilePath,
  unitImageDir,
  richHandleRef,
  markdownHandleRef,
  inlineCompletion,
  inlineCompletionApiReady,
  recentEdits,
  setContent,
  recordRecentEdits,
  setSelection,
  setOperationStatus,
  selectionAction,
  quoteSelectionToAssistant,
  applyInlineFormat,
  selection,
  applyBlockType,
  inlineQuickActions,
  runQuickAction,
  imageGenReady,
  generateImage,
  prototypeReady,
  generatePrototype,
  imageSelectionActive
}: SddDraftEditorContentProps): ReactElement {
  return (
    <section className="sdd-draft-shell ds-no-drag flex min-h-0 min-w-0 flex-1 flex-col px-3 sm:px-4 md:px-6 lg:px-8">
      <div className={`ds-stage-inset shrink-0 -mr-3 sm:-mr-4 md:-mr-6 lg:-mr-8 ${leftSidebarCollapsed ? 'ds-window-controls-safe-inset' : '-ml-3 sm:-ml-4 md:-ml-6 lg:-ml-8'}`}>
        <header className="sdd-draft-topbar ds-topbar-surface relative z-10 mt-3 flex min-h-[56px] w-full items-stretch overflow-visible rounded-[18px]">
          <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
            <div
              className={`flex min-w-0 items-center gap-2.5 ${
                leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''
              }`}
            >
              {leftSidebarCollapsed ? (
                <SidebarTitlebarToggleButton
                  onClick={onToggleLeftSidebar}
                  title={t('sidebarExpand')}
                  ariaLabel={t('sidebarExpand')}
                />
              ) : null}
              <span className="sdd-draft-file-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <FileText className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1 leading-none">
                <div className="truncate text-[15px] font-semibold text-ds-ink">
                  {t('sddDraftTitle')}
                </div>
                <div className="mt-1.5 truncate text-[12px] text-ds-faint">
                  {activeDraft.relativePath}
                </div>
              </div>
            </div>

            <div className="flex min-w-0 items-center justify-end gap-1.5">
              <span
                aria-live="polite"
                className={`sdd-status-pill inline-flex min-w-[72px] items-center justify-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold ${
                  readOnly
                    ? 'is-upgrading bg-sky-500/12 text-sky-700 dark:text-sky-300'
                    : saveStatus === 'error'
                      ? 'bg-red-500/12 text-red-600 dark:text-red-300'
                      : saveStatus === 'dirty'
                        ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                        : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {readOnly || saveStatus === 'saving' ? (
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                ) : (
                  <Save className="h-3 w-3" strokeWidth={1.8} />
                )}
                {statusLabel}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
                  void saveActiveSddDraftToDisk()
                }}
                disabled={readOnly || saveStatus === 'saved'}
                className="ds-sidebar-toggle-button disabled:cursor-not-allowed disabled:opacity-45"
                title={t('writeSaveFile')}
                aria-label={t('writeSaveFile')}
              >
                <Save className="h-4 w-4" strokeWidth={1.85} />
              </button>
              <SddAssistantToggleButton
                assistantOpen={assistantOpen}
                onToggleAssistant={onToggleAssistant}
                label={t('sddAssistant')}
              />
              {onExploreInDesign ? (
                <button
                  type="button"
                  onClick={onExploreInDesign}
                  disabled={readOnly}
                  className="ds-sidebar-toggle-button disabled:cursor-not-allowed disabled:opacity-45"
                  title={t('designExploreInDesign')}
                  aria-label={t('designExploreInDesign')}
                >
                  <Palette className="h-4 w-4" strokeWidth={1.85} />
                </button>
              ) : null}
              <button
                type="button"
                onClick={onNext}
                disabled={nextDisabled || readOnly}
                className="sdd-next-button inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-accent px-3 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {readOnly ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                ) : (
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                )}
                {t('sddNextStep')}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={readOnly}
                className="ds-sidebar-toggle-button disabled:cursor-not-allowed disabled:opacity-45"
                title={t('close')}
                aria-label={t('close')}
              >
                <X className="h-4 w-4" strokeWidth={1.9} />
              </button>
            </div>
          </div>
        </header>
      </div>

      <SddRequirementProgress content={content} />

      <SddDesignContextBar designContext={activeDraft.designContext} onChange={updateDesignContext} />

      <div ref={editorPaneRef} className="min-h-0 min-w-0 flex-1 overflow-hidden pb-3 pt-2">
        <div
          className={`sdd-editor-card relative h-full min-h-0 overflow-hidden rounded-[18px] border border-ds-border bg-ds-card/88 shadow-[0_20px_56px_rgba(20,47,95,0.06)] ${
            upgrading ? 'is-upgrading' : ''
          }`}
        >
          {upgrading ? <div className="sdd-editor-progress" /> : null}
          {content.length > WRITE_SAFE_MARKDOWN_RENDER_MAX_CHARS ? (
            <WriteMarkdownEditor
              value={content}
              workspaceRoot={activeDraft.workspaceRoot}
              filePath={editorFilePath}
              imageDirectory={unitImageDir ?? undefined}
              readOnly={readOnly}
              handleRef={markdownHandleRef}
              completionModel={inlineCompletion.model}
              completionEnabled={inlineCompletion.enabled && inlineCompletionApiReady}
              completionDebounceMs={inlineCompletion.debounceMs}
              completionMinAcceptScore={inlineCompletion.minAcceptScore}
              completionLongEnabled={inlineCompletion.longCompletionEnabled}
              completionLongDebounceMs={inlineCompletion.longDebounceMs}
              completionLongMinAcceptScore={inlineCompletion.longMinAcceptScore}
              recentEdits={recentEdits}
              onChange={setContent}
              onDocumentEdit={recordRecentEdits}
              onSelectionChange={setSelection}
              onSaveShortcut={() => {
                if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
                void saveActiveSddDraftToDisk()
              }}
              onImagePasteSaved={() => {
                setOperationStatus('idle')
              }}
              onImagePasteError={(message) => setOperationStatus('error', message)}
            />
          ) : (
          <WriteRichEditor
            value={content}
            workspaceRoot={activeDraft.workspaceRoot}
            filePath={editorFilePath}
            imageDirectory={unitImageDir ?? undefined}
            readOnly={readOnly}
            requirementBadges
            handleRef={richHandleRef}
            completionModel={inlineCompletion.model}
            completionEnabled={inlineCompletion.enabled && inlineCompletionApiReady}
            completionDebounceMs={inlineCompletion.debounceMs}
            completionMinAcceptScore={inlineCompletion.minAcceptScore}
            completionLongEnabled={inlineCompletion.longCompletionEnabled}
            completionLongDebounceMs={inlineCompletion.longDebounceMs}
            completionLongMinAcceptScore={inlineCompletion.longMinAcceptScore}
            recentEdits={recentEdits}
            onChange={setContent}
            onDocumentEdit={recordRecentEdits}
            onSelectionChange={setSelection}
            onSaveShortcut={() => {
              if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
              void saveActiveSddDraftToDisk()
            }}
            onImagePasteSaved={() => {
              setOperationStatus('idle')
            }}
            onImagePasteError={(message) => setOperationStatus('error', message)}
          />
          )}
        </div>
      </div>

      {selectionAction ? (
        <WriteInlineAgent
          action={selectionAction}
          formattingEnabled={!readOnly}
          onApplyFormat={applyInlineFormat}
          blockType={selection.blockType}
          onSetBlockType={applyBlockType}
          quickActions={inlineQuickActions}
          onQuickAction={runQuickAction}
          onQuoteSelection={quoteSelectionToAssistant}
          infographicEnabled={imageGenReady && !readOnly}
          onGenerateInfographic={() => generateImage('infographic')}
          designDraftEnabled={imageGenReady && !readOnly}
          onGenerateDesignDraft={() => generateImage('design')}
          prototypeEnabled={prototypeReady && !readOnly}
          onGeneratePrototype={generatePrototype}
          imageMode={imageSelectionActive}
        />
      ) : null}

      {error ? (
        <div className="sdd-error-toast pointer-events-none fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-full border border-red-200/70 bg-red-50/92 px-4 py-2 text-[13px] text-red-700 shadow-[0_14px_32px_rgba(20,47,95,0.12)] dark:border-red-900/60 dark:bg-red-950/84 dark:text-red-200">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          className="pointer-events-none fixed left-1/2 z-40 -translate-x-1/2 rounded-full border border-emerald-200/80 bg-emerald-50/92 px-4 py-2 text-[13px] text-emerald-700 shadow-[0_14px_32px_rgba(20,47,95,0.12)] dark:border-emerald-900/60 dark:bg-emerald-950/84 dark:text-emerald-200"
          style={{ bottom: error ? 68 : 20 }}
        >
          {notice.message}
        </div>
      ) : null}
    </section>
  )
}
