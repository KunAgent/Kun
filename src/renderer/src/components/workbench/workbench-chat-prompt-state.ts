import { useChatStore } from '../../store/chat-store'
import type { AttachmentReference } from '../../agent/types'
import type { ComposerFileReference } from '../chat/FloatingComposer'
import type { ComposerAttachmentScope } from '../workbench-composer-attachments'
import type { UseWorkbenchComposerSubmitControllerParams } from './workbench-composer-submit-types'

export function restoreWorkbenchChatPrompt(
  value: string,
  setInput: UseWorkbenchComposerSubmitControllerParams['setInput'],
  expectedThreadId: string | null
): void {
  const state = useChatStore.getState()
  // The composer state is shared across routes and threads. Never inject a
  // stale Chat draft into another route or a different conversation.
  if (state.route !== 'chat') return
  if (state.activeThreadId !== expectedThreadId) return
  setInput((current) => {
    if (!value) return current
    if (!current) return value
    if (current.trim() === value || current.startsWith(`${value}\n\n`)) return current
    return `${value}\n\n${current}`
  })
}

export function restoreChatComposerSnapshot(
  snapshot: {
    text: string
    threadId: string | null
    attachments: readonly AttachmentReference[]
    fileReferences: readonly ComposerFileReference[]
    scope: ComposerAttachmentScope
  },
  setInput: UseWorkbenchComposerSubmitControllerParams['setInput'],
  restoreComposerAttachments: UseWorkbenchComposerSubmitControllerParams['restoreComposerAttachments'],
  restoreComposerFileReferences: UseWorkbenchComposerSubmitControllerParams['restoreComposerFileReferences']
): void {
  restoreWorkbenchChatPrompt(snapshot.text, setInput, snapshot.threadId)
  if (snapshot.attachments.length > 0) {
    void restoreComposerAttachments(snapshot.attachments, snapshot.scope)
  }
  if (snapshot.fileReferences.length > 0) {
    restoreComposerFileReferences(snapshot.fileReferences)
  }
}
