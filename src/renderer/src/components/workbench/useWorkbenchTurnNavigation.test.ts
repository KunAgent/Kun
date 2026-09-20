import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ThreadDetail } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { useSddDraftStore } from '../../sdd/sdd-draft-store'
import * as turnTarget from '../chat/thread-turn-target'
import { useWorkbenchNavigationController, type UseWorkbenchNavigationControllerParams } from './useWorkbenchNavigationController'

let renderer: ReactTestRenderer
let controller: ReturnType<typeof useWorkbenchNavigationController>
const original = { activeThreadId: useChatStore.getState().activeThreadId, error: useChatStore.getState().error }
const detail: ThreadDetail = {
  latestSeq: 12, latestTurnId: 'old',
  blocks: [{ id: 'old-user', turnId: 'old', kind: 'user', text: 'Old request', createdAt: '2026-09-13T00:00:00.000Z' }]
}
function Harness(props: UseWorkbenchNavigationControllerParams) {
  controller = useWorkbenchNavigationController(props)
  return null
}
async function mount(selectThread = vi.fn(async () => {
  useChatStore.setState({ activeThreadId: 'thread', error: null })
})) {
  const props = { route: 'rooms', pluginHostRoute: 'chat', threads: [],
    setConnectPhoneSidebarOpen: vi.fn(), setRoute: vi.fn(), selectThread,
    dismissActiveSddDraft: vi.fn() } as unknown as UseWorkbenchNavigationControllerParams
  await act(async () => { renderer = create(createElement(Harness, props)) })
  return props
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useSddDraftStore.getState().clearActiveDraft()
  useChatStore.setState({ activeThreadId: 'previous', error: null })
  turnTarget.useThreadTurnTarget.setState({ target: null })
})
afterEach(() => {
  if (renderer) act(() => renderer.unmount())
  useChatStore.setState(original)
  turnTarget.useThreadTurnTarget.setState({ target: null })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('switches to Code only after exact historical hydration and selection succeed', async () => {
  const prepare = vi.spyOn(turnTarget, 'prepareThreadTurnTarget').mockResolvedValue(detail)
  const props = await mount()
  await act(async () => { await controller.openThread('thread', 'old') })
  expect(prepare).toHaveBeenCalledWith('thread', 'old')
  expect(props.selectThread).toHaveBeenCalledWith('thread', { selectionGuard: expect.any(Function) })
  expect(turnTarget.useThreadTurnTarget.getState().target).toMatchObject({ threadId: 'thread', turnId: 'old', blocks: detail.blocks })
  expect(props.setRoute).toHaveBeenCalledWith('chat')
})

it('retains Rooms and never selects latest when the exact target is missing', async () => {
  vi.spyOn(turnTarget, 'prepareThreadTurnTarget').mockRejectedValue(new Error('turn not found: old'))
  const props = await mount()
  await expect(controller.openThread('thread', 'old')).rejects.toThrow('turn not found')
  expect(props.selectThread).not.toHaveBeenCalled()
  expect(props.setRoute).not.toHaveBeenCalled()
  expect(turnTarget.useThreadTurnTarget.getState().target).toBeNull()
})

it('retains Rooms when normal thread hydration fails after the exact turn was found', async () => {
  vi.spyOn(turnTarget, 'prepareThreadTurnTarget').mockResolvedValue(detail)
  const props = await mount(vi.fn(async () => {
    useChatStore.setState({ activeThreadId: 'thread', error: 'History unavailable' })
  }))
  await expect(controller.openThread('thread', 'old')).rejects.toThrow('History unavailable')
  expect(props.setRoute).not.toHaveBeenCalled()
  expect(turnTarget.useThreadTurnTarget.getState().target).toBeNull()
})

it('discards late target hydration after a newer navigation wins', async () => {
  let resolve!: (detail: ThreadDetail) => void
  vi.spyOn(turnTarget, 'prepareThreadTurnTarget')
    .mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    .mockResolvedValueOnce({ ...detail, latestTurnId: 'new', blocks: detail.blocks.map((block) => ({ ...block, turnId: 'new' })) })
  const props = await mount()
  const pending = controller.openThread('thread', 'old')
  await act(async () => { await controller.openThread('thread', 'new') })
  await act(async () => { resolve(detail); await pending })
  expect(props.selectThread).toHaveBeenCalledTimes(1)
  expect(turnTarget.useThreadTurnTarget.getState().target?.turnId).toBe('new')
})
