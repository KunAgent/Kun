import { useSelectionEdit } from '../write/selection-menu/use-selection-edit'
import { useFrozenSelection } from '../write/selection-menu/use-frozen-selection'
import { SelectionEditLayer } from '../write/selection-menu/SelectionEditLayer'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ArrowRight, FileText, Loader2, Palette, Save, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { sddUnitImageDir, sddUnitProtoDir } from '@shared/sdd'
import { parseSddRequirementBlocks } from '@shared/sdd-trace'
import { WRITE_INFOGRAPHIC_MAX_TEXT_CHARS, type WriteInfographicKind } from '@shared/write-infographic'
import { WRITE_PROTOTYPE_MAX_TEXT_CHARS } from '@shared/write-prototype'
import { useSddTrace } from '../../sdd/use-sdd-trace'
import { useSddDraftStore, type SddDesignContext } from '../../sdd/sdd-draft-store'
import { SDD_DESIGN_TONE_OPTIONS } from '../../sdd/sdd-design-context'
import { saveActiveSddDraftToDisk, syncActiveSddDraftFromDisk } from '../../sdd/sdd-draft-actions'
import { buildSddPrototypeTurnPrompt } from '../../sdd/sdd-prototype-prompt'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { startWriteWorkspaceFileWatch } from '../../write/write-file-watch'
import { toggleWriteInlineFormat, type WriteInlineFormatKind } from '../../write/inline-format'
import type { WriteBlockType } from '../../write/block-type'
import { resolveWriteQuickActions, type ResolvedWriteQuickAction } from '../../write/quick-actions'
import {
  quotedSelectionFromEditor
} from '../../write/quoted-selection'
import { parseImageMarkdownLine } from '../../write/selected-image'
import { resolveWriteMarkdownResourcePath } from '@shared/write-markdown-resource'
import {
  beginPendingInfographic,
  buildPendingInfographicMarkdown,
  finishPendingInfographic,
  lineEndAfter,
  replacePendingInfographicInText,
  type PendingInfographicKind
} from '../../write/infographic-pending'
import {
  WriteMarkdownEditor,
  type WriteMarkdownEditorHandle,
  type WriteSelectedImage
} from '../write/WriteMarkdownEditor'
import { WriteRichEditor, type WriteRichEditorHandle } from '../../write/tiptap/WriteRichEditor'
import { WriteInlineAgent } from '../write/WriteInlineAgent'
import {
  INLINE_EDIT_RECENT_CONTEXT_CHARS,
  inlineAgentPosition,
  WRITE_EXPORT_NOTICE_MS,
  type WriteNotice
} from '../write/write-workspace-view-utils'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import type { WriteEditorSelectionState } from '../write/WriteMarkdownEditor'

export { SddAssistantToggleButton } from './SddDraftEditorParts'
import { SddDraftEditorContent } from './SddDraftEditorContent'
import { createSddDraftGenerationController } from './sdd-draft-generation-controller'
import {
  PROTOTYPE_POLL_INTERVAL_MS,
  PROTOTYPE_POLL_TIMEOUT_MS,
  SDD_AUTOSAVE_MS,
  designReferenceTextFromImage,
  randomPrototypeFileName,
  statusKey,
  type Props
} from './SddDraftEditorParts'

export function prepareSddAssistantSelection(input: {
  prompt: string
  selection: WriteEditorSelectionState
  filePath: string
  workspaceRoot: string
}) {
  return {
    prompt: input.prompt.trim(),
    selection: quotedSelectionFromEditor(input.selection, input.filePath, input.workspaceRoot)
  }
}

export function SddDraftEditorView({
  leftSidebarCollapsed,
  assistantOpen,
  onToggleLeftSidebar,
  onToggleAssistant,
  onAssistantQuote,
  onPrototypeTurn,
  onExploreInDesign,
  onNext,
  onClose,
  nextDisabled
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const saveTimerRef = useRef<number | null>(null)
  const {
    activeDraft,
    content,
    saveStatus,
    operationStatus,
    error,
    setContent,
    setOperationStatus,
    updateDesignContext
  } = useSddDraftStore(
    useShallow((s) => ({
      activeDraft: s.activeDraft,
      content: s.content,
      saveStatus: s.saveStatus,
      operationStatus: s.operationStatus,
      error: s.error,
      setContent: s.setContent,
      setOperationStatus: s.setOperationStatus,
      updateDesignContext: s.updateDesignContext
    }))
  )
  const {
    inlineCompletion,
    inlineCompletionApiReady,
    selectionAssist,
    imageGenReady,
    prototypeReady,
    selection: liveSelection,
    recentEdits,
    loadWriteSettings,
    setSelection,
    recordRecentEdits
  } = useWriteWorkspaceStore(
    useShallow((s) => ({
      inlineCompletion: s.inlineCompletion,
      inlineCompletionApiReady: s.inlineCompletionApiReady,
      selectionAssist: s.selectionAssist,
      imageGenReady: s.imageGenReady,
      prototypeReady: s.prototypeReady,
      selection: s.selection,
      recentEdits: s.recentEdits,
      loadWriteSettings: s.loadWriteSettings,
      setSelection: s.setSelection,
      recordRecentEdits: s.recordRecentEdits
    }))
  )
  const editorPaneRef = useRef<HTMLDivElement | null>(null)
  const richHandleRef = useRef<WriteRichEditorHandle | null>(null)
  const markdownHandleRef = useRef<WriteMarkdownEditorHandle | null>(null)
  const noticeTimerRef = useRef<number | null>(null)
  const [pointerSelecting, setPointerSelecting] = useState(false)
  const [notice, setNotice] = useState<WriteNotice | null>(null)

  useEffect(() => {
    void loadWriteSettings()
  }, [loadWriteSettings])

  // The selection slice is shared with the write workspace view (they are
  // never mounted together); clear it on both ends so neither view shows a
  // toolbar anchored to the other's stale selection.
  useEffect(() => {
    const clear = (): void =>
      useWriteWorkspaceStore.getState().setSelection({ text: '', ranges: [], charCount: 0 })
    clear()
    return clear
  }, [])

  // Hide the toolbar while a pointer drag is selecting text inside the editor;
  // it reappears on pointer release once the selection has settled.
  useEffect(() => {
    const handleDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && editorPaneRef.current?.contains(target)) {
        setPointerSelecting(true)
      }
    }
    const handleUp = (): void => setPointerSelecting(false)
    window.addEventListener('pointerdown', handleDown)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      window.removeEventListener('pointerdown', handleDown)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [])

  useEffect(() => {
    if (!notice) return
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null
      setNotice(null)
    }, WRITE_EXPORT_NOTICE_MS)
    return () => {
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current)
        noticeTimerRef.current = null
      }
    }
  }, [notice])

  // Trace loop: pull live build/plan progress back into requirement statuses.
  useSddTrace({
    workspaceRoot: activeDraft?.workspaceRoot ?? '',
    draftRelativePath: activeDraft?.relativePath ?? null
  })

  useEffect(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (!activeDraft || saveStatus !== 'dirty') return
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void saveActiveSddDraftToDisk()
    }, SDD_AUTOSAVE_MS)
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [activeDraft, content, saveStatus])

  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    void saveActiveSddDraftToDisk()
  }, [])

  const activeDraftId = activeDraft?.id
  const activeDraftWorkspaceRoot = activeDraft?.workspaceRoot
  const activeDraftRelativePath = activeDraft?.relativePath
  const activeDraftAbsolutePath = activeDraft?.absolutePath

  useEffect(() => {
    if (!activeDraftId || !activeDraftWorkspaceRoot || !activeDraftRelativePath) return
    if (
      typeof window.kunGui?.watchWorkspaceFile !== 'function' ||
      typeof window.kunGui?.unwatchWorkspaceFile !== 'function' ||
      typeof window.kunGui?.onWorkspaceFileChanged !== 'function'
    ) {
      return
    }

    return startWriteWorkspaceFileWatch({
      api: window.kunGui,
      workspaceRoot: activeDraftWorkspaceRoot,
      path: activeDraftAbsolutePath ?? activeDraftRelativePath,
      kind: 'text',
      onTextSnapshot: (snapshot) => {
        void syncActiveSddDraftFromDisk(snapshot)
      },
      onImageChanged: () => undefined,
      onError: (message) => {
        useSddDraftStore.getState().setSaveStatus('error', message)
      }
    })
  }, [activeDraftAbsolutePath, activeDraftId, activeDraftRelativePath, activeDraftWorkspaceRoot])

  const frozen = useFrozenSelection(liveSelection, activeDraft?.id ?? '')
  const selection = frozen.selection
  const selectionEdit = useSelectionEdit({
    documentKey: activeDraft?.id ?? '', filePath: activeDraft?.absolutePath ?? activeDraft?.relativePath ?? '',
    workspaceRoot: activeDraft?.workspaceRoot ?? '', fileContent: content, selection,
    readOnly: operationStatus === 'upgrading', model: inlineCompletion.model, recentEdits,
    getHandle: () => richHandleRef.current ?? markdownHandleRef.current,
    getEditContent: () => richHandleRef.current?.getProjectionText() ?? useSddDraftStore.getState().content,
    setSelection, setError: (message) => setOperationStatus(message ? 'error' : 'idle', message ?? undefined),
    recordEdits: recordRecentEdits,
    toChat: (instruction, snapshot) => {
      const quoted = quotedSelectionFromEditor(snapshot, activeDraft?.absolutePath ?? activeDraft?.relativePath ?? '', activeDraft?.workspaceRoot ?? '')
      setSelection({ text: '', ranges: [], charCount: 0 }); onAssistantQuote(instruction, quoted ?? undefined)
    }
  })

  if (!activeDraft) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[14px] text-ds-muted">
        {t('sddNoActiveDraft')}
      </div>
    )
  }

  const upgrading = operationStatus === 'upgrading'
  const readOnly = upgrading
  const statusLabel = t(statusKey(saveStatus, operationStatus))

  const draftId = activeDraft.id
  const draftWorkspaceRoot = activeDraft.workspaceRoot
  const editorFilePath = activeDraft.absolutePath ?? activeDraft.relativePath
  // The image IPC resolves relative paths against the main-process cwd, so it
  // must always receive an absolute document path.
  const docAbsolutePath =
    activeDraft.absolutePath ?? `${activeDraft.workspaceRoot}/${activeDraft.relativePath}`
  // Per-requirement asset directories inside the unit folder; null only for
  // non-conforming paths, which the registry filter prevents in practice.
  const unitImageDir = sddUnitImageDir(activeDraft.relativePath)
  const unitProtoDir = sddUnitProtoDir(activeDraft.relativePath)
  const imageSelectionActive = Boolean(selection.selectedImage) && selection.charCount === 0
  const imageSelectionActionReady = imageSelectionActive && (prototypeReady || imageGenReady) && !readOnly
  const selectionAction =
    (selection.charCount > 0 || imageSelectionActionReady) &&
    !pointerSelecting && !selectionEdit.session && !frozen.dismissed
      ? inlineAgentPosition(selection)
      : null
  // Edit-mode quick actions rewrite the document, so drop them while the doc
  // is read-only (plan generation); chat-mode actions still apply.
  const inlineQuickActions = resolveWriteQuickActions(selectionAssist.quickActions, t).filter(
    (quickAction) => quickAction.mode !== 'edit' || !readOnly
  )

  const submitToAssistant = (prompt: string): void => {
    const prepared = prepareSddAssistantSelection({
      prompt, selection, filePath: editorFilePath, workspaceRoot: draftWorkspaceRoot
    })
    if (!prepared.prompt) return
    setSelection({ text: '', ranges: [], charCount: 0 })
    onAssistantQuote(prepared.prompt, prepared.selection ?? undefined)
  }

  const quoteSelectionToAssistant = (): void => {
    const quoted = quotedSelectionFromEditor(selection, editorFilePath, draftWorkspaceRoot)
    if (!quoted) return
    setSelection({ text: '', ranges: [], charCount: 0 })
    onAssistantQuote('', quoted)
  }

  const runQuickAction = (quickAction: ResolvedWriteQuickAction): void => {
    if (quickAction.mode === 'edit') {
      void selectionEdit.start({ instruction: quickAction.prompt, label: quickAction.label, source: { kind: 'skill', actionId: quickAction.id } })
      return
    }
    submitToAssistant(quickAction.prompt)
  }

  const applyInlineFormat = (kind: WriteInlineFormatKind): void => {
    if (readOnly) return
    const richHandle = richHandleRef.current
    if (richHandle) {
      richHandle.toggleInlineFormat(kind)
      return
    }
    if (selection.ranges.length !== 1) return
    const range = selection.ranges[0]
    const replacement = toggleWriteInlineFormat(range.text, kind)
    if (replacement === null) return
    markdownHandleRef.current?.applyRangeReplacement(
      { from: range.from, to: range.to },
      range.text,
      replacement,
      kind === 'link' ? { from: replacement.lastIndexOf('https://'), to: replacement.lastIndexOf('https://') + 8 } : undefined
    )
  }

  const applyBlockType = (type: WriteBlockType): void => {
    if (readOnly) return
    const richHandle = richHandleRef.current
    if (richHandle) {
      // TipTap toggle* commands already turn the active type back to paragraph.
      richHandle.setBlockType(type)
      return
    }
    // Source mode has no toggle built in: re-selecting the active type clears it.
    const effective = selection.blockType === type && type !== 'paragraph' ? 'paragraph' : type
    markdownHandleRef.current?.setBlockType(effective)
  }

  const { generateImage, generatePrototype } = createSddDraftGenerationController({
    readOnly,
    unitImageDir,
    unitProtoDir,
    selection,
    setSelection,
    setOperationStatus,
    t,
    richHandleRef,
    setContent,
    draftId,
    draftWorkspaceRoot,
    editorFilePath,
    docAbsolutePath,
    content,
    activeDraft,
    prototypePrompt: selectionAssist.prototypePrompt,
    onPrototypeTurn,
    setNotice
  })
  return (
    <>
    <SddDraftEditorContent
      menuProps={{ onAskEdit: (instruction) => { void selectionEdit.start({ instruction }) }, onAskChat: submitToAssistant,
        onFreezeSelection: frozen.freeze, onReleaseSelection: frozen.release, onDismiss: frozen.dismiss,
        onRestoreSelection: () => { if (selection.ranges[0]) (richHandleRef.current ?? markdownHandleRef.current)?.restoreSelection(selection.ranges[0]) } }}
      leftSidebarCollapsed={leftSidebarCollapsed}
      assistantOpen={assistantOpen}
      onToggleLeftSidebar={onToggleLeftSidebar}
      onToggleAssistant={onToggleAssistant}
      onExploreInDesign={onExploreInDesign}
      onNext={onNext}
      onClose={onClose}
      nextDisabled={nextDisabled}
      t={t}
      activeDraft={activeDraft}
      content={content}
      saveStatus={saveStatus}
      error={error}
      notice={notice}
      readOnly={readOnly}
      upgrading={upgrading}
      statusLabel={statusLabel}
      saveTimerRef={saveTimerRef}
      updateDesignContext={updateDesignContext}
      editorPaneRef={editorPaneRef}
      editorFilePath={editorFilePath}
      unitImageDir={unitImageDir}
      richHandleRef={richHandleRef}
      markdownHandleRef={markdownHandleRef}
      inlineCompletion={inlineCompletion}
      inlineCompletionApiReady={inlineCompletionApiReady}
      recentEdits={recentEdits}
      setContent={setContent}
      recordRecentEdits={recordRecentEdits}
      setSelection={setSelection}
      setOperationStatus={setOperationStatus}
      selectionAction={selectionAction}
      quoteSelectionToAssistant={quoteSelectionToAssistant}
      applyInlineFormat={applyInlineFormat}
      selection={selection}
      applyBlockType={applyBlockType}
      inlineQuickActions={inlineQuickActions}
      runQuickAction={runQuickAction}
      imageGenReady={imageGenReady}
      generateImage={generateImage}
      prototypeReady={prototypeReady}
      generatePrototype={generatePrototype}
      imageSelectionActive={imageSelectionActive}
    />
    <SelectionEditLayer controller={selectionEdit} />
    </>
  )
}
