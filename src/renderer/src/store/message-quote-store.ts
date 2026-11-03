import { create } from 'zustand'
import { appendMessageQuote, type MessageQuote } from '../lib/message-quote'

/**
 * Quotes waiting in side-conversation composers. The main composer keeps its
 * quotes as pending composer contexts in the chat store; side composers have
 * no such slot, so selections land here until the side turn is sent.
 */
type MessageQuoteState = {
  /** Draft composer (no side thread yet), keyed by parent thread id. */
  sideDraftQuotes: Record<string, MessageQuote[]>
  /** Composer of an existing side conversation, keyed by side thread id. */
  sideQuotes: Record<string, MessageQuote[]>
  /**
   * Bumped when a selection asks the workbench to open the side-chat draft.
   * The workbench owns the right-panel layout, so it reacts to the request.
   */
  sideDraftRevealRequest: { parentThreadId: string; seq: number } | null
  startSideDraftWithQuote: (parentThreadId: string, quote: MessageQuote) => void
  addSideQuote: (sideId: string, quote: MessageQuote) => void
  removeSideDraftQuote: (parentThreadId: string, quoteId: string) => void
  removeSideQuote: (sideId: string, quoteId: string) => void
  /** Drop sent quotes; quotes added while the send was in flight survive. */
  consumeSideDraftQuotes: (parentThreadId: string, quoteIds: readonly string[]) => void
  consumeSideQuotes: (sideId: string, quoteIds: readonly string[]) => void
}

function withoutIds(
  record: Record<string, MessageQuote[]>,
  key: string,
  quoteIds: readonly string[]
): Record<string, MessageQuote[]> {
  const current = record[key]
  if (!current) return record
  const ids = new Set(quoteIds)
  const remaining = current.filter((quote) => !ids.has(quote.id))
  if (remaining.length === current.length) return record
  const next = { ...record }
  if (remaining.length > 0) next[key] = remaining
  else delete next[key]
  return next
}

export const useMessageQuoteStore = create<MessageQuoteState>((set) => ({
  sideDraftQuotes: {},
  sideQuotes: {},
  sideDraftRevealRequest: null,
  startSideDraftWithQuote: (parentThreadId, quote) => set((state) => ({
    sideDraftQuotes: {
      ...state.sideDraftQuotes,
      [parentThreadId]: appendMessageQuote(state.sideDraftQuotes[parentThreadId] ?? [], quote)
    },
    sideDraftRevealRequest: {
      parentThreadId,
      seq: (state.sideDraftRevealRequest?.seq ?? 0) + 1
    }
  })),
  addSideQuote: (sideId, quote) => set((state) => ({
    sideQuotes: {
      ...state.sideQuotes,
      [sideId]: appendMessageQuote(state.sideQuotes[sideId] ?? [], quote)
    }
  })),
  removeSideDraftQuote: (parentThreadId, quoteId) => set((state) => ({
    sideDraftQuotes: withoutIds(state.sideDraftQuotes, parentThreadId, [quoteId])
  })),
  removeSideQuote: (sideId, quoteId) => set((state) => ({
    sideQuotes: withoutIds(state.sideQuotes, sideId, [quoteId])
  })),
  consumeSideDraftQuotes: (parentThreadId, quoteIds) => set((state) => ({
    sideDraftQuotes: withoutIds(state.sideDraftQuotes, parentThreadId, quoteIds)
  })),
  consumeSideQuotes: (sideId, quoteIds) => set((state) => ({
    sideQuotes: withoutIds(state.sideQuotes, sideId, quoteIds)
  }))
}))
