// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  state: { route: 'chat', currentTurnId: null },
  listener: undefined as undefined | ((state: { route: string; currentTurnId: null }, previous: { route: string; currentTurnId: null }) => void)
}))
vi.mock('../store/chat-store', () => ({ useChatStore: {
  getState: () => mocks.state,
  subscribe: (listener: typeof mocks.listener) => { mocks.listener = listener; return () => {} }
} }))
vi.mock('../components/rooms/room-event-listeners', () => ({ subscribeRoomEvents: () => () => {} }))
import { useProductAnalyticsLifecycle } from './lifecycle'
import { setProductCapture } from './client'

const epoch = '0a937dda-cee5-462d-9fca-5abc6f514efd'
const track = vi.fn(async (_event: unknown, _epoch?: string) => {})
const getState = vi.fn(async () => ({ enabled: true, epoch }))
const events = () => track.mock.calls.map(([event]) => (event as { name: string }).name)
let root: Root
let activity: EventListener
function Probe() { useProductAnalyticsLifecycle(); return null }
function route(next: string) {
  const previous = mocks.state
  mocks.state = { route: next, currentTurnId: null }
  mocks.listener?.(mocks.state, previous)
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  mocks.state = { route: 'chat', currentTurnId: null }; mocks.listener = undefined
  track.mockClear(); getState.mockResolvedValue({ enabled: true, epoch })
  Object.assign(window, { kunGui: { productAnalytics: { getState, track } } })
  const add = vi.spyOn(window, 'addEventListener')
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(createElement(Probe)))
  activity = add.mock.calls.find(([name]) => name === 'pointerdown')![1] as EventListener
})
afterEach(async () => {
  await act(async () => root.unmount())
  setProductCapture(false); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''
})

describe('Work foreground entry', () => {
  it('does not count startup restore, synthetic activity, or hidden activity', () => {
    route('write')
    activity({ isTrusted: false } as Event)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    activity({ isTrusted: true } as Event)
    expect(events()).toEqual([])
  })

  it('counts one user navigation to Work before the next click and re-entry separately', () => {
    activity({ isTrusted: true } as Event)
    route('write')
    activity({ isTrusted: true } as Event)
    route('chat'); route('write')
    expect(events()).toEqual(['app_session_started', 'work_entered', 'work_entered'])
  })

  it('counts the first explicit interaction on restored Work, while consent-off remains silent', () => {
    route('write')
    setProductCapture(false); activity({ isTrusted: true } as Event)
    expect(track).not.toHaveBeenCalled()
    setProductCapture(true, epoch); activity({ isTrusted: true } as Event)
    expect(events()).toEqual(['work_entered', 'app_session_started'])
  })
})
