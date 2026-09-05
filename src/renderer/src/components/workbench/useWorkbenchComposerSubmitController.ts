import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { providerIdForComposerModel } from '../../store/chat-store-helpers'
import { parseClawCommand } from '@shared/claw-commands'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { captureWriteDocumentContext, writeDocumentContextMatches } from '../../write/write-document-context'
import type { WriteRetrievalContext } from '@shared/write-retrieval'
import type { WriteOfficeDocumentContext } from '../../write/quoted-selection'
import { writeDocumentKey } from '../../write/write-editor-layout'
import { selectFocusedPresentationView } from '../../write/write-presentation-view-state'
import { createWorkspaceOfficeViewPositionAttachment } from '../../lib/workspace-office-view-context'
import {
  loadWriteOfficeSemanticContext,
  writeOfficeSemanticContextMatches
} from '../../write/write-office-semantic-context'
import { resolveWriteAgentPreset } from '../../write/agent-presets'
import { createWriteTurnReferenceAttachments, mergeWriteComposerContexts } from '../../write/write-turn-reference-context'
import { recoverWriteReferenceContextError } from '../../write/write-reference-context-error'
import { resolveCodeAgentPersona } from '../chat/code-agent-presets'
import { parseGuiPlanCommand } from '../../plan/plan-command'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { buildComposerFileContextPrompt } from '../../lib/composer-file-references'
import { resolveCodeCanvasComposerRoute } from '../../design/canvas/code-canvas'
import { useCanvasSelectionStore } from '../../design/canvas/canvas-selection-store'
import { consumeLastCanvasOpErrors } from '../../design/canvas/apply-shape-ops'
import { activePptReviewComposerContexts } from './workbench-ppt-review-context'
import {
  activeWorkWhiteboardForSend,
  activeWorkWhiteboardComposerContexts,
  workWhiteboardMessageFence,
  workWhiteboardSnapshotMatches
} from './workbench-write-whiteboard-context'
import { composerReasoningEffortRequestValue } from '../chat/FloatingComposerModelPicker'
import { serviceTierForComposerSelection } from '../chat/composer-fast-mode'
import type { ComposerFileReference } from '../chat/FloatingComposer'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import {
  buildComposerDocumentContextPrompt,
  composerReferencesToUserFileReferences,
  stripTransientAttachmentFields
} from './workbench-composer-prompts'
import { readWorkbenchComposerFileContextEntries } from './workbench-composer-file-context'
import { mirrorWorkbenchClawCommand } from './workbench-claw-message-mirror'
import { restoreWorkbenchWritePrompt } from './workbench-write-prompt-state'
import { restoreChatComposerSnapshot } from './workbench-chat-prompt-state'
import { workbenchWriteSourceContext } from './workbench-write-source-reference'
import { submitWorkbenchPlanIntent } from './workbench-plan-submit'
import { buildWorkbenchClawHelpText } from './workbench-claw-help'
import { readWriteDocumentSha256 } from './read-write-document-sha256'
export type { WorkbenchComposerSubmitController } from './workbench-composer-submit-types'
import {
  listClawComposerModelOptions,
  resolveClawComposerModelByIndex,
  type UseWorkbenchComposerSubmitControllerParams,
  type WorkbenchComposerSubmitController
} from './workbench-composer-submit-types'
export function useWorkbenchComposerSubmitController({
  activeClawChannelId,
  activeClawChannelModel,
  activeClawChannelProviderId,
  activeSddDraft,
  activeThreadId,
  taskSurface = 'code',
  attachmentUploadEnabled,
  buildCodeCanvasOutboundPrompt,
  clearComposerAttachments,
  removeComposerAttachments,
  clearComposerFileReferences,
  restoreComposerAttachments, restoreComposerFileReferences,
  composerAttachments,
  composerFileReferences,
  composerMode,
  composerModel,
  composerProviderId,
  composerModelGroups,
  composerReasoningEffort,
  composerFastMode,
  getAttachmentScope,
  handleGuiPlanCommand,
  input,
  resetClawChannelSession,
  requestAutoPlanBuild,
  rightPanelMode,
  route,
  selectClawChannel,
  sendMessage,
  sendPlanTurn,
  sendSddAssistantPrompt,
  setAttachmentUploadError,
  setClawChannelModel,
  setError,
  setInput,
  threads,
  workspaceRoot,
  appendLocalClawTurn
}: UseWorkbenchComposerSubmitControllerParams): WorkbenchComposerSubmitController {
  const { t } = useTranslation('common')
  const mirrorClawCommand = useCallback(
    (userText: string, replyText: string) => mirrorWorkbenchClawCommand(activeThreadId, userText, replyText),
    [activeThreadId]
  )
  const clawHelpText = useCallback(() => buildWorkbenchClawHelpText(t), [t])

  const clawModelListText = useCallback((): string => {
    const options = listClawComposerModelOptions(composerModelGroups)
    const currentProvider = activeClawChannelProviderId?.trim() ?? ''
    const currentModel = activeClawChannelModel?.trim() || 'auto'
    const rows = options.map((option, index) => {
      const marker = option.providerId === currentProvider && option.model === currentModel ? '*' : '-'
      return `${marker} ${index + 1}. \`${option.model}\` · provider \`${option.providerId}\``
    })
    return [
      t('clawModelCurrentWithProvider', {
        provider: currentProvider || 'auto',
        model: currentModel
      }),
      ...(rows.length > 0
        ? [
            t('clawModelAvailableList'),
            ...rows,
            t('clawModelSwitchHint')
          ]
        : [t('clawModelListEmpty')])
    ].join('\n')
  }, [activeClawChannelModel, activeClawChannelProviderId, composerModelGroups, t])
  const readComposerFileContextEntries = useCallback(async (
    references: ComposerFileReference[],
    workspace: string
  ) => readWorkbenchComposerFileContextEntries(
    references,
    workspace,
    (key, options) => t(key, options)
  ), [t])
  const sendWritePrompt = useCallback((value: string): void => {
    const v = value.trim()
    const attachmentScope = getAttachmentScope()
    const attachments = composerAttachments
    const documentAttachments = attachments.filter((attachment) => attachment.kind === 'document')
    const attachmentIds = attachments.map((attachment) => attachment.id)
    const publicAttachments = stripTransientAttachmentFields(attachments)
    if (!v && attachmentIds.length === 0 && documentAttachments.length === 0) return
    if (attachmentIds.length > 0 && !attachmentUploadEnabled) {
      setAttachmentUploadError(t('composerAttachmentModelUnsupported'))
      return
    }
    const writeState = useWriteWorkspaceStore.getState()
    const activeWhiteboard = activeWorkWhiteboardForSend(writeState)
    if (activeWhiteboard === undefined) {
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
    const writeSource = workbenchWriteSourceContext(
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
    const restorePrompt = (): void => restoreWorkbenchWritePrompt(v, setInput)
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
    void (async () => {
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
      const retrievalQuery = v.trim()
      let retrieval: WriteRetrievalContext | null = null
      if (retrievalQuery && typeof window.kunGui?.retrieveWriteContext === 'function') {
        try {
          const result = await window.kunGui.retrieveWriteContext({
            workspaceRoot: writeWorkspaceRoot,
            currentFilePath: writeActiveFilePath ?? undefined,
            query: retrievalQuery,
            maxSnippets: 4,
            includeCurrentFile: quotedSelections.length === 0
          })
          if (result.ok) retrieval = result.context
        } catch (error) {
          void window.kunGui?.logError?.('write-retrieval', 'Failed to retrieve write context', {
            message: error instanceof Error ? error.message : String(error)
          })
        }
      }
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
      const messageText = v || (
        documentAttachments.length > 0 ? t('composerFileOnlyPrompt') : t('composerImageOnlyPrompt')
      )
      const activeAgentPreset = writeState.agentPresets.find(
        (preset) => preset.id === writeState.assistantAgentPresetId
      )
      const agentPersona = activeAgentPreset ? resolveWriteAgentPreset(activeAgentPreset).persona : ''
      const model = writeState.assistantModel.trim()
      const providerId =
        writeState.assistantProviderId.trim() || providerIdForComposerModel(composerModelGroups, model)
      const reasoningEffort = composerReasoningEffortRequestValue(composerReasoningEffort)
      const serviceTier = serviceTierForComposerSelection(
        composerFastMode,
        composerModelGroups,
        model,
        providerId
      )
      let composerContexts: ReturnType<typeof mergeWriteComposerContexts>
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
          query: v
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
      const sent = await sendMessage(
        messageText,
        writeActiveDocument?.kind === 'office' ? 'agent' : composerMode === 'plan' ? 'plan' : 'agent',
        {
          ...(!v && documentAttachments.length > 0
            ? { displayText: t('composerFileOnlyDisplay', { count: documentAttachments.length }) }
            : !v && attachmentIds.length > 0
              ? { displayText: t('composerImageOnlyDisplay') }
              : {}),
          ...(model ? { model } : {}),
          ...(providerId ? { providerId } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
          ...(serviceTier ? { serviceTier } : {}),
          ...(attachmentIds.length ? { attachmentIds } : {}),
          ...(publicAttachments.length ? { attachments: publicAttachments } : {}),
          ...(composerContexts.length ? { composerContexts } : {}),
          ...(writeSource.fileReference ? { fileReferences: [writeSource.fileReference] } : {}),
          ...(activeWhiteboard ? { guiDesignCanvas: true } : {}),
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
        // Only after the turn is admitted can the previous canvas-op errors be
        // treated as consumed; a rejected/aborted send must keep them visible.
        if (activeWhiteboard) consumeLastCanvasOpErrors(`work-canvas:${activeWhiteboard.id}`)
      } else {
        restorePrompt()
      }
    })()
  }, [
    attachmentUploadEnabled,
    activeThreadId,
    removeComposerAttachments,
    composerAttachments,
    composerMode,
    composerModelGroups,
    composerFastMode,
    composerReasoningEffort,
    getAttachmentScope,
    sendMessage,
    setAttachmentUploadError,
    setError,
    setInput,
    t,
    workspaceRoot
  ])
  const handleSend = useCallback((): void => {
    void (async (): Promise<void> => {
      const v = input.trim()
      const attachmentScope = getAttachmentScope()
      const attachments = route === 'chat' || route === 'write' ? composerAttachments : []
      const documentAttachments = attachments.filter((attachment) => attachment.kind === 'document')
      const attachmentIds = attachments.map((attachment) => attachment.id)
      const publicAttachments = stripTransientAttachmentFields(attachments)
      const fileReferences = route === 'chat' ? composerFileReferences : []
      const userFileReferences = composerReferencesToUserFileReferences(fileReferences)
      const reasoningEffort = composerReasoningEffortRequestValue(composerReasoningEffort)
      const serviceTier = route === 'chat'
        ? serviceTierForComposerSelection(
            composerFastMode,
            composerModelGroups,
            composerModel,
            composerProviderId
          )
        : undefined
      if (!v && attachmentIds.length === 0 && documentAttachments.length === 0 && fileReferences.length === 0) return
      if (attachmentIds.length > 0 && !attachmentUploadEnabled) {
        setAttachmentUploadError(t('composerAttachmentModelUnsupported'))
        return
      }
      const contextAttachmentCount = fileReferences.length + documentAttachments.length
      const emptyPrompt =
        contextAttachmentCount > 0 && attachmentIds.length > 0
          ? t('composerFileAndImageOnlyPrompt')
          : contextAttachmentCount > 0
            ? t('composerFileOnlyPrompt')
            : t('composerImageOnlyPrompt')
      const emptyDisplayText = v
        ? undefined
        : contextAttachmentCount > 0 && attachmentIds.length > 0
          ? t('composerFileAndImageOnlyDisplay', { count: contextAttachmentCount })
          : contextAttachmentCount > 0
            ? t('composerFileOnlyDisplay', { count: contextAttachmentCount })
            : t('composerImageOnlyDisplay')
      const messageText = buildComposerDocumentContextPrompt(v || emptyPrompt, documentAttachments)
      const prepareChatMessage = async (): Promise<{ text: string; displayText?: string } | null> => {
        if (fileReferences.length === 0) {
          return {
            text: messageText,
            ...(emptyDisplayText ? { displayText: emptyDisplayText } : {})
          }
        }
        const workspace = normalizeWorkspaceRoot(
          threads.find((thread) => thread.id === activeThreadId)?.workspace || workspaceRoot
        )
        if (!workspace) {
          setError(t('workspaceRequiredToCreateThread'))
          return null
        }
        try {
          const fileContext = await readComposerFileContextEntries(fileReferences, workspace)
          const displayText = v || emptyDisplayText
          return {
            text: buildComposerFileContextPrompt(messageText, fileContext),
            ...(displayText ? { displayText } : {})
          }
        } catch (error) {
          setError(error instanceof Error ? error.message : String(error))
          return null
        }
      }

      if (activeSddDraft && rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.sddAi) {
        void sendSddAssistantPrompt(v)
        return
      }
      const planCommand = parseGuiPlanCommand(v)
      if (planCommand) {
        setInput('')
        void handleGuiPlanCommand(planCommand.kind === 'create' ? planCommand.request : undefined)
        return
      }
      if (route === 'chat' && (composerMode === 'plan' || composerMode === 'auto')) {
        const prepared = await prepareChatMessage()
        if (!prepared) return
        await submitWorkbenchPlanIntent({
          mode: composerMode,
          text: prepared.text,
          overrides: {
            agentSurface: taskSurface,
            ...(prepared.displayText ? { displayText: prepared.displayText } : {}), ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(serviceTier ? { serviceTier } : {}), ...(attachmentIds.length ? { attachmentIds } : {}),
            ...(publicAttachments.length ? { attachments: publicAttachments } : {}), ...(userFileReferences.length ? { fileReferences: userFileReferences } : {})
          },
          sendPlanTurn,
          requestAutoPlanBuild,
          consumeComposer: () => { setInput(''); clearComposerAttachments(attachmentScope); clearComposerFileReferences() },
          restoreComposer: () => restoreChatComposerSnapshot({ text: v, threadId: activeThreadId, attachments, fileReferences, scope: attachmentScope }, setInput, restoreComposerAttachments, restoreComposerFileReferences),
        })
        return
      }
      if (route === 'write') {
        sendWritePrompt(v)
        return
      }
      if (route === 'claw') {
        const command = parseClawCommand(v)
        if (command?.kind === 'clear') {
          if (!activeClawChannelId) {
            setError(t('clawNoActiveIm'))
            return
          }
          setInput('')
          void (async () => {
            await resetClawChannelSession(activeClawChannelId)
            const replyText = t('clawNewSessionStarted')
            appendLocalClawTurn(v, replyText)
            await mirrorClawCommand(v, replyText)
          })()
          return
        }
        if (command?.kind === 'help') {
          setInput('')
          const replyText = clawHelpText()
          appendLocalClawTurn(v, replyText)
          void mirrorClawCommand(v, replyText)
          return
        }
        if (command?.kind === 'model') {
          if (!activeClawChannelId) {
            setError(t('clawNoActiveIm'))
            return
          }
          setInput('')
          const resolved = resolveClawComposerModelByIndex(composerModelGroups, command.model)
          if (!resolved) {
            const replyText = t('clawModelInvalidNumber', { value: command.model })
            appendLocalClawTurn(v, replyText)
            void mirrorClawCommand(v, replyText)
            return
          }
          void (async () => {
            await setClawChannelModel(activeClawChannelId, resolved.model, resolved.providerId)
            const replyText = t('clawModelChangedWithProvider', {
              model: resolved.model,
              provider: resolved.providerId
            })
            appendLocalClawTurn(v, replyText)
            await mirrorClawCommand(v, replyText)
          })()
          return
        }
        if (command?.kind === 'showModel') {
          if (!activeClawChannelId) {
            setError(t('clawNoActiveIm'))
            return
          }
          setInput('')
          const replyText = clawModelListText()
          appendLocalClawTurn(v, replyText)
          void mirrorClawCommand(v, replyText)
          return
        }
        if (!activeClawChannelId) {
          setError(t('clawNoActiveIm'))
          return
        }
        setInput('')
        void (async () => {
          const taskResult = typeof window.kunGui?.createClawTaskFromText === 'function'
            ? await window.kunGui.createClawTaskFromText(v, {
                channelId: activeClawChannelId,
                modelHint: activeClawChannelModel,
                ...(reasoningEffort ? { reasoningEffort } : {}),
                mode: composerMode === 'plan' ? 'plan' : 'agent'
              })
            : { kind: 'noop' as const }
          if (taskResult.kind === 'created') {
            appendLocalClawTurn(v, taskResult.confirmationText)
            await mirrorClawCommand(v, taskResult.confirmationText)
            return
          }
          if (taskResult.kind === 'error') {
            appendLocalClawTurn(v, `Failed to create scheduled task: ${taskResult.message}`)
            return
          }
          if (!activeThreadId) {
            await selectClawChannel(activeClawChannelId)
            await useChatStore.getState().sendMessage(v, composerMode === 'plan' ? 'plan' : 'agent', {
              ...(reasoningEffort ? { reasoningEffort } : {})
            })
            return
          }
          await sendMessage(v, composerMode === 'plan' ? 'plan' : 'agent', {
            ...(reasoningEffort ? { reasoningEffort } : {})
          })
        })()
        return
      }
      const prepared = await prepareChatMessage()
      if (!prepared) return
      setInput('')
      clearComposerAttachments(attachmentScope)
      clearComposerFileReferences()
      let outboundText = prepared.text
      let outboundDisplay = prepared.displayText
      let outboundGuiDesignCanvas = false
      const codeCanvasRoute = resolveCodeCanvasComposerRoute({
        route,
        composerMode,
        userText: v,
        preparedText: prepared.text,
        preparedDisplayText: prepared.displayText,
        emptyPrompt,
        whiteboardOpen: rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.canvas,
        hasSelection: useCanvasSelectionStore.getState().selectedIds.size > 0
      })
      if (codeCanvasRoute) {
        outboundText = await buildCodeCanvasOutboundPrompt({
          baseText: codeCanvasRoute.baseText,
          canvasBrief: codeCanvasRoute.canvasBrief
        })
        outboundDisplay = codeCanvasRoute.displayText
        outboundGuiDesignCanvas = true
      }
      const pptReviewContexts = route === 'chat'
        ? await activePptReviewComposerContexts(workspaceRoot, activeThreadId)
        : []
      const chatState = useChatStore.getState()
      const persona = chatState.composerPersonaEnabled
        ? resolveCodeAgentPersona(
            chatState.codeAgentPresets,
            chatState.composerPersonaId
          )
        : ''
      void sendMessage(outboundText, composerMode === 'plan' ? 'plan' : 'agent', {
        agentSurface: taskSurface,
        ...(outboundDisplay ? { displayText: outboundDisplay } : {}),
        ...(outboundGuiDesignCanvas ? { guiDesignCanvas: true } : {}),
        ...(persona ? { persona } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(serviceTier ? { serviceTier } : {}),
        ...(attachmentIds.length ? { attachmentIds } : {}),
        ...(publicAttachments.length ? { attachments: publicAttachments } : {}),
        ...(userFileReferences.length ? { fileReferences: userFileReferences } : {}),
        ...(pptReviewContexts.length ? { composerContexts: pptReviewContexts } : {})
      })
    })()
  }, [
    activeClawChannelId,
    activeClawChannelModel,
    activeSddDraft,
    activeThreadId,
    taskSurface,
    appendLocalClawTurn,
    attachmentUploadEnabled,
    buildCodeCanvasOutboundPrompt,
    clawHelpText,
    clearComposerAttachments,
    clearComposerFileReferences,
    restoreComposerAttachments, restoreComposerFileReferences,
    clawModelListText,
    composerAttachments,
    composerFileReferences,
    composerFastMode,
    composerMode,
    composerModel,
    composerModelGroups,
    composerProviderId,
    composerReasoningEffort,
    getAttachmentScope,
    handleGuiPlanCommand,
    input,
    mirrorClawCommand,
    readComposerFileContextEntries,
    resetClawChannelSession,
    requestAutoPlanBuild,
    rightPanelMode,
    route,
    selectClawChannel,
    sendMessage,
    sendPlanTurn,
    sendSddAssistantPrompt,
    sendWritePrompt,
    setAttachmentUploadError,
    setClawChannelModel,
    setError,
    setInput,
    t,
    threads,
    workspaceRoot
  ])
  return { handleSend, sendWritePrompt }
}
