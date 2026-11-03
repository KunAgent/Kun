import { useChatStore } from '../store/chat-store'
import type { ChatState } from '../store/chat-store-types'
import { useMessageQuoteStore } from '../store/message-quote-store'
import { workspaceRootScopeKey } from './workspace-path'
import {
  createMessageQuoteAttachment,
  MAX_MESSAGE_QUOTES_PER_TURN,
  MESSAGE_QUOTE_KIND,
  type MessageQuote
} from './message-quote'

export type SideConversationQuoteBlocker = 'no-thread' | 'runtime'

function mainComposerWorkspaceRoot(state: ChatState): string {
  const threadWorkspace = state.activeThreadId
    ? state.threads.find((thread) => thread.id === state.activeThreadId)?.workspace
    : undefined
  return threadWorkspace?.trim() || state.workspaceRoot.trim()
}

/** Reply quotes only reach Kun from the Code conversation composer. */
export function canReplyInMainComposer(state: ChatState): boolean {
  return state.route === 'chat'
}

export function sideConversationQuoteBlocker(state: ChatState): SideConversationQuoteBlocker | null {
  if (!state.activeThreadId) return 'no-thread'
  if (state.runtimeConnection !== 'ready') return 'runtime'
  return null
}

/** The side panel is lazy-loaded, so its composer may mount a few frames late. */
function focusComposer(selector: string, attemptsLeft = 20): void {
  window.requestAnimationFrame(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>(selector)
    if (!textarea || textarea.disabled) {
      if (attemptsLeft > 0) focusComposer(selector, attemptsLeft - 1)
      return
    }
    textarea.focus()
    const end = textarea.value.length
    textarea.setSelectionRange(end, end)
  })
}

/**
 * Attach a quote to the main composer as a pending composer context. The
 * regular send path then carries it into the turn and consumes it.
 */
export async function replyWithQuoteInMainComposer(quote: MessageQuote): Promise<boolean> {
  const initial = useChatStore.getState()
  if (!canReplyInMainComposer(initial)) return false
  const workspaceRoot = mainComposerWorkspaceRoot(initial)
  const threadId = initial.activeThreadId
  const attachment = await createMessageQuoteAttachment({ workspaceRoot, quote })
  const state = useChatStore.getState()
  if (
    !canReplyInMainComposer(state) ||
    state.activeThreadId !== threadId ||
    workspaceRootScopeKey(mainComposerWorkspaceRoot(state)) !== workspaceRootScopeKey(workspaceRoot)
  ) return false

  const pendingQuotes = state.extensionComposerContexts.filter((event) =>
    event.attachment.reference.kind === MESSAGE_QUOTE_KIND &&
    event.attachment.attachmentId !== attachment.attachmentId &&
    workspaceRootScopeKey(event.workspaceRoot) === workspaceRootScopeKey(workspaceRoot) &&
    (!event.threadId || event.threadId === threadId)
  )
  for (const stale of pendingQuotes.slice(0, Math.max(0, pendingQuotes.length - MAX_MESSAGE_QUOTES_PER_TURN + 1))) {
    state.removeComposerContext(stale.attachment.attachmentId)
  }
  state.attachComposerContext({
    workspaceRoot,
    ...(threadId ? { threadId } : {}),
    attachment
  })
  const attached = useChatStore.getState().extensionComposerContexts.some(
    (event) => event.attachment.attachmentId === attachment.attachmentId
  )
  if (attached) focusComposer('[data-primary-floating-composer] .ds-composer-textarea')
  return attached
}

/** Open the side-chat draft for the active thread with the quote attached. */
export function startSideConversationWithQuote(quote: MessageQuote): boolean {
  const state = useChatStore.getState()
  if (sideConversationQuoteBlocker(state)) return false
  useMessageQuoteStore.getState().startSideDraftWithQuote(state.activeThreadId!, quote)
  focusComposer('.ds-side-chat .ds-composer-textarea')
  return true
}

/** Quote into the composer of the side conversation the selection came from. */
export function replyWithQuoteInSideConversation(sideId: string, quote: MessageQuote): boolean {
  if (!useChatStore.getState().sideConversations[sideId]) return false
  useMessageQuoteStore.getState().addSideQuote(sideId, quote)
  focusComposer('.ds-side-chat .ds-composer-textarea')
  return true
}
