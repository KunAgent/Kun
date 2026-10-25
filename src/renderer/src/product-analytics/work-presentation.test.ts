// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock } from '../agent/types'
import { useChatStore } from '../store/chat-store'
import { TimelineFilePreviewWorkspaceProvider } from '../components/chat/timeline-file-preview-workspace'
import { setProductCapture } from './client'
import { beginWorkSubmission, bindWorkAnalyticsTurn, clearWorkAnalytics, noteWorkTurnCompleted } from './work'
import { captureAssistantResultAction, useWorkPresentation } from './work-presentation'

const EPOCH = '0a937dda-cee5-462d-9fca-5abc6f514efd'
const track = vi.fn(async (_event: unknown, _epoch?: string) => {})
const events = () => track.mock.calls.map(([event]) => event as { name: string; properties: Record<string, unknown> })
class VisibilityObserver {
  static observers: VisibilityObserver[] = []
  element?: Element
  constructor(private readonly callback: IntersectionObserverCallback) { VisibilityObserver.observers.push(this) }
  observe(element: Element) { this.element = element }
  disconnect() { VisibilityObserver.observers = VisibilityObserver.observers.filter(observer => observer !== this) }
  static visible(value = true) {
    for (const observer of this.observers) observer.callback([
      { target: observer.element!, isIntersecting: value } as IntersectionObserverEntry
    ], observer as unknown as IntersectionObserver)
  }
}
function Probe({ block, allowFinal = true }: { block: ChatBlock; allowFinal?: boolean }) {
  const analytics = useWorkPresentation(block, allowFinal)
  return createElement('div', { ref: analytics.ref }, 'visible feedback')
}
let root: Root
let initial: ReturnType<typeof useChatStore.getState>
beforeEach(() => {
  initial = useChatStore.getState()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('IntersectionObserver', VisibilityObserver)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  Object.assign(window, { kunGui: { productAnalytics: { track } } })
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  useChatStore.setState({ route: 'write', activeThreadId: 'parent', currentTurnId: 'turn', busy: false,
    busyUnconfirmed: false, threads: [{ id: 'parent', agentSurface: 'write' } as never] })
  setProductCapture(true, EPOCH); clearWorkAnalytics(); track.mockClear()
})
afterEach(async () => {
  await act(async () => root.unmount())
  useChatStore.setState(initial, true)
  setProductCapture(false); clearWorkAnalytics(); document.body.innerHTML = ''
  VisibilityObserver.observers = []; vi.restoreAllMocks(); vi.unstubAllGlobals()
})
const answer: ChatBlock = { kind: 'assistant', id: 'answer', turnId: 'turn', text: 'Private result never uploaded' }
async function render(threadId = 'parent', block = answer, allowFinal = true) {
  await act(async () => root.render(createElement(TimelineFilePreviewWorkspaceProvider,
    { workspaceRoot: '/private/workspace', threadId, children: createElement(Probe, { block, allowFinal }) })))
}
function submit(completed = true) {
  const request = beginWorkSubmission()!
  bindWorkAnalyticsTurn(request.clientRequestId, 'parent', 'turn')
  if (completed) noteWorkTurnCompleted('parent', 'turn')
  return request
}

describe('Work timeline visibility and actual thread attribution', () => {
  it('requires an intersecting foreground element and deduplicates render and visibility changes', async () => {
    submit(); await render()
    VisibilityObserver.visible(false)
    await vi.waitFor(() => expect(events()).toHaveLength(1))
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    VisibilityObserver.visible()
    expect(events()).toHaveLength(1)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(events().map(event => event.name)).toEqual([
      'work_task_submitted', 'work_feedback_presented', 'result_presented'
    ]))
    await render('parent', { ...answer }); VisibilityObserver.visible()
    expect(events()).toHaveLength(3)
    expect(JSON.stringify(events())).not.toContain('Private result')
    expect(JSON.stringify(events())).not.toContain('/private/')
  })

  it('ignores child viewer, source history and turns without a live submission', async () => {
    submit(); await render('child'); VisibilityObserver.visible()
    await render('parent', { ...answer, turnId: 'old' }); VisibilityObserver.visible()
    await render('parent', { ...answer, sourceHistoryOrder: { referenceId: 'ref', turnIndex: 0, itemIndex: 0 } }); VisibilityObserver.visible()
    await vi.waitFor(() => expect(events()).toHaveLength(1))
  })

  it('observes feedback before terminal result and reacts when the task stops running', async () => {
    submit(false)
    useChatStore.setState({ busy: true })
    await render(); VisibilityObserver.visible()
    await vi.waitFor(() => expect(events()).toHaveLength(2))
    expect(events()[1].name).toBe('work_feedback_presented')
    noteWorkTurnCompleted('parent', 'turn')
    await act(async () => useChatStore.setState({ busy: false }))
    VisibilityObserver.visible()
    await vi.waitFor(() => expect(events()[2]?.name).toBe('result_presented'))
  })

  it('handles UI feedback arriving before the HTTP admission response', async () => {
    const request = beginWorkSubmission()!
    await render(); VisibilityObserver.visible()
    await vi.waitFor(() => expect(events()).toHaveLength(1))
    noteWorkTurnCompleted('parent', 'turn')
    bindWorkAnalyticsTurn(request.clientRequestId, 'parent', 'turn')
    await vi.waitFor(() => expect(events()).toHaveLength(3))
  })

  it('keeps process output separate from final result presentation', async () => {
    submit(); await render('parent', answer, false); VisibilityObserver.visible()
    await vi.waitFor(() => expect(events()).toHaveLength(2))
    expect(events()[1].name).toBe('work_feedback_presented')
  })

  it('requires terminal completion evidence even when the global view is idle', async () => {
    submit(false); await render(); VisibilityObserver.visible()
    await vi.waitFor(() => expect(events()).toHaveLength(2))
    expect(events().some(event => event.name === 'result_presented')).toBe(false)
    noteWorkTurnCompleted('parent', 'turn')
    await vi.waitFor(() => expect(events()).toHaveLength(3))
  })

  it('uses the matching active turn for synthetic live reasoning without attributing child viewers', async () => {
    submit(); useChatStore.setState({ busy: true })
    const live: ChatBlock = { kind: 'reasoning', id: 'live-reasoning', text: 'Private reasoning' }
    await render('child', live, false); VisibilityObserver.visible()
    await vi.waitFor(() => expect(events()).toHaveLength(1))
    await render('parent', live, false); VisibilityObserver.visible()
    await vi.waitFor(() => expect(events()).toHaveLength(2))
    expect(events()[1]).toMatchObject({ name: 'work_feedback_presented', properties: { feedbackKind: 'reasoning' } })
  })

  it('does not misclassify an untracked Work copy as Code and preserves Code copy behavior', () => {
    captureAssistantResultAction('parent', answer, 'copy')()
    expect(track).not.toHaveBeenCalled()
    useChatStore.setState({ route: 'chat', activeThreadId: 'code', threads: [{ id: 'code', agentSurface: 'code' } as never] })
    captureAssistantResultAction('child', answer, 'copy')()
    captureAssistantResultAction('code', { ...answer, sourceHistoryOrder: { referenceId: 'imported', turnIndex: 0, itemIndex: 0 } }, 'copy')()
    captureAssistantResultAction('code', answer, 'copy')()
    expect(events()).toEqual([{ name: 'result_action', properties: { mode: 'code', action: 'copy' } }])
  })
})
