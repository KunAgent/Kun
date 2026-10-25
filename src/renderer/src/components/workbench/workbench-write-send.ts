import type { Dispatch, SetStateAction } from 'react'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { AttachmentReference, UserFileReference } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import type { ChatState } from '../../store/chat-store-types'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { captureWriteDocumentContext, writeDocumentContextMatches } from '../../write/write-document-context'
import type { WriteOfficeDocumentContext } from '../../write/quoted-selection'
import { writeDocumentKey } from '../../write/write-editor-layout'
import { selectFocusedPresentationView } from '../../write/write-presentation-view-state'
import { createWorkspaceOfficeViewPositionAttachment } from '../../lib/workspace-office-view-context'
import { loadWriteOfficeSemanticContext, writeOfficeSemanticContextMatches } from '../../write/write-office-semantic-context'
import { resolveWriteAgentPreset } from '../../write/agent-presets'
import { createWriteTurnReferenceAttachments, mergeWriteComposerContexts } from '../../write/write-turn-reference-context'
import { recoverWriteReferenceContextError } from '../../write/write-reference-context-error'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { buildComposerFileContextPrompt } from '../../lib/composer-file-references'
import { consumeLastCanvasOpErrors } from '../../design/canvas/apply-shape-ops'
import {
  activeWorkWhiteboardForSend,
  activeWorkWhiteboardComposerContexts,
  workWhiteboardAdvertisesCanvasTools, workWhiteboardAdvertisesExcalidrawTools,
  workWhiteboardMessageFence,
  workWhiteboardSnapshotMatches
} from './workbench-write-whiteboard-context'
import { composerReasoningEffortRequestValue, type ComposerReasoningEffort } from '../chat/FloatingComposerModelPicker'
import { serviceTierForComposerSelection } from '../chat/composer-fast-mode'
import type { ComposerAttachmentScope } from '../workbench-composer-attachments'
import { composerReferencesToUserFileReferences, stripTransientAttachmentFields } from './workbench-composer-prompts'
import { readWorkbenchComposerFileContextEntries } from './workbench-composer-file-context'
import { restoreWorkbenchWritePrompt } from './workbench-write-prompt-state'
import { workbenchWriteSourceContext } from './workbench-write-source-reference'
import { workContextDetached } from '../../write/work-context-store'
import { workAssistantUsesExternalAgent } from '../../write/work-assistant-agent'
import { activeWritePaperReference } from '../../write/write-paper-reference'
import { useWorkComposerReferences } from '../../write/work-composer-references'
import { retrieveWorkbenchWriteContext } from './workbench-write-retrieval'
import { readWriteDocumentSha256 } from './read-write-document-sha256'
import { beginWorkSubmission, observeWorkSubmission } from '../../product-analytics/work'

export type WorkbenchWriteSendDeps = {
  activeThreadId: string | null
  attachmentUploadEnabled: boolean
  composerAttachments: AttachmentReference[]
  composerMode: 'plan' | 'agent' | 'auto'
  composerModel: string
  composerProviderId: string
  composerModelGroups: ModelProviderModelGroup[]
  composerReasoningEffort: ComposerReasoningEffort
  composerFastMode: boolean
  getAttachmentScope: () => ComposerAttachmentScope
  removeComposerAttachments: (ids: readonly string[], scope?: ComposerAttachmentScope) => void
  sendMessage: ChatState['sendMessage']
  setAttachmentUploadError: (message: string | null) => void
  setError: (message: string | null) => void
  setInput: Dispatch<SetStateAction<string>>
  t: (key: string, options?: Record<string, unknown>) => string
  workspaceRoot: string
}

function uniqueFileReferences(references: readonly (UserFileReference | undefined)[]): UserFileReference[] {
  const seen = new Set<string>()
  return references.filter((reference): reference is UserFileReference => {
    if (!reference) return false
    const key = reference.path.replaceAll('\\', '/').toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * A Work assistant turn: the composer's Agent and model (as in Code) with what
 * is open in the space, the quoted passages and the @-referenced files.
 */
export function sendWorkbenchWritePrompt(deps: WorkbenchWriteSendDeps, value: string): void {
  const {
    activeThreadId, attachmentUploadEnabled, composerAttachments, composerMode, composerModel, composerProviderId,
    composerModelGroups, composerReasoningEffort, composerFastMode, getAttachmentScope, removeComposerAttachments,
    sendMessage, setAttachmentUploadError, setError, setInput, t, workspaceRoot
  } = deps
  const v = value.trim()
  const attachmentScope = getAttachmentScope()
  const attachments = composerAttachments
  const documentAttachments = attachments.filter((attachment) => attachment.kind === 'document')
  const attachmentIds = attachments.map((attachment) => attachment.id)
  const publicAttachments = stripTransientAttachmentFields(attachments)
  // Clearing the input drops the @ tokens, and with them the references; keep the snapshot.
  const fileReferences = [...useWorkComposerReferences.getState().references]
  if (!v && attachmentIds.length === 0 && documentAttachments.length === 0 && fileReferences.length === 0) return
  const analytics = beginWorkSubmission()
  if (attachmentIds.length > 0 && !attachmentUploadEnabled) {
    analytics?.finish('failed')
    setAttachmentUploadError(t('composerAttachmentModelUnsupported'))
    return
  }
  const writeState = useWriteWorkspaceStore.getState()
  const activeWhiteboard = activeWorkWhiteboardForSend(writeState)
  if (activeWhiteboard === undefined) {
    analytics?.finish('failed')
    setError(t('writeWhiteboardAssistantPreparing'))
    return
  }
  const writePresentationView = selectFocusedPresentationView(writeState)
  const writeWorkspaceRoot = writeState.workspaceRoot || workspaceRoot
  const writeDocumentContext = captureWriteDocumentContext({
    ...writeState,
    workspaceRoot: writeWorkspaceRoot
  })
  const writeActiveFilePath = writeState.activeFilePath
  const writeActiveDocument = writeActiveFilePath
    ? writeState.documentsByPath[writeDocumentKey(writeActiveFilePath)]
    : undefined
  // A removed context chip keeps the open document out of this turn.
  const contextDetached = workContextDetached(writeState)
  const writeSource = contextDetached
    ? { activeResource: undefined, fileReference: undefined }
    : workbenchWriteSourceContext(
      writeWorkspaceRoot, writeActiveFilePath, writeState.activeFileKind,
      writeActiveDocument?.officePreview?.sourceFormat)
  const writeDocumentEpoch = writeState.documentEpoch
  const writeContentRevision = writeState.contentRevision
  const quotedSelections = writeState.quotedSelections.map((selection) => ({
    ...selection,
    ...(selection.rects ? { rects: selection.rects.map((rect) => ({ ...rect })) } : {})
  }))
  const writeContextStillMatches = (): boolean => {
    if (useChatStore.getState().route !== 'write') return false
    const latest = useWriteWorkspaceStore.getState()
    if (writeDocumentContext) return writeDocumentContextMatches(latest, writeDocumentContext)
    return (
      normalizeWorkspaceRoot(latest.workspaceRoot || workspaceRoot) === normalizeWorkspaceRoot(writeWorkspaceRoot) &&
      workWhiteboardSnapshotMatches(latest, activeWhiteboard) &&
      latest.activeFilePath === writeActiveFilePath &&
      latest.documentEpoch === writeDocumentEpoch
    )
  }
  const restorePrompt = (): void => {
    restoreWorkbenchWritePrompt(v, setInput)
    if (fileReferences.length > 0) useWorkComposerReferences.getState().restore(fileReferences)
  }
  const writeDraftStillMatches = (): boolean => {
    const latest = useWriteWorkspaceStore.getState()
    return (
      writeContextStillMatches() &&
      latest.contentRevision === writeContentRevision &&
      latest.saveStatus === 'saved' &&
      latest.fileContent === latest.persistedContent &&
      latest.pendingAgentReview === null &&
      !latest.reviewActive
    )
  }
  const saveActiveDraft = async (): Promise<boolean> => {
    if (!writeContextStillMatches()) return false
    const beforeSave = useWriteWorkspaceStore.getState()
    if (beforeSave.contentRevision !== writeContentRevision) return false
    if (beforeSave.pendingAgentReview || beforeSave.reviewActive) {
      beforeSave.setFileError(t('writeExternalChangeConflict'))
      return false
    }
    // Clean read-only/truncated (or non-text) documents are safe to ask
    // about. Their flushSave path intentionally rejects/no-ops, so avoid it.
    // Normal text files still flush below to drain an older queued save.
    const cleanDocument = beforeSave.fileContent === beforeSave.persistedContent
    if (
      cleanDocument &&
      (beforeSave.fileTruncated || beforeSave.activeFileKind !== 'text' || !beforeSave.activeFilePath)
    ) {
      if (beforeSave.saveStatus !== 'saved') {
        useWriteWorkspaceStore.setState((current) => (
          writeContextStillMatches() &&
          current.contentRevision === writeContentRevision &&
          current.fileContent === current.persistedContent
            ? { saveStatus: 'saved' }
            : {}
        ))
      }
      return writeDraftStillMatches()
    }
    const saved = await beforeSave.flushSave(writeWorkspaceRoot)
    if (!saved) {
      const latest = useWriteWorkspaceStore.getState()
      if (writeContextStillMatches() && !latest.fileError) {
        latest.setFileError(t('writeAssistantSaveBeforeSendFailed'))
      }
      return false
    }
    return writeDraftStillMatches()
  }
  setInput('')
  void observeWorkSubmission(analytics, async () => {
    if (!await saveActiveDraft()) {
      restorePrompt()
      return
    }
    let officeDocument: WriteOfficeDocumentContext | null = null
    const hasOfficeQuote = quotedSelections.some((selection) => (
      selection.sourceKind === 'word' ||
      selection.sourceKind === 'presentation' ||
      selection.sourceKind === 'spreadsheet'
    ))
    if (writeActiveDocument?.kind === 'office' && !hasOfficeQuote) {
      const previewSha = writeActiveDocument.officePreview?.sourceSha256 ?? ''
      const loaded = writeActiveFilePath && previewSha
        ? await loadWriteOfficeSemanticContext({
            path: writeActiveFilePath,
            workspaceRoot: writeWorkspaceRoot,
            expectedSha256: previewSha,
            contextStillMatches: writeContextStillMatches
          })
        : { ok: false as const, stale: false, message: 'The Office preview is not ready.' }
      if (!loaded.ok) {
        if (loaded.message) {
          useWriteWorkspaceStore.getState().setFileError(loaded.message)
          setError(loaded.message)
        }
        restorePrompt()
        return
      }
      officeDocument = loaded.context
    }
    const retrieval = await retrieveWorkbenchWriteContext({
      workspaceRoot: writeWorkspaceRoot,
      currentFilePath: writeActiveFilePath,
      query: v,
      includeCurrentFile: quotedSelections.length === 0 && !contextDetached
    })
    if (!writeDraftStillMatches()) {
      restorePrompt()
      return
    }
    // Retrieval can take long enough for another edit to land. The revision
    // gate above aborts in that case; otherwise this final no-op/flush check
    // guarantees the exact captured draft is still persisted before send.
    if (!await saveActiveDraft()) {
      restorePrompt()
      return
    }
    const referenceCount = fileReferences.length + documentAttachments.length
    const messageText = v || (referenceCount > 0 ? t('composerFileOnlyPrompt') : t('composerImageOnlyPrompt'))
    const activeAgentPreset = writeState.agentPresets.find(
      (preset) => preset.id === writeState.assistantAgentPresetId
    )
    const agentPersona = activeAgentPreset ? resolveWriteAgentPreset(activeAgentPreset).persona : ''
    // The composer's Agent and model run this turn, exactly as in Code.
    const externalAgent = workAssistantUsesExternalAgent(useChatStore.getState())
    const reasoningEffort = composerReasoningEffortRequestValue(composerReasoningEffort)
    const serviceTier = serviceTierForComposerSelection(
      composerFastMode,
      composerModelGroups,
      composerModel,
      composerProviderId
    )
    let composerContexts: ReturnType<typeof mergeWriteComposerContexts>
    let promptText = messageText
    try {
      const viewContexts = writePresentationView
        ? [await createWorkspaceOfficeViewPositionAttachment({ workspaceRoot: writeWorkspaceRoot, view: writePresentationView })]
        : []
      const whiteboardContexts = await activeWorkWhiteboardComposerContexts(
        writeWorkspaceRoot,
        activeWhiteboard,
        activeThreadId,
        v
      )
      const referenceContexts = await createWriteTurnReferenceAttachments({
        workspaceRoot: writeWorkspaceRoot,
        activeResource: writeSource.activeResource,
        selections: quotedSelections,
        retrieval,
        officeDocument,
        query: v,
        paper: contextDetached ? undefined : activeWritePaperReference({ ...writeState, workspaceRoot: writeWorkspaceRoot })
      })
      const whiteboardReference = whiteboardContexts.filter((context) => (
        context.reference.kind === 'work-reference-whiteboard'
      ))
      const pptReviewContexts = whiteboardContexts.filter((context) => (
        context.reference.kind !== 'work-reference-whiteboard'
      ))
      composerContexts = mergeWriteComposerContexts(
        [...whiteboardReference, ...referenceContexts],
        viewContexts,
        pptReviewContexts
      )
      // @-referenced files travel in the turn, as in Code (bounded excerpts).
      if (fileReferences.length > 0) {
        promptText = buildComposerFileContextPrompt(messageText,
          await readWorkbenchComposerFileContextEntries(fileReferences, writeWorkspaceRoot, t))
      }
    } catch (error) {
      recoverWriteReferenceContextError(error, setError, restorePrompt)
      return
    }
    if (officeDocument && !writeOfficeSemanticContextMatches(officeDocument)) {
      restorePrompt()
      return
    }
    const expectedSha256 = writeActiveDocument?.kind === 'office'
      ? writeActiveDocument.officePreview?.sourceSha256
      : await readWriteDocumentSha256(writeWorkspaceRoot, writeActiveFilePath)
    const turnFileReferences = uniqueFileReferences([
      writeSource.fileReference,
      ...composerReferencesToUserFileReferences(fileReferences)
    ])
    const sent = await sendMessage(
      promptText,
      externalAgent || writeActiveDocument?.kind === 'office' ? 'agent' : composerMode === 'plan' ? 'plan' : 'agent',
      {
        agentSurface: 'write',
        ...(analytics ? { clientRequestId: analytics.clientRequestId } : {}),
        useComposerAgent: true,
        ...(v
          ? promptText !== v ? { displayText: v } : {}
          : referenceCount > 0
            ? { displayText: t('composerFileOnlyDisplay', { count: referenceCount }) }
            : attachmentIds.length > 0
              ? { displayText: t('composerImageOnlyDisplay') }
              : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(serviceTier ? { serviceTier } : {}),
        ...(attachmentIds.length ? { attachmentIds } : {}),
        ...(publicAttachments.length ? { attachments: publicAttachments } : {}),
        ...(composerContexts.length ? { composerContexts } : {}),
        ...(turnFileReferences.length ? { fileReferences: turnFileReferences } : {}),
        // Canvas tools are Kun's; an external Agent still reads the board snapshot.
        ...(externalAgent ? {} : workWhiteboardAdvertisesCanvasTools(activeWhiteboard) ? { guiDesignCanvas: true } : workWhiteboardAdvertisesExcalidrawTools(activeWhiteboard) ? { guiExcalidrawCanvas: true } : {}),
        ...(agentPersona ? { persona: agentPersona } : {}),
        writeContext: {
          workspaceRoot: writeWorkspaceRoot,
          activeFilePath: writeActiveFilePath,
          documentEpoch: writeDocumentEpoch,
          contentRevision: writeContentRevision,
          ...workWhiteboardMessageFence(activeWhiteboard),
          ...(expectedSha256 ? { expectedSha256 } : {})
        }
      }
    )
    if (sent) {
      // Consume only the captured ids. Quotes/attachments added while the
      // runtime starts remain in the composer, even if the active file moved.
      const latest = useWriteWorkspaceStore.getState()
      quotedSelections.forEach((selection) => latest.removeQuotedSelection(selection.id))
      if (attachmentIds.length > 0) removeComposerAttachments(attachmentIds, attachmentScope)
      if (fileReferences.length > 0) useWorkComposerReferences.getState().consume(fileReferences)
      // Only after the turn is admitted can the previous canvas-op errors be
      // treated as consumed; a rejected/aborted send must keep them visible.
      if (activeWhiteboard) consumeLastCanvasOpErrors(`work-canvas:${activeWhiteboard.id}`)
    } else {
      restorePrompt()
    }
    return sent ? 'accepted' : 'failed'
  })
}
