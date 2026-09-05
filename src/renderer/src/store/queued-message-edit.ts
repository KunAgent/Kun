import type { QueuedUserMessage } from './chat-store-types'

type EditableQueuedMessage = Pick<QueuedUserMessage,
  | 'text'
  | 'displayText'
  | 'deliveryState'
  | 'deliveryTurnId'
  | 'deliveryUserMessageItemId'
  | 'waitForRuntimeAdmission'
  | 'mode'
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

/** True when the whole queued payload (text + image attachments) can be faithfully returned to the composer. */
export function canRestoreQueuedMessageToComposer(message: EditableQueuedMessage): boolean {
  if (
    message.deliveryState !== undefined &&
    message.deliveryState !== 'pending' &&
    message.deliveryState !== 'in_flight' &&
    message.deliveryState !== 'paused' &&
    message.deliveryState !== 'failed'
  ) return false
  if (message.waitForRuntimeAdmission) return false
  if (message.agentSurface === 'write' || message.agentSurface === 'design') return false
  if (
    message.subagentResume || message.messageSource ||
    message.fileReferences?.length || message.composerContexts?.length ||
    message.guiDesignCanvas || message.guiDesignMode ||
    message.guiDesignArtifact || message.designProfile || message.designDocumentTarget ||
    message.designImagePlacementTarget || message.writeContext
  ) return false
  // Document content is already inlined into the text prompt and cannot be
  // faithfully rebuilt as a composer attachment.
  if (message.attachments?.some((attachment) => attachment.kind === 'document')) return false
  return Boolean(message.text.trim() || message.attachments?.length || message.attachmentIds?.length)
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
