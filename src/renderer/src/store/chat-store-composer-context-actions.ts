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
  workspaceRoot: string | undefined
): boolean {
  if (state.route !== 'chat') return false
  return workspaceRootScopeKey(workspaceRoot) === workspaceRootScopeKey(activeWorkspaceRoot(state))
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
}): Pick<ChatState, 'attachExtensionComposerContext' | 'removeExtensionComposerContext'> {
  const { set, get } = input
  return {
    attachExtensionComposerContext: (event) => {
      if (!eventMatchesCurrentComposer(get(), event.workspaceRoot)) return
      set((state) => {
        if (!eventMatchesCurrentComposer(state, event.workspaceRoot)) return {}
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
    },
    removeExtensionComposerContext: (attachmentId) => set((state) => ({
      extensionComposerContexts: state.extensionComposerContexts.filter(
        (candidate) => candidate.attachment.attachmentId !== attachmentId
      )
    }))
  }
}
