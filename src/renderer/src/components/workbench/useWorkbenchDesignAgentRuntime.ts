import {
  useDesignCodeRoundtripActions,
  type DesignCodeRoundtripActionsOptions
} from '../design/useDesignCodeRoundtripActions'
import {
  useDesignPromptController,
  type DesignPromptControllerOptions
} from '../design/useDesignPromptController'
import {
  useDesignThreadBinding,
  type DesignThreadBindingOptions
} from '../design/useDesignThreadBinding'
import {
  useCodeCanvasPromptController,
  type CodeCanvasPromptControllerOptions
} from '../design/canvas/useCodeCanvasPromptController'
import { useAgentDesignRequestDispatch } from './useAgentDesignRequestDispatch'
import type { DesignTaskComposerProfile } from '../chat/FloatingComposerTaskProfile'

type WorkbenchDesignAgentRuntimeOptions = {
  activeCodeCanvasWorkspace: CodeCanvasPromptControllerOptions['activeCodeCanvasWorkspace']
  activeDocumentId: DesignThreadBindingOptions['activeDocumentId']
  activeThreadId: DesignThreadBindingOptions['activeThreadId']
  attachmentUploadEnabled: DesignPromptControllerOptions['attachmentUploadEnabled']
  busy: DesignPromptControllerOptions['busy']
  clearHtmlElementContext: DesignPromptControllerOptions['clearHtmlElementContext']
  clearComposerAttachments: DesignPromptControllerOptions['clearComposerAttachments']
  composerAttachments: DesignPromptControllerOptions['composerAttachments']
  composerModelGroups: DesignPromptControllerOptions['composerModelGroups']
  composerReasoningEffort: CodeCanvasPromptControllerOptions['composerReasoningEffort']
  composerFastMode: DesignPromptControllerOptions['composerFastMode']
  composerModel?: DesignPromptControllerOptions['composerModel']
  composerProviderId?: DesignPromptControllerOptions['composerProviderId']
  designContextSuppressedIds: DesignPromptControllerOptions['designContextSuppressedIds']
  designHtmlElementContext: DesignPromptControllerOptions['designHtmlElementContext']
  designWorkspaceRoot: DesignThreadBindingOptions['designWorkspaceRoot']
  clearDesignHistory: DesignPromptControllerOptions['clearDesignHistory']
  rollbackProvisionalThread?: DesignPromptControllerOptions['rollbackProvisionalThread']
  designTaskProfileSelection?: DesignPromptControllerOptions['designTaskProfileSelection']
  /** Draft profile used when the Code agent starts a Design pass with `design_open`. */
  agentDesignTaskProfile?: DesignTaskComposerProfile
  lockedDesignProfile?: DesignPromptControllerOptions['lockedDesignProfile']
  expectedThreadId?: DesignPromptControllerOptions['expectedThreadId']
  imageGenerationAvailable?: DesignPromptControllerOptions['imageGenerationAvailable']
  imageGenerationReason?: DesignPromptControllerOptions['imageGenerationReason']
  ensureDesignThreadForWorkspace: DesignPromptControllerOptions['ensureDesignThreadForWorkspace']
  getAttachmentScope: DesignPromptControllerOptions['getAttachmentScope']
  clearActiveThreadSelection: DesignThreadBindingOptions['clearActiveThreadSelection']
  openDesign: DesignCodeRoundtripActionsOptions['openDesign']
  rightPanelMode: CodeCanvasPromptControllerOptions['rightPanelMode']
  route: DesignThreadBindingOptions['route']
  runtimeConnection: DesignPromptControllerOptions['runtimeConnection']
  selectThread: DesignThreadBindingOptions['selectThread']
  sendMessage: DesignPromptControllerOptions['sendMessage']
  setAttachmentUploadError: DesignPromptControllerOptions['setAttachmentUploadError']
  setConnectPhoneSidebarOpen: DesignCodeRoundtripActionsOptions['setConnectPhoneSidebarOpen']
  setDesignAssistantOpen: DesignPromptControllerOptions['setDesignAssistantOpen']
  setError: DesignPromptControllerOptions['setError']
  setInput: DesignPromptControllerOptions['setInput']
  setRightPanelMode: CodeCanvasPromptControllerOptions['setRightPanelMode']
  threads: DesignThreadBindingOptions['threads']
  workspaceRoot: DesignThreadBindingOptions['workspaceRoot']
  createThread: DesignCodeRoundtripActionsOptions['createThread']
}

export function useWorkbenchDesignAgentRuntime({
  activeCodeCanvasWorkspace,
  activeDocumentId,
  activeThreadId,
  attachmentUploadEnabled,
  busy,
  clearHtmlElementContext,
  clearComposerAttachments,
  composerAttachments,
  composerModelGroups,
  composerReasoningEffort,
  composerFastMode,
  composerModel,
  composerProviderId,
  createThread,
  designContextSuppressedIds,
  designHtmlElementContext,
  designWorkspaceRoot,
  clearDesignHistory,
  rollbackProvisionalThread,
  designTaskProfileSelection,
  agentDesignTaskProfile,
  lockedDesignProfile,
  expectedThreadId,
  imageGenerationAvailable,
  imageGenerationReason,
  ensureDesignThreadForWorkspace,
  getAttachmentScope,
  clearActiveThreadSelection,
  openDesign,
  rightPanelMode,
  route,
  runtimeConnection,
  selectThread,
  sendMessage,
  setAttachmentUploadError,
  setConnectPhoneSidebarOpen,
  setDesignAssistantOpen,
  setError,
  setInput,
  setRightPanelMode,
  threads,
  workspaceRoot
}: WorkbenchDesignAgentRuntimeOptions) {
  const {
    designThreads,
    designHistoryThreadIds,
    hasRegisteredHistory,
    switchDesignThread
  } = useDesignThreadBinding({
    threads,
    workspaceRoot,
    designWorkspaceRoot,
    activeDocumentId,
    activeThreadId,
    route,
    selectThread,
    clearActiveThreadSelection
  })
  const designCodeRoundtrip = useDesignCodeRoundtripActions({
    workspaceRoot,
    createThread,
    sendMessage,
    setError,
    setConnectPhoneSidebarOpen,
    openDesign
  })
  const codeCanvasPrompt = useCodeCanvasPromptController({
    rightPanelMode,
    setRightPanelMode,
    activeCodeCanvasWorkspace,
    activeThreadId,
    composerReasoningEffort,
    sendMessage,
    setError
  })
  const designPrompt = useDesignPromptController({
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
  })
  useAgentDesignRequestDispatch({
    activeThreadId,
    busy,
    runtimeConnection,
    threads,
    workspaceRoot,
    profile: agentDesignTaskProfile,
    imageGenerationAvailable,
    sendDesignPrompt: designPrompt.sendDesignPrompt
  })

  return {
    ...designCodeRoundtrip,
    ...codeCanvasPrompt,
    ...designPrompt,
    designThreads,
    designHistoryThreadIds,
    hasRegisteredHistory,
    switchDesignThread
  }
}
