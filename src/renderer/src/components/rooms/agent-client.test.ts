import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./rooms-client', () => ({ roomsRequest: mocks.request, roomRequestId: () => 'request' }))
vi.mock('./useRoomEvents', () => ({ subscribeRoomEvents: () => () => undefined }))
import { useAgentResource } from './agent-client'

describe('Agent resource response scope', () => {
  let renderer: ReactTestRenderer
  let current: ReturnType<typeof useAgentResource<{ workspace: string }>>
  let renders: Array<{ path: string | null; workspace: string | undefined }>
  function Harness({ path, scopeKey }: { path: string | null; scopeKey?: string }) {
    current = useAgentResource<{ workspace: string }>(path, true, scopeKey)
    renders.push({ path, workspace: current.data?.workspace })
    return null
  }
  beforeEach(() => { renders = []; mocks.request.mockReset() })
  afterEach(() => { if (renderer) act(() => renderer.unmount()) })
  it('never renders a previous Agent workspace while the new room request is pending', async () => {
    mocks.request.mockResolvedValueOnce({ workspace: '/agent-a' })
    await act(async () => { renderer = create(createElement(Harness, { path: '/rooms/a/direct' })) })
    expect(current.data?.workspace).toBe('/agent-a')
    let complete: (value: { workspace: string }) => void = () => undefined
    mocks.request.mockReturnValueOnce(new Promise((resolve) => { complete = resolve }))
    await act(async () => renderer.update(createElement(Harness, { path: '/rooms/b/direct' })))
    expect(renders.filter((render) => render.path === '/rooms/b/direct').every((render) => !render.workspace)).toBe(true)
    await act(async () => complete({ workspace: '/agent-b' }))
    expect(current.data?.workspace).toBe('/agent-b')
    await act(async () => renderer.update(createElement(Harness, { path: null })))
    expect(current.data).toBeNull()
  })
  it('ignores an old Agent response after the path changes', async () => {
    let complete: (value: { workspace: string }) => void = () => undefined
    mocks.request.mockReturnValueOnce(new Promise((resolve) => { complete = resolve }))
    await act(async () => { renderer = create(createElement(Harness, { path: '/rooms/a/direct' })) })
    mocks.request.mockResolvedValueOnce({ workspace: '/agent-b' })
    await act(async () => renderer.update(createElement(Harness, { path: '/rooms/b/direct' })))
    await act(async () => complete({ workspace: '/agent-a' }))
    expect(current.data?.workspace).toBe('/agent-b')
  })
  it('invalidates the same room workspace when its private context epoch changes', async () => {
    mocks.request.mockResolvedValueOnce({ workspace: '/previous-project' })
    await act(async () => { renderer = create(createElement(Harness, { path: '/rooms/a/direct', scopeKey: 'a:0' })) })
    let complete: (value: { workspace: string }) => void = () => undefined
    mocks.request.mockReturnValueOnce(new Promise((resolve) => { complete = resolve }))
    await act(async () => renderer.update(createElement(Harness, { path: '/rooms/a/direct', scopeKey: 'a:1' })))
    expect(current.data).toBeNull()
    await act(async () => complete({ workspace: '/new-project' }))
    expect(current.data?.workspace).toBe('/new-project')
  })
})
