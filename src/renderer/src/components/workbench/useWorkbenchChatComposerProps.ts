import { useMemo, type Dispatch, type SetStateAction } from 'react'
import type { CoreRuntimeInfoJson } from '../../agent/kun-contract'
import type { ComposerChangeSummary } from '../../lib/composer-change-summary'
import type { QueuedUserMessage } from '../../store/chat-store-types'
import { canGuideQueuedMessage } from '../../store/queued-message-guidance'
import type { WorkbenchChatStageProps } from './WorkbenchChatStage'

type ComposerProps = WorkbenchChatStageProps['composerProps']

type UseWorkbenchChatComposerPropsInput = {
  input: string
  setInput: ComposerProps['setInput']
  composerMode: ComposerProps['mode']
  setComposerMode: ComposerProps['setMode']
  busy: boolean
  route: string
  runtimeReady: boolean
  activeThreadId: string | null
  selectedContextWindowTokens: number | undefined
  runtimeInfo: CoreRuntimeInfoJson | null
  activeClawChannelId: string | null
  activeClawChannelModel: string | undefined
  composerModel: string
  composerProviderId: string | undefined
  composerPickList: ComposerProps['composerPickList']
  composerModelGroups: ComposerProps['composerModelGroups']
  composerReasoningEffort: ComposerProps['composerReasoningEffort']
  setComposerReasoningEffort: ComposerProps['onComposerReasoningEffortChange']
  setClawChannelModel: (channelId: string, modelId: string, providerId?: string) => void | Promise<unknown>
  setComposerModel: (modelId: string, providerId?: string) => void
  openProvidersSettings: () => void
  handleSend: ComposerProps['onSend']
  composerAttachments: ComposerProps['attachments']
  contextChips: ComposerProps['contextChips']
  removeContextChip: ComposerProps['onRemoveContextChip']
  attachmentUploadEnabled: boolean
  attachmentUploadBusy: boolean
  attachmentUploadError: string | null
  activeSddDraft: boolean
  composerFileReferences: ComposerProps['fileReferences']
  extraFileMentionCandidates: ComposerProps['extraFileMentionCandidates']
  webAccessAvailable: boolean
  composerExecutionSettings: ComposerProps['executionSettings']
  composerExecutionApplying: boolean
  composerChangeSummary: ComposerChangeSummary | null
  runtimeSkills: ComposerProps['skillCommands']
  disabledSkillIds: ComposerProps['disabledSkillIds']
  handlePickAttachments: NonNullable<ComposerProps['onPickAttachments']>
  handlePasteClipboardImage: NonNullable<ComposerProps['onPasteClipboardImage']>
  removeComposerAttachment: ComposerProps['onRemoveAttachment']
  addComposerFileReference: NonNullable<ComposerProps['onAddFileReference']>
  pickComposerFileReferences: () => void | Promise<unknown>
  openFileTreeSidePanel: () => void
  openDesignFileTreeSidePanel: () => void
  removeComposerFileReference: NonNullable<ComposerProps['onRemoveFileReference']>
  queuedMessages: QueuedUserMessage[]
  removeQueuedMessage: ComposerProps['onRemoveQueuedMessage']
  guideQueuedMessage: NonNullable<ComposerProps['onGuideQueuedMessage']>
  interrupt: ComposerProps['onInterrupt']
  handleGuiPlanCommand: () => void | Promise<unknown>
  useWorktreePool: boolean
  worktreeBranch: string
  setWorktreeBranch: Dispatch<SetStateAction<string>>
  setUseWorktreePool: Dispatch<SetStateAction<boolean>>
  createThread: (options: { workspaceRoot?: string; forceNew?: boolean }) => void | Promise<unknown>
  activeSkillWorkspace: string
  reviewActiveThread: NonNullable<ComposerProps['onReviewCommand']>
  updateComposerExecutionSettings: NonNullable<ComposerProps['onExecutionSettingsChange']>
  openChangesPanel: () => void
  runtimeConnectionReady: boolean
  spawnSideConversation: (seedText: string) => void | Promise<unknown>
  openSideConversationDraft: () => void
}

export function useWorkbenchChatComposerProps({
  input,
  setInput,
  composerMode,
  setComposerMode,
  busy,
  route,
  runtimeReady,
  activeThreadId,
  selectedContextWindowTokens,
  runtimeInfo,
  activeClawChannelId,
  activeClawChannelModel,
  composerModel,
  composerProviderId,
  composerPickList,
  composerModelGroups,
  composerReasoningEffort,
  setComposerReasoningEffort,
  setClawChannelModel,
  setComposerModel,
  openProvidersSettings,
  handleSend,
  composerAttachments,
  contextChips,
  removeContextChip,
  attachmentUploadEnabled,
  attachmentUploadBusy,
  attachmentUploadError,
  activeSddDraft,
  composerFileReferences,
  extraFileMentionCandidates,
  webAccessAvailable,
  composerExecutionSettings,
  composerExecutionApplying,
  composerChangeSummary,
  runtimeSkills,
  disabledSkillIds,
  handlePickAttachments,
  handlePasteClipboardImage,
  removeComposerAttachment,
  addComposerFileReference,
  pickComposerFileReferences,
  openFileTreeSidePanel,
  openDesignFileTreeSidePanel,
  removeComposerFileReference,
  queuedMessages,
  removeQueuedMessage,
  guideQueuedMessage,
  interrupt,
  handleGuiPlanCommand,
  useWorktreePool,
  worktreeBranch,
  setWorktreeBranch,
  setUseWorktreePool,
  createThread,
  activeSkillWorkspace,
  reviewActiveThread,
  updateComposerExecutionSettings,
  openChangesPanel,
  runtimeConnectionReady,
  spawnSideConversation,
  openSideConversationDraft
}: UseWorkbenchChatComposerPropsInput): ComposerProps {
  return useMemo(() => ({
    input,
    setInput,
    mode: composerMode,
    setMode: setComposerMode,
    busy,
    runtimeReady,
    hasActiveThread: Boolean(activeThreadId),
    contextWindowTokens: selectedContextWindowTokens,
    runtimeToolCount: runtimeInfo
      ? runtimeInfo.capabilities.mcp.search?.active
        ? runtimeInfo.capabilities.mcp.search.advertisedToolCount
        : runtimeInfo.capabilities.mcp.toolCount
      : undefined,
    runtimeSkillCount: runtimeInfo?.capabilities.skills.discoveredSkills,
    composerModel: route === 'claw' ? activeClawChannelModel ?? 'auto' : composerModel,
    composerProviderId: route === 'chat' ? composerProviderId : undefined,
    composerPickList,
    composerModelGroups,
    composerReasoningEffort: route === 'chat' || route === 'claw' ? composerReasoningEffort : undefined,
    modelControlVariant: route === 'chat' && !activeSddDraft ? 'split' : 'combined',
    onComposerModelChange: (modelId, providerId) => {
      if (route === 'claw' && activeClawChannelId) {
        void setClawChannelModel(activeClawChannelId, modelId, providerId)
        return
      }
      setComposerModel(modelId, providerId)
    },
    onComposerReasoningEffortChange: route === 'chat' || route === 'claw'
      ? setComposerReasoningEffort
      : undefined,
    onConfigureProviders: openProvidersSettings,
    onSend: handleSend,
    attachments: composerAttachments,
    contextChips,
    onRemoveContextChip: removeContextChip,
    attachmentUploadEnabled,
    attachmentUploadBusy,
    attachmentUploadError,
    fileReferenceEnabled: route === 'chat' && !activeSddDraft,
    fileReferences: composerFileReferences,
    extraFileMentionCandidates,
    webAccessAvailable,
    executionSettings: composerExecutionSettings,
    executionSettingsApplying: composerExecutionApplying,
    changedFiles: composerChangeSummary?.files,
    changedFileStats: composerChangeSummary,
    skillCommands: runtimeSkills,
    disabledSkillIds,
    onPickAttachments: (files) => void handlePickAttachments(files),
    onPasteClipboardImage: (options) => void handlePasteClipboardImage(options),
    onRemoveAttachment: removeComposerAttachment,
    onAddFileReference: addComposerFileReference,
    onPickFileReferences: () => void pickComposerFileReferences(),
    onOpenFileReferencePicker: openFileTreeSidePanel,
    onOpenDesignReferencePicker: openDesignFileTreeSidePanel,
    onRemoveFileReference: removeComposerFileReference,
    queuedMessages: queuedMessages.map((message) => ({
      id: message.id,
      text: message.text,
      ...(message.displayText ? { displayText: message.displayText } : {}),
      guidanceEligible: canGuideQueuedMessage(message)
    })),
    onRemoveQueuedMessage: removeQueuedMessage,
    onGuideQueuedMessage: guideQueuedMessage,
    onInterrupt: (options) => void interrupt(options),
    onPlanCommand: () => void handleGuiPlanCommand(),
    useWorktreePool,
    worktreeBranch,
    onWorktreeBranchChange: setWorktreeBranch,
    onToggleWorktreeMode: () => setUseWorktreePool((value) => !value),
    onNewCommand: () => void createThread({ workspaceRoot: activeSkillWorkspace, forceNew: true }),
    onReviewCommand: reviewActiveThread,
    onExecutionSettingsChange: updateComposerExecutionSettings,
    onOpenChanges: openChangesPanel,
    onReviewChanges: () => void reviewActiveThread({ kind: 'uncommittedChanges' }),
    reviewChangesDisabled: busy || !runtimeConnectionReady,
    onBtwCommand: (seedText) => {
      if (seedText?.trim()) {
        void spawnSideConversation(seedText)
        return
      }
      openSideConversationDraft()
    }
  }), [
    activeClawChannelId,
    activeClawChannelModel,
    activeSddDraft,
    activeSkillWorkspace,
    activeThreadId,
    addComposerFileReference,
    attachmentUploadBusy,
    attachmentUploadEnabled,
    attachmentUploadError,
    busy,
    composerAttachments,
    contextChips,
    composerChangeSummary,
    composerExecutionApplying,
    composerExecutionSettings,
    extraFileMentionCandidates,
    composerFileReferences,
    composerMode,
    composerModel,
    composerModelGroups,
    composerPickList,
    composerProviderId,
    composerReasoningEffort,
    createThread,
    disabledSkillIds,
    handleGuiPlanCommand,
    handlePasteClipboardImage,
    handlePickAttachments,
    handleSend,
    guideQueuedMessage,
    input,
    interrupt,
    openChangesPanel,
    openDesignFileTreeSidePanel,
    openFileTreeSidePanel,
    openProvidersSettings,
    openSideConversationDraft,
    pickComposerFileReferences,
    queuedMessages,
    removeComposerAttachment,
    removeContextChip,
    removeComposerFileReference,
    removeQueuedMessage,
    reviewActiveThread,
    route,
    runtimeReady,
    runtimeConnectionReady,
    runtimeInfo,
    runtimeSkills,
    selectedContextWindowTokens,
    setClawChannelModel,
    setComposerMode,
    setComposerModel,
    setComposerReasoningEffort,
    setInput,
    setUseWorktreePool,
    setWorktreeBranch,
    spawnSideConversation,
    updateComposerExecutionSettings,
    useWorktreePool,
    webAccessAvailable,
    worktreeBranch
  ])
}
