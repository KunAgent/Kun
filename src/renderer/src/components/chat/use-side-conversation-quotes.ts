import { useCallback, useMemo } from 'react'
import type { ComposerContextAttachment } from '@kun/extension-api'
import { createMessageQuoteAttachments, type MessageQuote } from '../../lib/message-quote'
import { useMessageQuoteStore } from '../../store/message-quote-store'
import { messageQuoteComposerChip } from './MessageQuoteViews'

const EMPTY_QUOTES: MessageQuote[] = []

export type PreparedSideQuotes = {
  composerContexts: ComposerContextAttachment[]
  /** Drop the quotes that went out with the turn. */
  consume: () => void
}

/**
 * Quotes waiting in the side-conversation composer: the draft's (keyed by
 * the parent thread) until the side thread exists, then the side thread's.
 */
export function useSideConversationQuotes(input: {
  parentThreadId: string | null
  activeSideId: string | null
  workspaceRoot: string
}) {
  const { parentThreadId, activeSideId, workspaceRoot } = input
  const quotes = useMessageQuoteStore((state) => activeSideId
    ? state.sideQuotes[activeSideId] ?? EMPTY_QUOTES
    : parentThreadId
      ? state.sideDraftQuotes[parentThreadId] ?? EMPTY_QUOTES
      : EMPTY_QUOTES)
  const contextChips = useMemo(() => quotes.map(messageQuoteComposerChip), [quotes])

  const removeQuote = useCallback((quoteId: string): void => {
    const store = useMessageQuoteStore.getState()
    if (activeSideId) store.removeSideQuote(activeSideId, quoteId)
    else if (parentThreadId) store.removeSideDraftQuote(parentThreadId, quoteId)
  }, [activeSideId, parentThreadId])

  /** Null when nothing is quoted, so plain sends keep their old shape. */
  const prepareSend = useCallback(async (): Promise<PreparedSideQuotes | null> => {
    if (quotes.length === 0) return null
    const quoteIds = quotes.map((quote) => quote.id)
    const composerContexts = await createMessageQuoteAttachments({ workspaceRoot, quotes })
    return {
      composerContexts,
      consume: () => {
        const store = useMessageQuoteStore.getState()
        if (activeSideId) store.consumeSideQuotes(activeSideId, quoteIds)
        else if (parentThreadId) store.consumeSideDraftQuotes(parentThreadId, quoteIds)
      }
    }
  }, [activeSideId, parentThreadId, quotes, workspaceRoot])

  return { contextChips, removeQuote, prepareSend }
}
