import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { Room } from '@shared/rooms-api'
const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn() }))
vi.mock('./agent-client', () => ({ agentPath: (id: string) => id, useAgentResource: () => ({
  data: { active: { id: 'request', revision: 1 } }, error: '', refresh: mocks.refresh }) }))
vi.mock('./rooms-client', () => ({ roomsRequest: mocks.request, roomPath: (id: string) => id, roomRequestId: () => 'action' }))
import { useDirectChat } from './RoomDirectChat'
let renderer: ReactTestRenderer | undefined
let state: ReturnType<typeof useDirectChat>
function Harness({ id }: { id: string }) { state = useDirectChat({ id, conversationKind: 'user_agent' } as Room, vi.fn()); return null }
afterEach(() => { if (renderer) act(() => renderer?.unmount()); renderer = undefined; vi.clearAllMocks() })
it('lets Retry clear a failed action instead of permanently disabling the browser', async () => {
  mocks.request.mockRejectedValue(new Error('Stop request interrupted'))
  await act(async () => { renderer = create(createElement(Harness, { id: 'room-a' })) })
  await act(async () => state.act('stop'))
  expect(state.error).toContain('Stop request interrupted')
  act(() => state.refresh())
  expect(state.error).toBe('')
  expect(mocks.refresh).toHaveBeenCalledOnce()
})
it('does not let an old refresh clear a different room error', async () => {
  mocks.request.mockRejectedValue(new Error('Current room action failed'))
  await act(async () => { renderer = create(createElement(Harness, { id: 'room-a' })) })
  const prior = state.refresh
  await act(async () => renderer!.update(createElement(Harness, { id: 'room-b' })))
  await act(async () => state.act('stop'))
  act(prior)
  expect(state.error).toContain('Current room action failed')
  expect(mocks.refresh).not.toHaveBeenCalled()
})
