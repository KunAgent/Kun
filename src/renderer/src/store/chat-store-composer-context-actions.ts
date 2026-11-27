import { MAX_COMPOSER_CONTEXT_ATTACHMENTS } from '@kun/extension-api'
import { workspaceRootScopeKey } from '../lib/workspace-path'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'

function activeWorkspaceRoot(state: ChatState): string {
  const threadWorkspace = state.activeThreadId
    ? state.threads.find((thread) => thread.id === state.activeThreadId)?.workspace
    : undefined
  return threadWorkspace?.trim() || state.workspaceRoot?.trim() || ''
}

function eventMatchesCurrentComposer(
  state: ChatState,
  workspaceRoot: string | undefined,
  threadId?: string
): boolean {
  if (state.route !== 'chat' && state.route !== 'ade') return false
  if (workspaceRootScopeKey(workspaceRoot) !== workspaceRootScopeKey(activeWorkspaceRoot(state))) {
    return false
  }
  return !threadId || threadId === state.activeThreadId
}

function isNewerOrEqual(
  current: ChatState['extensionComposerContexts'][number],
  next: ChatState['extensionComposerContexts'][number]
): boolean {
  if (next.attachment.generation !== current.attachment.generation) {
    return next.attachment.generation > current.attachment.generation
  }
  return next.attachment.revision >= current.attachment.revision
}

export function createComposerContextActions(input: {
  set: ChatStoreSet
  get: ChatStoreGet
}): Pick<
  ChatState,
  | 'attachExtensionComposerContext'
  | 'removeExtensionComposerContext'
  | 'attachComposerContext'
  | 'removeComposerContext'
  | 'clearComposerContexts'
> {
  const { set, get } = input
  const attachComposerContext: ChatState['attachComposerContext'] = (event) => {
    if (!eventMatchesCurrentComposer(get(), event.workspaceRoot, event.threadId)) return
    set((state) => {
      if (!eventMatchesCurrentComposer(state, event.workspaceRoot, event.threadId)) return {}
      const index = state.extensionComposerContexts.findIndex(
        (candidate) => candidate.attachment.attachmentId === event.attachment.attachmentId
      )
      if (index >= 0 && !isNewerOrEqual(state.extensionComposerContexts[index]!, event)) return {}
      const withoutCurrent = index < 0
        ? state.extensionComposerContexts
        : state.extensionComposerContexts.filter((_, candidateIndex) => candidateIndex !== index)
      return {
        extensionComposerContexts: [...withoutCurrent, event]
          .slice(-MAX_COMPOSER_CONTEXT_ATTACHMENTS)
      }
    })
  }
  const removeComposerContext: ChatState['removeComposerContext'] = (attachmentId) => set((state) => ({
    extensionComposerContexts: state.extensionComposerContexts.filter(
      (candidate) => candidate.attachment.attachmentId !== attachmentId
    )
  }))
  return {
    attachComposerContext,
    removeComposerContext,
    attachExtensionComposerContext: attachComposerContext,
    removeExtensionComposerContext: removeComposerContext,
    clearComposerContexts: (filter) => set((state) => ({
      extensionComposerContexts: state.extensionComposerContexts.filter((event) => {
        if (filter?.threadId && event.threadId !== filter.threadId) return true
        if (filter?.source === 'dev-preview') {
          return !('source' in event.attachment.provenance) ||
            event.attachment.provenance.source !== 'dev-preview'
        }
        return false
      })
    }))
  }
}
