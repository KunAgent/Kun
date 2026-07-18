import type { QueuedUserMessage } from './chat-store-types'

/** True when the text-only steer contract can preserve the whole queued payload. */
export function canGuideQueuedMessage(message: QueuedUserMessage): boolean {
  return Boolean(
    message.text.trim() &&
    message.mode !== 'plan' &&
    !message.attachmentIds?.length &&
    !message.attachments?.length &&
    !message.fileReferences?.length &&
    !message.composerContexts?.length &&
    !message.guiPlan &&
    message.guiDesignCanvas !== true &&
    message.guiDesignMode !== true &&
    !message.guiDesignArtifact &&
    !message.writeContext
  )
}
