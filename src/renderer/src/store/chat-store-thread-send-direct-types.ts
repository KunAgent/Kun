import type { ComposerContextAttachment } from '@kun/extension-api'
import type { AgentProvider } from '../agent/types'
import type {
  ChatState,
  QueuedUserMessage,
  WriteAssistantMessageContext
} from './chat-store-types'
import type {
  StoreActionContext,
  ThreadActionRuntime
} from './chat-store-thread-actions-support'

export type PreparedThreadSend = {
  context: StoreActionContext
  runtime: ThreadActionRuntime
  provider: AgentProvider
  trimmedText: string
  mode: Parameters<ChatState['sendMessage']>[1]
  overrides: Parameters<ChatState['sendMessage']>[2]
  queued: QueuedUserMessage | undefined
  clientRequestId: string
  expectedThreadId: string
  requestedAgentSurface: QueuedUserMessage['agentSurface']
  designProfile: QueuedUserMessage['designProfile']
  designDocumentTarget: QueuedUserMessage['designDocumentTarget']
  designImagePlacementTarget: QueuedUserMessage['designImagePlacementTarget']
  messageSource: QueuedUserMessage['messageSource']
  expectedThreadStillActive: () => boolean
  writeContext: WriteAssistantMessageContext | undefined
  now: number
  userBlockId: string
  attachmentIds: string[]
  attachments: NonNullable<QueuedUserMessage['attachments']>
  fileReferences: NonNullable<QueuedUserMessage['fileReferences']>
  composerContexts: ComposerContextAttachment[]
  activeThreadId: string | null
  displayText: string
  userDisplayText: string | undefined
  generatedTitle: string
  shouldAutoRenameForRoute: boolean
  shouldRenameThreadAfterSend: boolean
  composerModel: string
  composerProviderId: string
  composerAccountId: string
  reasoningEffort: string | undefined
  serviceTier: QueuedUserMessage['serviceTier']
  guiDesignCanvas: boolean
  guiExcalidrawCanvas: boolean
  guiDesignMode: boolean
  persona: string
  orchestration: NonNullable<QueuedUserMessage['orchestration']>
  userModelChip: string | undefined
  submittedMessageForQueue: QueuedUserMessage
}
