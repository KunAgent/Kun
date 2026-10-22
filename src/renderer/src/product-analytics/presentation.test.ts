import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RoomMessage } from '@shared/rooms-api'
import type { ChatBlock } from '../agent/types'
import { clearAnalyticsPresentation, noteAnalyticsRoomMessage, noteAnalyticsRoomRendered,
  noteAnalyticsTurn, useResultPresented } from './presentation'

const mocks = vi.hoisted(() => ({ enabled: true, since: 100, route: 'chat', track: vi.fn(), key: vi.fn() }))
vi.mock('./client', () => ({
  productCaptureEnabled: () => mocks.enabled,
  get captureSince() { return mocks.since },
  analyticsRunKey: mocks.key,
  trackProduct: mocks.track
}))
vi.mock('../store/chat-store', () => ({ useChatStore: {
  getState: () => ({ route: mocks.route, activeThreadId: 'thread' })
} }))
const block: ChatBlock = { kind: 'assistant', id: 'answer', turnId: 'turn', text: 'private response' }
const message = { id: 'message', authorKind: 'member', deliveryPhase: 'final', body: 'private room response',
  originRunId: 'room-run' } as RoomMessage
const roots: ReactTestRenderer[] = []
function Presenter({ value }: { value: ChatBlock }) { useResultPresented(value); return null }
async function present(value = block) {
  await act(async () => { roots.push(create(createElement(Presenter, { value }))) })
}
function noteLive() {
  noteAnalyticsTurn('thread', 'turn', 200)
  noteAnalyticsRoomMessage(message.id, new Date(200).toISOString())
}
async function presentBoth() {
  await present()
  noteAnalyticsRoomRendered(message)
  await Promise.resolve()
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('document', undefined)
  mocks.enabled = true; mocks.since = 100; mocks.route = 'chat'
  mocks.track.mockReset(); mocks.key.mockReset().mockResolvedValue('opaque-run-key')
  clearAnalyticsPresentation()
})
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach(root => root.unmount()) })
  clearAnalyticsPresentation(); vi.unstubAllGlobals()
})

it.each([false, true])('does not present or throw without a DOM when capture is %s', async (enabled) => {
  mocks.enabled = enabled
  noteLive()
  await presentBoth()
  expect(mocks.key).not.toHaveBeenCalled()
  expect(mocks.track).not.toHaveBeenCalled()
})

it.each(['missing', 'hidden'])('retains live markers until genuinely visible after a %s document', async (state) => {
  if (state === 'hidden') vi.stubGlobal('document', { hidden: true })
  noteLive()
  await presentBoth()
  expect(mocks.track).not.toHaveBeenCalled()
  vi.stubGlobal('document', { hidden: false })
  await presentBoth()
  expect(mocks.track.mock.calls.map(([event]) => event.properties.mode)).toEqual(['code', 'room'])
  expect(mocks.track).toHaveBeenCalledWith({ name: 'result_presented', properties: {
    mode: 'code', runKey: 'opaque-run-key', outputPresent: true
  } })
  expect(JSON.stringify(mocks.track.mock.calls)).not.toContain('private')
  await presentBoth()
  expect(mocks.track).toHaveBeenCalledTimes(2)
})

it('does not capture with a visible document when the user has disabled capture', async () => {
  vi.stubGlobal('document', { hidden: false })
  noteLive(); mocks.enabled = false
  await presentBoth()
  expect(mocks.key).not.toHaveBeenCalled()
  expect(mocks.track).not.toHaveBeenCalled()
})

it('keeps stale history, partial output and other routes outside presentation capture', async () => {
  vi.stubGlobal('document', { hidden: false })
  noteAnalyticsTurn('thread', 'turn', 99)
  noteAnalyticsRoomMessage(message.id, new Date(99).toISOString())
  await presentBoth()
  noteLive()
  await present({ ...block, id: 'live-assistant' })
  await present({ ...block, text: ' ' })
  mocks.route = 'settings'
  await present()
  expect(mocks.track).not.toHaveBeenCalled()
  mocks.route = 'chat'
  await presentBoth()
  expect(mocks.track).toHaveBeenCalledTimes(2)
})

it('does not publish a pending run-key result after the capture epoch changes', async () => {
  vi.stubGlobal('document', { hidden: false })
  let resolve: (key: string) => void = () => undefined
  mocks.key.mockReturnValue(new Promise<string>(done => { resolve = done }))
  noteLive()
  await presentBoth()
  mocks.since = 300
  resolve('old-epoch-key')
  await Promise.resolve()
  expect(mocks.track).not.toHaveBeenCalled()
})
