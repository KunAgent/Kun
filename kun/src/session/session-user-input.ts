import type { AttachmentStore } from '../attachments/attachment-store.js'
import type { UserFileReference, UserTurnItem } from '../contracts/items.js'
import { userMessageTextWithComposerContexts } from '../domain/composer-context.js'
import { resolveAcpDocuments } from '../runtime/acp/acp-attachment-documents.js'
import { resolveAcpImages } from '../runtime/acp/acp-runtime-lifecycle.js'
import { attachmentFallbackPaths, buildAcpPromptBlocks, type AcpPromptInput } from '../runtime/acp/acp-prompt.js'

export type SessionUserInput = Pick<AcpPromptInput,
  'userText' | 'images' | 'attachmentPaths' | 'documents' | 'unreadableDocuments'> & {
  fileReferences: readonly UserFileReference[]
}

/** Undelivered requests are live input, not optional or budgeted handoff history. */
export function sessionUserItem(current: UserTurnItem, pending: readonly UserTurnItem[] = []): UserTurnItem {
  if (!pending.length) return current
  const messages = [...pending, current]
  return {
    ...current,
    text: [
      'Earlier user requests were not delivered to this session. Read them in order, then apply the current request:',
      ...pending.map((item, index) => `Earlier user request ${index + 1}:\n${userMessageTextWithComposerContexts(item)}`),
      `Current user request:\n${userMessageTextWithComposerContexts(current)}`
    ].join('\n\n'),
    // Each request's attached context is already rendered beside its own text.
    composerContexts: undefined,
    reviewRequests: undefined,
    attachmentIds: [...new Set(messages.flatMap((item) => item.attachmentIds ?? []))],
    fileReferences: messages.flatMap((item) => item.fileReferences ?? [])
  }
}

export async function resolveSessionUserInput(input: {
  userItem: UserTurnItem
  pending?: readonly UserTurnItem[]
  attachmentStore?: AttachmentStore
  threadId: string
  workspace: string
  imageCapable: boolean
}): Promise<SessionUserInput> {
  const userItem = sessionUserItem(input.userItem, input.pending)
  const attachmentIds = userItem.attachmentIds ?? []
  const documents = await resolveAcpDocuments(input.attachmentStore, input.threadId, input.workspace, attachmentIds)
  return {
    userText: userMessageTextWithComposerContexts(userItem),
    images: await resolveAcpImages(input.attachmentStore, input.threadId, input.workspace, attachmentIds, input.imageCapable),
    attachmentPaths: attachmentFallbackPaths(userItem),
    fileReferences: userItem.fileReferences ?? [],
    documents: documents.documents,
    unreadableDocuments: documents.unreadable
  }
}

/** Native text/image protocols carry the same document warnings as ACP. */
export function sessionUserTextWithDocuments(input: SessionUserInput): string {
  return buildAcpPromptBlocks({
    ...input, instructionBlocks: [], imageCapable: false,
    images: [], attachmentPaths: [], fileReferences: []
  }).filter((block) => block.type === 'text').map((block) => String(block.text)).join('\n\n')
}
