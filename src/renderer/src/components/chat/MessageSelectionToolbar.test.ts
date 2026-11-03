import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { useMessageQuoteStore } from '../../store/message-quote-store'
import { MessageSelectionToolbar } from './MessageSelectionToolbar'

type TestWindow = Window & typeof globalThis

let dom: JSDOM
let win: TestWindow
let root: Root
let timeline: HTMLDivElement
const originalChatState = useChatStore.getState()

function settle(ms = 5): Promise<void> {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function selectAnswer(start: number, end: number): Promise<void> {
  const doc = win.document
  const text = doc.getElementById('answer')!.firstChild!
  const range = doc.createRange()
  range.setStart(text, start)
  range.setEnd(text, end)
  const selection = win.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  await act(async () => {
    win.dispatchEvent(new win.Event('pointerdown'))
    win.dispatchEvent(new win.Event('pointerup'))
  })
  await settle()
}

function toolbar(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-message-selection-toolbar]')
}

function action(name: 'reply' | 'side'): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`[data-message-quote-action="${name}"]`)
}

async function render(props: { surface: 'main' | 'side'; sideId?: string }): Promise<void> {
  await act(async () => {
    root.render(createElement(MessageSelectionToolbar, { containerRef: { current: timeline }, ...props }))
  })
}

beforeEach(() => {
  dom = new JSDOM(`<!doctype html><body><div id="app"></div><div id="timeline">
    <div data-timeline-block-id="item_2"><div class="ds-markdown">
      <p id="answer">Remote agents depend on host scheduling.</p>
    </div></div>
  </div></body>`)
  win = dom.window as unknown as TestWindow
  win.requestAnimationFrame = (callback) => win.setTimeout(() => callback(0), 0)
  win.cancelAnimationFrame = (handle) => win.clearTimeout(handle)
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', win.document)
  vi.stubGlobal('Node', win.Node)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  win.Range.prototype.getClientRects = function getClientRects() {
    return [{ left: 200, top: 300, right: 320, bottom: 320, width: 120, height: 20 }] as unknown as DOMRectList
  }
  timeline = win.document.getElementById('timeline') as HTMLDivElement
  timeline.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 800, bottom: 700, width: 800, height: 700 }) as DOMRect
  useChatStore.setState({
    route: 'chat',
    activeThreadId: 'thr_main',
    runtimeConnection: 'ready',
    workspaceRoot: '/repo',
    threads: [{ id: 'thr_main', title: 'Main', workspace: '/repo' } as NormalizedThread],
    extensionComposerContexts: [],
    sideConversations: {}
  })
  useMessageQuoteStore.setState({ sideDraftQuotes: {}, sideQuotes: {}, sideDraftRevealRequest: null })
  root = createRoot(win.document.getElementById('app')!)
})

afterEach(async () => {
  await act(async () => root.unmount())
  useChatStore.setState(originalChatState, true)
  dom.window.close()
  vi.unstubAllGlobals()
})

describe('MessageSelectionToolbar', () => {
  it('appears over a settled selection and quotes it into the main composer', async () => {
    await render({ surface: 'main' })
    expect(toolbar()).toBeNull()

    await selectAnswer(0, 13)
    expect(toolbar()?.style.visibility).toBe('visible')
    expect(action('side')?.disabled).toBe(false)

    await act(async () => action('reply')!.click())
    await settle()
    const contexts = useChatStore.getState().extensionComposerContexts
    expect(contexts).toHaveLength(1)
    expect(contexts[0]).toMatchObject({
      workspaceRoot: '/repo',
      threadId: 'thr_main',
      attachment: { reference: { kind: 'message-quote', quote: '> Remote agents', messageId: 'item_2' } }
    })
    expect(toolbar()).toBeNull()
    expect(win.getSelection()?.isCollapsed).toBe(true)
  })

  it('opens the side-chat draft with the quote', async () => {
    await render({ surface: 'main' })
    await selectAnswer(24, 39)
    await act(async () => action('side')!.click())
    const state = useMessageQuoteStore.getState()
    expect(state.sideDraftQuotes.thr_main?.map((quote) => quote.text)).toEqual(['host scheduling'])
    expect(state.sideDraftRevealRequest).toEqual({ parentThreadId: 'thr_main', seq: 1 })
  })

  it('disables the side chat until the runtime is connected', async () => {
    useChatStore.setState({ runtimeConnection: 'checking' })
    await render({ surface: 'main' })
    await selectAnswer(0, 6)
    expect(action('side')?.disabled).toBe(true)
    expect(action('reply')?.disabled).toBe(false)
  })

  it('stays off outside the Code conversation', async () => {
    useChatStore.setState({ route: 'write' })
    await render({ surface: 'main' })
    await selectAnswer(0, 6)
    expect(toolbar()).toBeNull()
  })

  it('quotes into its own side conversation and offers no nested side chat', async () => {
    useChatStore.setState({
      sideConversations: { side_1: { threadId: 'side_1' } as never }
    })
    await render({ surface: 'side', sideId: 'side_1' })
    await selectAnswer(0, 6)
    expect(action('side')).toBeNull()
    await act(async () => action('reply')!.click())
    expect(useMessageQuoteStore.getState().sideQuotes.side_1?.map((quote) => quote.text)).toEqual(['Remote'])
  })

  it('hides on Escape until the selection changes', async () => {
    await render({ surface: 'main' })
    await selectAnswer(0, 6)
    await act(async () => {
      win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(toolbar()).toBeNull()
    await selectAnswer(0, 6)
    expect(toolbar()).toBeNull()
    await selectAnswer(0, 13)
    expect(toolbar()).not.toBeNull()
  })
})
