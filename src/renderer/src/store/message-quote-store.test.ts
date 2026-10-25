import { beforeEach, describe, expect, it } from 'vitest'
import type { MessageQuote } from '../lib/message-quote'
import { useMessageQuoteStore } from './message-quote-store'

function quote(id: string, text = id): MessageQuote {
  return { id, text, role: 'assistant', charCount: text.length, truncated: false }
}

describe('message quote store', () => {
  beforeEach(() => {
    useMessageQuoteStore.setState({ sideDraftQuotes: {}, sideQuotes: {}, sideDraftRevealRequest: null })
  })

  it('queues the draft quote and asks the workbench to reveal the draft', () => {
    const store = useMessageQuoteStore.getState()
    store.startSideDraftWithQuote('thr_main', quote('a'))
    store.startSideDraftWithQuote('thr_main', quote('b'))
    const state = useMessageQuoteStore.getState()
    expect(state.sideDraftQuotes.thr_main?.map((item) => item.id)).toEqual(['a', 'b'])
    expect(state.sideDraftRevealRequest).toEqual({ parentThreadId: 'thr_main', seq: 2 })
  })

  it('keeps quotes added while a send was in flight', () => {
    const store = useMessageQuoteStore.getState()
    store.addSideQuote('side_1', quote('sent'))
    store.addSideQuote('side_1', quote('late'))
    store.consumeSideQuotes('side_1', ['sent'])
    expect(useMessageQuoteStore.getState().sideQuotes.side_1?.map((item) => item.id)).toEqual(['late'])
    store.removeSideQuote('side_1', 'late')
    expect(useMessageQuoteStore.getState().sideQuotes).toEqual({})
  })

  it('keeps draft and side composers apart', () => {
    const store = useMessageQuoteStore.getState()
    store.startSideDraftWithQuote('thr_main', quote('draft'))
    store.addSideQuote('side_1', quote('side'))
    store.consumeSideDraftQuotes('thr_main', ['draft'])
    const state = useMessageQuoteStore.getState()
    expect(state.sideDraftQuotes).toEqual({})
    expect(state.sideQuotes.side_1?.map((item) => item.id)).toEqual(['side'])
  })
})
