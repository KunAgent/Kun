// @vitest-environment jsdom
import { act, createElement } from 'react'
import { webcrypto } from 'node:crypto'
import type { KunAccountState } from '@shared/kun-account'
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
import { setProductCapture, productCaptureEpoch, PRODUCT_ANALYTICS_CHANGED } from './client'
import { beginWorkSubmission, bindWorkAnalyticsTurn, noteWorkTurnCompleted, noteWorkVisibleFeedback } from './work'

const epoch = '0a937dda-cee5-462d-9fca-5abc6f514efd'
const track = vi.fn(async (_event: unknown, _epoch?: string) => {})
const getState = vi.fn(async () => ({ enabled: true, epoch }))
const getAccountState = vi.fn(async () => accountState('account-a'))
const events = () => track.mock.calls.map(([event]) => (event as { name: string }).name)
let root: Root
let activity: EventListener
let accountChanged: (state: KunAccountState) => void
const accountState = (id: string, error: 'network' | null = null): KunAccountState => ({
  status: error ? 'error' : 'authenticated', error,
  user: { id, email: 'test@example.invalid', name: 'Test', avatarUrl: null }
})
function Probe() { useProductAnalyticsLifecycle(); return null }
function route(next: string) {
  const previous = mocks.state
  mocks.state = { route: next, currentTurnId: null }
  mocks.listener?.(mocks.state, previous)
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('crypto', webcrypto)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  mocks.state = { route: 'chat', currentTurnId: null }; mocks.listener = undefined
  track.mockClear(); getAccountState.mockClear(); getState.mockResolvedValue({ enabled: true, epoch })
  Object.assign(window, { kunGui: { productAnalytics: { getState, track }, kunAccount: {
    getState: getAccountState,
    onState: (listener: typeof accountChanged) => { accountChanged = listener; return () => {} }
  } } })
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


describe('Work attribution across account-state notifications', () => {
  it('preserves an in-flight request through token/profile refresh and transient errors for the same actor', async () => {
    const submission = beginWorkSubmission()!
    await act(async () => accountChanged(accountState('account-a')))
    await act(async () => accountChanged(accountState('account-a', 'network')))
    await act(async () => window.dispatchEvent(new Event(PRODUCT_ANALYTICS_CHANGED)))
    bindWorkAnalyticsTurn(submission.clientRequestId, 'thread', 'turn')
    noteWorkTurnCompleted('thread', 'turn')
    noteWorkVisibleFeedback('thread', 'turn', 'text', true)
    await vi.waitFor(() => expect(events()).toContain('result_presented'))
    expect(events().filter(name => name === 'work_task_submitted')).toHaveLength(1)
    expect(events().filter(name => name === 'result_presented')).toHaveLength(1)
  })

  it('fences a real account change immediately, even before the new analytics state arrives', async () => {
    const submission = beginWorkSubmission()!
    let resolve!: (value: { enabled: boolean; epoch: string }) => void
    getState.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    accountChanged(accountState('account-b'))
    expect(productCaptureEpoch()).toBeUndefined()
    bindWorkAnalyticsTurn(submission.clientRequestId, 'thread', 'turn')
    noteWorkTurnCompleted('thread', 'turn'); noteWorkVisibleFeedback('thread', 'turn', 'text', true)
    await act(async () => resolve({ enabled: true, epoch: 'bf5bcf48-b546-4b2e-bab1-154f8fa31f56' }))
    submission.finish('accepted')
    await new Promise(done => setTimeout(done, 20))
    expect(events()).not.toContain('result_presented')
    expect(events()).not.toContain('work_submission_finished')
  })

  it('ignores an older getState response after withdrawal', async () => {
    let resolve!: (value: { enabled: boolean; epoch: string }) => void
    getState.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    accountChanged(accountState('account-a'))
    getState.mockResolvedValue({ enabled: false, epoch })
    await act(async () => window.dispatchEvent(new Event(PRODUCT_ANALYTICS_CHANGED)))
    await act(async () => resolve({ enabled: true, epoch }))
    expect(productCaptureEpoch()).toBeUndefined()
    expect(beginWorkSubmission()).toBeUndefined()
  })
})


it('does not initialize account work for a historical opted-out installation', async () => {
  await act(async () => root.unmount())
  getState.mockResolvedValue({ enabled: false, epoch }); getAccountState.mockClear(); track.mockClear()
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(createElement(Probe)))
  expect(getAccountState).not.toHaveBeenCalled()
  expect(track).not.toHaveBeenCalled()
})
