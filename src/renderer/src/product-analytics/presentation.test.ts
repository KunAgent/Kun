// @vitest-environment node
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ChatBlock } from '../agent/types'
import type { RoomMessage } from '@shared/rooms-api'
import { setProductCapture } from './client'
import {
  clearAnalyticsPresentation, noteAnalyticsRoomMessage, noteAnalyticsRoomRendered,
  noteAnalyticsTurn, useResultPresented
} from './presentation'

vi.mock('../store/chat-store', () => ({
  useChatStore: { getState: () => ({ route: 'chat', activeThreadId: 'thread' }) }
}))
const track = vi.fn(async () => {})
const renderers: ReactTestRenderer[] = []
const block: ChatBlock = { kind: 'assistant', id: 'answer', turnId: 'turn', text: 'Synthetic answer' }
const message = { id: 'message', authorKind: 'member', deliveryPhase: 'final',
  body: 'Synthetic reply', originRunId: 'run' } as RoomMessage

function Presented({ value }: { value: ChatBlock }) { useResultPresented(value); return null }
async function render(value = block) {
  await act(async () => { renderers.push(create(createElement(Presented, { value }))) })
}
function noteLiveResults() {
  noteAnalyticsTurn('thread', 'turn', Date.now())
  noteAnalyticsRoomMessage(message.id, new Date().toISOString())
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('window', { kunGui: { productAnalytics: { track } } })
  vi.stubGlobal('document', undefined)
  setProductCapture(false)
  clearAnalyticsPresentation()
  track.mockClear()
})
afterEach(async () => {
  await act(async () => { renderers.splice(0).forEach(renderer => renderer.unmount()) })
  clearAnalyticsPresentation()
  setProductCapture(false)
  vi.unstubAllGlobals()
})

it.each([
  ['code', false], ['code', true], ['room', false], ['room', true]
] as const)('does not treat DOM-less %s rendering as presentation (capture=%s)', async (surface, enabled) => {
  setProductCapture(enabled, 'epoch')
  noteLiveResults()
  if (surface === 'code') await expect(render()).resolves.toBeUndefined()
  else expect(() => noteAnalyticsRoomRendered(message)).not.toThrow()
  expect(track).not.toHaveBeenCalled()
})

it('keeps live results available until a visible document presents them, then reports each once', async () => {
  setProductCapture(true, 'epoch')
  noteLiveResults()
  await render()
  noteAnalyticsRoomRendered(message)
  vi.stubGlobal('document', { hidden: true })
  await render()
  noteAnalyticsRoomRendered(message)
  expect(track).not.toHaveBeenCalled()

  vi.stubGlobal('document', { hidden: false })
  await render()
  noteAnalyticsRoomRendered(message)
  await vi.waitFor(() => expect(track).toHaveBeenCalledTimes(2))
  for (const mode of ['code', 'room']) expect(track).toHaveBeenCalledWith({
    name: 'result_presented', properties: { mode, runKey: expect.stringMatching(/^[a-f0-9]{64}$/), outputPresent: true }
  }, 'epoch')
  await render()
  noteAnalyticsRoomRendered(message)
  expect(track).toHaveBeenCalledTimes(2)
})

it.each(['disabled', 'remote', 'historical'])('does not report visible %s results', async mode => {
  vi.stubGlobal('document', { hidden: false })
  setProductCapture(mode !== 'disabled', 'epoch')
  if (mode === 'remote') vi.stubGlobal('window', { kunGui: { isRemoteWeb: true, productAnalytics: { track } } })
  if (mode !== 'historical') noteLiveResults()
  await render()
  noteAnalyticsRoomRendered(message)
  expect(track).not.toHaveBeenCalled()
})
