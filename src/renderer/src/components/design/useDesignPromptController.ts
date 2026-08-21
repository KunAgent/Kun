import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import type { AttachmentReference } from '../../agent/types'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { providerIdForComposerModel } from '../../store/chat-store-helpers'
import type { ComposerAttachmentScope } from '../workbench-composer-attachments'
import type {
  ClearDesignHistoryOptions,
  ClearDesignHistoryResult
} from '../../store/chat-store-types'
import {
  composerReasoningEffortRequestValue,
  type ComposerReasoningEffort
} from '../chat/FloatingComposerModelPicker'
import { serviceTierForComposerSelection } from '../chat/composer-fast-mode'
import { useCanvasSelectionStore } from '../../design/canvas/canvas-selection-store'
import { useCodeCanvasDesignSurface } from '../../design/code-canvas-design-surface'
import type { CodeCanvasDesignSurface } from '../../design/code-canvas-design-surface'
import type { DesignHtmlElementContext } from '../../design/design-composer-context'
import {
  buildDesignPagesRunLabels,
  runDesignPagesDispatch
} from '../../design/design-pages-dispatch'
import { routeDesignPrompt } from '../../design/design-prompt-router'
import type { DesignPromptSource } from '../../design/design-quality-repair-dispatch'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { ensureDesignBoardArtifact } from '../../design/design-board'
import {
  buildDesignTaskProfileInput,
  resolveDesignTaskProfileSelection,
  type DesignTaskProfileSelection,
  type ResolvedDesignTaskProfileSelection
} from '../../design/design-task-profile-input'
import {
  activateLockedDesignDocument as restoreAuthoritativeDesignDocument,
  mergeThreadDesignProfile,
  resolveAuthoritativeDesignProfile
} from '../../design/design-locked-profile'
import type {
  DesignDocumentTarget,
  DesignTaskProfile
} from '../../agent/design-task-profile'
import { getProvider } from '../../agent/registry'
import { useChatStore } from '../../store/chat-store'
import { deriveDrawingTitleFromPrompt } from '../../design/design-drawing-title'
import { removePersistedDesignDocument } from '../../design/design-document-persistence'
import { designDocKey, readDesignThreadRegistry } from '../../design/design-thread-registry'
import { normalizeDesignWorkspaceRoot } from '../../design/design-workspace-lifecycle'
import type { DesignDocument } from '../../design/design-types'
import {
  submitDesignTurn,
  type DesignTurnSubmitSendMessage
} from '../../design/design-turn-submit'
import { useDesignQualityRepair } from './useDesignQualityRepair'

export type DesignPromptControllerOptions = {
  route: string
  runtimeConnection: string
  busy: boolean
  workspaceRoot: string
  composerAttachments: AttachmentReference[]
  attachmentUploadEnabled: boolean
  composerReasoningEffort: ComposerReasoningEffort
  composerFastMode: boolean
  composerModel?: string
  composerProviderId?: string
  composerModelGroups: readonly ModelProviderModelGroup[]
  designContextSuppressedIds: ReadonlySet<string>
  designHtmlElementContext: DesignHtmlElementContext | null
  setInput: Dispatch<SetStateAction<string>>
  setAttachmentUploadError: (error: string | null) => void
  setError: (error: string | null) => void
  setDesignAssistantOpen: (open: boolean) => void
  ensureDesignThreadForWorkspace: (workspaceRoot: string, docId: string) => Promise<string | null>
  clearDesignHistory: (
    workspaceRoot: string,
    docId: string,
    options?: ClearDesignHistoryOptions
  ) => Promise<ClearDesignHistoryResult>
  /** Unified Code-workbench Design tasks are not written to the legacy registry. */
  rollbackProvisionalThread?: (threadId: string) => Promise<boolean>
  designTaskProfileSelection?: DesignTaskProfileSelection
  lockedDesignProfile?: DesignTaskProfile | null
  expectedThreadId?: string | null
  imageGenerationAvailable?: boolean
  imageGenerationReason?: string
  sendMessage: DesignTurnSubmitSendMessage
  getAttachmentScope: () => ComposerAttachmentScope
  clearComposerAttachments: (scope?: ComposerAttachmentScope) => void
  clearHtmlElementContext: () => void
}

export type SendDesignPromptOptions = {
  displayText?: string
  source?: DesignPromptSource
  screenShapeId?: string
  svgArtifactId?: string
  imageEditReferencePath?: string
}

type PreparedDrawing = {
  docId: string
  created: boolean
  workspaceRoot: string
  fallbackDocuments: readonly DesignDocument[]
  fallbackActiveDocumentId: string | null
}

/**
 * After a provisional Design document was deleted, drop or restore the cached
 * Code-whiteboard target that still points at it. Without this the cache keeps
 * the panel mounted on a deleted document ("Loading design board...") for the
 * whole thread lifetime and across reloads, because the thread-scoped surface
 * is treated as a valid Design target by the workbench.
 */
function restoreCodeCanvasDesignSurfaceAfterRollback(
  documentId: string,
  threadId: string | null,
  previousSurface: CodeCanvasDesignSurface | undefined
): void {
  const surface = useCodeCanvasDesignSurface.getState().surface
  if (!surface || surface.documentId !== documentId) return
  if (threadId && surface.threadId !== threadId) return
  useCodeCanvasDesignSurface.getState().restoreDesignSurface(previousSurface ?? null)
}

export function useDesignPromptController({
  route,
  runtimeConnection,
  busy,
  workspaceRoot,
  composerAttachments,
  attachmentUploadEnabled,
  composerReasoningEffort,
  composerFastMode,
  composerModel,
  composerProviderId,
  composerModelGroups,
  designContextSuppressedIds,
  designHtmlElementContext,
  setInput,
  setAttachmentUploadError,
  setError,
  setDesignAssistantOpen,
  ensureDesignThreadForWorkspace,
  clearDesignHistory,
  rollbackProvisionalThread,
  designTaskProfileSelection,
  lockedDesignProfile,
  expectedThreadId,
  imageGenerationAvailable,
  imageGenerationReason,
  sendMessage,
  getAttachmentScope,
  clearComposerAttachments,
  clearHtmlElementContext
}: DesignPromptControllerOptions) {
  const { t } = useTranslation()

  const currentDesignServiceTier = (): 'priority' | undefined => {
    const model = composerModel?.trim() || ''
    const providerId = composerProviderId?.trim() ||
      providerIdForComposerModel(composerModelGroups, model)
    return serviceTierForComposerSelection(
      composerFastMode,
      composerModelGroups,
      model,
      providerId
    )
  }

  const designProfileForTarget = (
    target: DesignDocumentTarget,
    selection: DesignTaskProfileSelection | undefined = designTaskProfileSelection,
    profileLock: DesignTaskProfile | null = lockedDesignProfile ?? null
  ) => {
    if (profileLock) {
      return buildDesignTaskProfileInput({
        selection: selection ?? {
          outputMedium: profileLock.outputMedium,
          target: profileLock.target,
          preset: profileLock.preset,
          presetSource: profileLock.presetSource,
          styleSnapshot: profileLock.styleSnapshot
        },
        documentTarget: target,
        designContext: useDesignWorkspaceStore.getState().designContext,
        lockedProfile: profileLock
      })
    }
    if (!selection) return undefined
    return buildDesignTaskProfileInput({
      selection,
      documentTarget: target,
      designContext: useDesignWorkspaceStore.getState().designContext
    })
  }

  const resolveSubmitDesignProfile = async (): Promise<DesignTaskProfile | null> => {
    const threadId = expectedThreadId?.trim() || ''
    const localProfile = lockedDesignProfile ?? (
      threadId
        ? useChatStore.getState().threads.find((thread) => thread.id === threadId)?.designProfile
        : undefined
    ) ?? null
    if (!threadId) return localProfile
    return resolveAuthoritativeDesignProfile({
      threadId,
      localProfile,
      getThread: (id) => useChatStore.getState().threads.find((thread) => thread.id === id),
      fetchThreadDetail: (id) => getProvider().getThreadDetail(id),
      applyProfile: (id, profile) => {
        useChatStore.setState((state) => ({
          threads: mergeThreadDesignProfile(state.threads, id, profile)
        }))
      }
    })
  }

  const activateLockedDesignDocument = async (
    profileLock: DesignTaskProfile | null = lockedDesignProfile ?? null
  ): Promise<boolean> => {
    return restoreAuthoritativeDesignDocument(profileLock, setError, {
      threadId: expectedThreadId
    })
  }

  const prepareDrawingForFirstPrompt = (
    titleSource: string,
    profileLock: DesignTaskProfile | null
  ): PreparedDrawing | null => {
    const state = useDesignWorkspaceStore.getState()
    const unlockedTaskNeedsOwnDrawing = Boolean(designTaskProfileSelection && !profileLock)
    const shouldCreate = !profileLock && (
      unlockedTaskNeedsOwnDrawing ||
      state.drawingCreationOpen || state.documents.length === 0 || !state.activeDocumentId
    )
    if (!shouldCreate) {
      return {
        docId: state.ensureActiveDocument(),
        created: false,
        workspaceRoot: state.workspaceRoot || workspaceRoot,
        fallbackDocuments: state.documents,
        fallbackActiveDocumentId: state.activeDocumentId
      }
    }
    if (!state.drawingCreationOpen) state.beginDrawingCreation()
    const creationState = useDesignWorkspaceStore.getState()
    if (!creationState.beginDrawingSubmission()) return null
    try {
      const title = deriveDrawingTitleFromPrompt(titleSource) || t('designUntitledDrawing')
      const reusableDocumentId =
        creationState.drawingCreationDocumentId &&
        creationState.documents.some(
          (document) => document.id === creationState.drawingCreationDocumentId
        )
          ? creationState.drawingCreationDocumentId
          : null
      if (reusableDocumentId) {
        creationState.renameDocument(reusableDocumentId, title, { titleOrigin: 'generated' })
        const latest = useDesignWorkspaceStore.getState()
        return {
          docId: reusableDocumentId,
          created: true,
          workspaceRoot: latest.workspaceRoot || workspaceRoot,
          fallbackDocuments: latest.documents,
          fallbackActiveDocumentId: latest.activeDocumentId
        }
      }
      const docId = useDesignWorkspaceStore.getState().createDocument(title, {
          transient: true,
          titleOrigin: 'generated'
        })
      const latest = useDesignWorkspaceStore.getState()
      return {
        docId,
        created: true,
        workspaceRoot: latest.workspaceRoot || workspaceRoot,
        fallbackDocuments: latest.documents,
        fallbackActiveDocumentId: latest.activeDocumentId
      }
    } catch (error) {
      useDesignWorkspaceStore.getState().endDrawingSubmission()
      throw error
    }
  }

  const rollbackFirstPromptDrawing = async (
    drawing: PreparedDrawing,
    threadId?: string | null,
    previousSurface?: CodeCanvasDesignSurface
  ): Promise<boolean> => {
    let threadDeleteError: unknown = null
    const documentId = drawing.docId
    const cleanupWorkspaceRoot = drawing.workspaceRoot
    const registeredThreadIds = readDesignThreadRegistry().workspaces[
      designDocKey(cleanupWorkspaceRoot, documentId)
    ]?.threadIds ?? []
    if (threadId && rollbackProvisionalThread) {
      try {
        const removed = await rollbackProvisionalThread(threadId)
        if (!removed) threadDeleteError = new Error('The provisional Design task could not be deleted.')
      } catch (error) {
        threadDeleteError = error
      }
    } else if (threadId || registeredThreadIds.length > 0) {
      try {
        const result = await clearDesignHistory(
          cleanupWorkspaceRoot,
          documentId,
          {
            recreate: false,
            ...(threadId ? { includeThreadIds: [threadId] } : {})
          }
        )
        if (!result.cleared) {
          threadDeleteError = new Error('The provisional drawing conversation could not be deleted.')
        }
      } catch (error) {
        threadDeleteError = error
      }
    }
    const state = useDesignWorkspaceStore.getState()
    const stillInCreationWorkspace =
      normalizeDesignWorkspaceRoot(state.workspaceRoot) ===
      normalizeDesignWorkspaceRoot(cleanupWorkspaceRoot)
    if (stillInCreationWorkspace) state.endDrawingSubmission()
    // If Kun or a local mirror could not be removed, keep the provisional
    // drawing hidden in the launcher so its surviving thread never becomes an
    // orphan. A retry reuses this same document and conversation.
    if (threadDeleteError) {
      const message = threadDeleteError instanceof Error
        ? threadDeleteError.message
        : String(threadDeleteError)
      if (stillInCreationWorkspace) state.setFileError(message)
      setError(message)
      return false
    }

    let removed = false
    if (
      stillInCreationWorkspace &&
      state.documents.some((document) => document.id === documentId)
    ) {
      removed = await state.removeDocument(documentId)
    } else {
      removed = await removePersistedDesignDocument({
        workspaceRoot: cleanupWorkspaceRoot,
        documentId,
        fallbackDocuments: drawing.fallbackDocuments,
        fallbackActiveDocumentId: drawing.fallbackActiveDocumentId
      })
    }
    if (!removed) {
      const message = 'The provisional drawing directory could not be deleted.'
      const latest = useDesignWorkspaceStore.getState()
      if (
        normalizeDesignWorkspaceRoot(latest.workspaceRoot) ===
        normalizeDesignWorkspaceRoot(cleanupWorkspaceRoot)
      ) latest.setFileError(message)
      setError(message)
      return false
    }
    // The document is gone, so a cached target that still points at it is
    // stale: restore the pre-send surface (or clear it) atomically.
    restoreCodeCanvasDesignSurfaceAfterRollback(documentId, threadId ?? null, previousSurface)
    return true
  }

  async function generateDesignPages(
    brief: string,
    resolvedProfileSelection?: ResolvedDesignTaskProfileSelection,
    profileLock: DesignTaskProfile | null = null
  ): Promise<boolean> {
    const designState = useDesignWorkspaceStore.getState()
    const designWorkspaceRoot = designState.workspaceRoot || workspaceRoot
    if (!designWorkspaceRoot) {
      setError(t('workspaceRequiredToCreateThread'))
      return false
    }
    let drawing: ReturnType<typeof prepareDrawingForFirstPrompt> = null
    let provisionalThreadId: string | null = null
    // Captured before ensureDesignThreadForWorkspace writes a provisional
    // thread-scoped target; restored if this first send fails.
    let previousSurface: CodeCanvasDesignSurface | undefined = null
    try {
      drawing = prepareDrawingForFirstPrompt(brief, profileLock)
      if (!drawing) return false
      previousSurface = useCodeCanvasDesignSurface.getState().surface
      const threadId = await ensureDesignThreadForWorkspace(designWorkspaceRoot, drawing.docId)
      provisionalThreadId = drawing.created ? threadId : null
      if (!threadId) {
        if (drawing.created) await rollbackFirstPromptDrawing(drawing, undefined, previousSurface)
        setInput(brief)
        return false
      }
      const currentState = useDesignWorkspaceStore.getState()
      if (
        (currentState.workspaceRoot || designWorkspaceRoot) !== designWorkspaceRoot ||
        currentState.activeDocumentId !== drawing.docId
      ) {
        const message = 'Design turn was cancelled because the active workspace or drawing changed.'
        if (drawing.created) await rollbackFirstPromptDrawing(drawing, threadId, previousSurface)
        currentState.setFileError(message)
        setError(message)
        setInput(brief)
        return false
      }

      const boardArtifact = await ensureDesignBoardArtifact(designWorkspaceRoot, drawing.docId)
      if (!boardArtifact) {
        if (drawing.created) await rollbackFirstPromptDrawing(drawing, threadId, previousSurface)
        setInput(brief)
        return false
      }
      const designDocumentTarget = {
        documentId: drawing.docId,
        boardArtifactId: boardArtifact.id
      }
      const designProfile = designProfileForTarget(
        designDocumentTarget,
        resolvedProfileSelection
      )

      let settleFirstSend: (sent: boolean) => void = () => undefined
      const firstSend = new Promise<boolean>((resolve) => {
        let settled = false
        settleFirstSend = (sent) => {
          if (settled) return
          settled = true
          resolve(sent)
        }
      })
      void runDesignPagesDispatch({
        brief,
        workspaceRoot: designWorkspaceRoot,
        sendMessage,
        promptState: useDesignWorkspaceStore.getState(),
        resolveProviderId: (model) => providerIdForComposerModel(composerModelGroups, model),
        ...(composerModel ? { model: composerModel } : {}),
        ...(composerProviderId ? { providerId: composerProviderId } : {}),
        reasoningEffort: composerReasoningEffortRequestValue(composerReasoningEffort),
        serviceTier: currentDesignServiceTier(),
        expectedThreadId: threadId,
        ...(designProfile ? { designProfile } : {}),
        designDocumentTarget,
        ...(drawing.created ? { waitForRuntimeAdmission: true } : {}),
        labels: buildDesignPagesRunLabels(t),
        onFirstSendSettled: settleFirstSend
      }).catch((error) => {
        settleFirstSend(false)
        const message = error instanceof Error ? error.message : String(error)
        useDesignWorkspaceStore.getState().setFileError(message)
        setError(message)
      })

      const firstSendSucceeded = await firstSend
      if (!firstSendSucceeded) {
        if (drawing.created) await rollbackFirstPromptDrawing(drawing, threadId, previousSurface)
        setInput(brief)
        return false
      }
      if (drawing.created) {
        useDesignWorkspaceStore.getState().finishDrawingCreation(drawing.docId)
      }
      return true
    } catch (error) {
      if (drawing?.created) {
        await rollbackFirstPromptDrawing(drawing, provisionalThreadId, previousSurface)
      }
      const message = error instanceof Error ? error.message : String(error)
      useDesignWorkspaceStore.getState().setFileError(message)
      setError(message)
      setInput(brief)
      return false
    }
  }

  async function sendDesignPrompt(value: string, options: SendDesignPromptOptions = {}): Promise<boolean> {
    const source = options.source ?? 'user'
    const authoritativeProfile = await resolveSubmitDesignProfile()
    // A file-tree preview is never an implicit retarget. Existing Design tasks
    // always return to their immutable whiteboard before routing or admission.
    if (!(await activateLockedDesignDocument(authoritativeProfile))) return false
    const initialDesignState = useDesignWorkspaceStore.getState()
    if (designTaskProfileSelection?.outputMedium === 'image' && !imageGenerationAvailable) {
      setError(imageGenerationReason || t('designImageGenerationUnavailable'))
      return false
    }
    if (initialDesignState.drawingHistoryMutation) return false
    const creatingDrawing =
      initialDesignState.drawingCreationOpen ||
      initialDesignState.documents.length === 0 ||
      !initialDesignState.activeDocumentId
    if (creatingDrawing && (busy || initialDesignState.drawingCreationSubmitting)) return false
    if (creatingDrawing && runtimeConnection !== 'ready') {
      setError(t('runtimeActionNeedsConnection'))
      return false
    }
    const attachmentScope = getAttachmentScope()
    const promptRoute = routeDesignPrompt({
      value,
      displayText: options.displayText,
      attachments: composerAttachments,
      attachmentUploadEnabled,
      designState: useDesignWorkspaceStore.getState(),
      fallbackWorkspaceRoot: workspaceRoot,
      selectedCount: useCanvasSelectionStore.getState().selectedIds.size,
      imageOnlyDisplay: t('composerImageOnlyDisplay'),
      imageOnlyPrompt: t('composerImageOnlyPrompt'),
      allowMultiPage: designTaskProfileSelection?.outputMedium !== 'image'
    })
    if (promptRoute.kind === 'ignore') return false
    if (promptRoute.kind === 'attachment-unsupported') {
      setAttachmentUploadError(t('composerAttachmentModelUnsupported'))
      return false
    }
    if (promptRoute.kind === 'missing-workspace') {
      setError(t('workspaceRequiredToCreateThread'))
      return false
    }
    let resolvedProfileSelection: ResolvedDesignTaskProfileSelection | undefined
    if (designTaskProfileSelection) {
      try {
        resolvedProfileSelection = authoritativeProfile
          ? {
              ...designTaskProfileSelection,
              presetSource: authoritativeProfile.presetSource ?? (
                authoritativeProfile.preset === 'none' ? 'none' : 'explicit'
              )
            }
          : await resolveDesignTaskProfileSelection(
              designTaskProfileSelection,
              promptRoute.workspaceRoot
            )
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error))
        return false
      }
    }
    setDesignAssistantOpen(true)
    if (promptRoute.kind === 'multi-page') {
      const started = await generateDesignPages(
        promptRoute.brief,
        resolvedProfileSelection,
        authoritativeProfile
      )
      if (started) setInput('')
      return started
    }
    const {
      text: routeText,
      displayText,
      promptText,
      workspaceRoot: designWorkspaceRoot,
      attachmentIds,
      attachments
    } = promptRoute
    let provisionalDrawingId: string | null = null
    let provisionalThreadId: string | null = null
    let provisionalDrawing: PreparedDrawing | null = null
    // Captured before ensureDesignThreadForWorkspace writes a provisional
    // thread-scoped target; restored if this first send fails.
    let previousSurface: CodeCanvasDesignSurface | undefined = null
    try {
      // The drawing title comes from the user's raw description. Attachment-only
      // creation intentionally falls back to the localized untitled placeholder.
      const drawing = prepareDrawingForFirstPrompt(routeText, authoritativeProfile)
      if (!drawing) return false
      const docId = drawing.docId
      if (drawing.created) {
        provisionalDrawingId = docId
        provisionalDrawing = drawing
      }
      const dispatchState = useDesignWorkspaceStore.getState()
      const dispatchWorkspaceRoot = dispatchState.workspaceRoot || designWorkspaceRoot
      previousSurface = useCodeCanvasDesignSurface.getState().surface
      const threadId = await ensureDesignThreadForWorkspace(designWorkspaceRoot, docId)
      provisionalThreadId = drawing.created ? threadId : null
      if (!threadId) {
        if (drawing.created) await rollbackFirstPromptDrawing(drawing, undefined, previousSurface)
        return false
      }
      const currentState = useDesignWorkspaceStore.getState()
      if (
        (currentState.workspaceRoot || designWorkspaceRoot) !== dispatchWorkspaceRoot ||
        currentState.activeDocumentId !== docId
      ) {
        const message = 'Design turn was cancelled because the active workspace or drawing changed.'
        if (drawing.created) await rollbackFirstPromptDrawing(drawing, threadId, previousSurface)
        currentState.setFileError(message)
        setError(message)
        return false
      }
      const result = await submitDesignTurn({
        promptText,
        displayText,
        workspaceRoot: designWorkspaceRoot,
        source,
        sendMessage,
        resolveProviderId: (model) => providerIdForComposerModel(composerModelGroups, model),
        ...(composerModel ? { model: composerModel } : {}),
        ...(composerProviderId ? { providerId: composerProviderId } : {}),
        reasoningEffort: composerReasoningEffortRequestValue(composerReasoningEffort),
        serviceTier: currentDesignServiceTier(),
        expectedThreadId: threadId,
        // A locked task pins its board; submit resolves by id instead of
        // re-selecting the most recently updated canvas artifact.
        ...(authoritativeProfile
          ? { boardArtifactId: authoritativeProfile.documentTarget.boardArtifactId }
          : {}),
        attachmentIds,
        attachments,
        // A launcher submission starts from an empty canvas. Do not leak a
        // suppressed chip or DOM element captured from the previously open drawing.
        suppressedIds: drawing.created ? new Set<string>() : designContextSuppressedIds,
        htmlElementContext: drawing.created ? null : designHtmlElementContext,
        explicitScreenShapeId: options.screenShapeId,
        explicitSvgArtifactId: options.svgArtifactId,
        imageEditReferencePath: options.imageEditReferencePath,
        clearAutoRepairScope: clearDesignAutoRepairScope,
        ...(drawing.created ? { waitForRuntimeAdmission: true } : {}),
        ...(authoritativeProfile || designTaskProfileSelection
          ? {
              designTaskProfileForTarget: (target: DesignDocumentTarget) =>
                designProfileForTarget(target, resolvedProfileSelection, authoritativeProfile)!,
              omitDesignProfileWhenUnavailable: Boolean(authoritativeProfile)
            }
          : {})
      })
      if (result.status === 'missing-board' || result.status === 'file-error') {
        if (drawing.created) await rollbackFirstPromptDrawing(drawing, threadId, previousSurface)
        return false
      }
      if (result.status === 'sent') {
        if (drawing.created) {
          useDesignWorkspaceStore.getState().finishDrawingCreation(docId)
          provisionalDrawingId = null
          provisionalThreadId = null
          provisionalDrawing = null
        }
        clearHtmlElementContext()
        if (result.clearAttachments) clearComposerAttachments(attachmentScope)
        if (promptRoute.shouldClearInput) {
          setInput((current) => current === value ? '' : current)
        }
        return true
      }
      if (drawing.created) await rollbackFirstPromptDrawing(drawing, threadId, previousSurface)
      return false
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (provisionalDrawingId && provisionalDrawing) {
        await rollbackFirstPromptDrawing(provisionalDrawing, provisionalThreadId, previousSurface)
      }
      useDesignWorkspaceStore.getState().setFileError(message)
      setError(message)
      return false
    }
  }

  const {
    clearDesignAutoRepairScope,
    handleDesignRuntimeQualityFindings,
    handleDesignQualityRepairRequest
  } = useDesignQualityRepair({
    route,
    runtimeConnection,
    busy,
    sendDesignPrompt
  })

  return {
    sendDesignPrompt,
    clearDesignAutoRepairScope,
    handleDesignRuntimeQualityFindings,
    handleDesignQualityRepairRequest
  }
}
