import type { QueuedUserMessage } from './chat-store-types'

type EditableQueuedMessage = Pick<QueuedUserMessage,
  | 'steeringRequest'
  | 'text'
  | 'displayText'
  | 'deliveryState'
  | 'deliveryTurnId'
  | 'deliveryUserMessageItemId'
  | 'waitForRuntimeAdmission'
  | 'mode'
  | 'persona'
  | 'accountId'
  | 'orchestration'
  | 'agentSurface'
  | 'subagentResume'
  | 'messageSource'
  | 'attachmentIds'
  | 'attachments'
  | 'fileReferences'
  | 'composerContexts'
  | 'guiPlan'
  | 'guiDesignCanvas'
  | 'guiDesignMode'
  | 'guiDesignArtifact'
  | 'designProfile'
  | 'designDocumentTarget'
  | 'designImagePlacementTarget'
  | 'writeContext'
  | 'approvalPolicy'
  | 'sandboxMode'
  | 'approvalReviewer'
>

export type QueueEditBlockReason = 'queuedMessageConfirming' | 'queuedMessageEditSteering' | 'queuedMessageEditUnsupported'

export function queuedMessageEditBlockReason(message: EditableQueuedMessage): QueueEditBlockReason | undefined {
  if (message.steeringRequest) return 'queuedMessageEditSteering'
  if (message.waitForRuntimeAdmission) return 'queuedMessageConfirming'
  if (
    message.deliveryState !== undefined &&
    message.deliveryState !== 'pending' &&
    message.deliveryState !== 'in_flight' &&
    message.deliveryState !== 'paused' &&
    message.deliveryState !== 'failed'
  ) return 'queuedMessageConfirming'
  if (message.persona || message.guiPlan || message.orchestration === 'graph') return 'queuedMessageEditUnsupported'
  if (message.attachmentIds?.some((id) => !message.attachments?.some((attachment) => attachment.id === id))) return 'queuedMessageEditUnsupported'
  if (message.agentSurface === 'write' || message.agentSurface === 'design') return 'queuedMessageEditUnsupported'
  if (
    message.subagentResume || message.messageSource ||
    message.fileReferences?.length || message.composerContexts?.length ||
    message.guiDesignCanvas || message.guiDesignMode ||
    message.guiDesignArtifact || message.designProfile || message.designDocumentTarget ||
    message.designImagePlacementTarget || message.writeContext
  ) return 'queuedMessageEditUnsupported'
  // Document content is already inlined into the text prompt and cannot be
  // faithfully rebuilt as a composer attachment.
  if (message.attachments?.some((attachment) => attachment.kind === 'document')) return 'queuedMessageEditUnsupported'
  return message.text.trim() || message.attachments?.length || message.attachmentIds?.length
    ? undefined : 'queuedMessageEditUnsupported'
}

/** Account routing is checked separately against the live model catalog. */
export function canRestoreQueuedMessageToComposer(message: EditableQueuedMessage): boolean {
  return queuedMessageEditBlockReason(message) === undefined
}

/** Composer text for a restore: image-only messages carry a synthesized prompt as `text`. */
export function queuedMessageComposerRestoreText(message: EditableQueuedMessage): string {
  if (message.displayText !== undefined && message.displayText !== message.text) {
    // Plan/auto queued messages store the user's original request in
    // `displayText` while `text` holds the internal plan prompt; restore the
    // original. Image-only messages synthesize a prompt in `text`, so keep
    // those empty and rely on the restored attachments.
    if (message.mode === 'plan' || message.mode === 'auto') return message.displayText
    return ''
  }
  return message.text
}

export function restoreQueuedMessageFromQueue(
  messages: QueuedUserMessage[],
  id: string
): { messages: QueuedUserMessage[]; restored: QueuedUserMessage | null } {
  const current = messages.find((message) => message.id === id)
  if (!current || !canRestoreQueuedMessageToComposer(current)) {
    return { messages, restored: null }
  }
  return { messages: messages.filter((message) => message.id !== id), restored: current }
}
