import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { parseClawCommand } from '@shared/claw-commands'
import { resolveCodeAgentPersona } from '../chat/code-agent-presets'
import { parseGuiPlanCommand } from '../../plan/plan-command'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { buildComposerFileContextPrompt } from '../../lib/composer-file-references'
import { resolveCodeCanvasComposerRoute, codeCanvasAdvertisesShapeOps, codeCanvasAdvertisesExcalidraw } from '../../design/canvas/code-canvas'
import { useCanvasSelectionStore } from '../../design/canvas/canvas-selection-store'
import { activePptReviewComposerContexts } from './workbench-ppt-review-context'
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
import { sendWorkbenchWritePrompt } from './workbench-write-send'
import { mirrorWorkbenchClawCommand } from './workbench-claw-message-mirror'
import { restoreChatComposerSnapshot } from './workbench-chat-prompt-state'
import { submitWorkbenchPlanIntent } from './workbench-plan-submit'
import { buildWorkbenchClawHelpText } from './workbench-claw-help'
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
  const sendWritePrompt = useCallback((value: string): void => sendWorkbenchWritePrompt({
    activeThreadId, attachmentUploadEnabled, composerAttachments, composerMode, composerModel, composerProviderId,
    composerModelGroups, composerReasoningEffort, composerFastMode, getAttachmentScope, removeComposerAttachments,
    sendMessage, setAttachmentUploadError, setError, setInput,
    t: (key, options) => t(key, options), workspaceRoot
  }, value), [
    attachmentUploadEnabled,
    activeThreadId,
    removeComposerAttachments,
    composerAttachments,
    composerMode,
    composerModel,
    composerModelGroups,
    composerProviderId,
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
      const attachments = route === 'chat' || route === 'ade' || route === 'write' ? composerAttachments : []
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
      if (route === 'chat') clearComposerFileReferences()
      let outboundText = prepared.text
      let outboundDisplay = prepared.displayText
      let outboundGuiDesignCanvas = false, outboundGuiExcalidrawCanvas = false
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
        const codeWorkspace = threads.find((thread) => thread.id === activeThreadId)?.workspace || workspaceRoot
        outboundGuiDesignCanvas = await codeCanvasAdvertisesShapeOps(codeWorkspace, activeThreadId)
        outboundGuiExcalidrawCanvas = await codeCanvasAdvertisesExcalidraw(codeWorkspace, activeThreadId)
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
        ...(outboundGuiDesignCanvas ? { guiDesignCanvas: true } : outboundGuiExcalidrawCanvas ? { guiExcalidrawCanvas: true } : {}),
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
