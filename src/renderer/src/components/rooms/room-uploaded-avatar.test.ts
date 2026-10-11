import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cacheRoomAvatar, useRoomUploadedAvatar } from './room-uploaded-avatar'
const request = vi.hoisted(() => vi.fn())
vi.mock('./rooms-client', () => ({ roomsRequest: request }))
let renderer: ReactTestRenderer
function Preview({ id }: { id?: string }) {
  return createElement('output', { 'data-url': useRoomUploadedAvatar(id) })
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); request.mockReset() })
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })
it('deduplicates loading and never applies a stale response after changing identity', async () => {
  let resolveOld!: (value: unknown) => void
  request.mockImplementation((path: string) => path.endsWith('/old')
    ? new Promise(resolve => { resolveOld = resolve })
    : Promise.resolve({ image: { mimeType: 'image/png', dataBase64: 'new' } }))
  await act(async () => { renderer = create(createElement(Preview, { id: 'old' })) })
  expect(renderer.root.findByType('output').props['data-url']).toBeUndefined()
  await act(async () => renderer.update(createElement(Preview, { id: 'new' })))
  expect(renderer.root.findByType('output').props['data-url']).toBe('data:image/png;base64,new')
  await act(async () => resolveOld({ image: { mimeType: 'image/png', dataBase64: 'old' } }))
  expect(renderer.root.findByType('output').props['data-url']).toBe('data:image/png;base64,new')
  await act(async () => renderer.update(createElement(Preview, {})))
  expect(renderer.root.findByType('output').props['data-url']).toBeUndefined()
})
it('uses cached images immediately and clears a missing or rejected image', async () => {
  cacheRoomAvatar('cached', { mimeType: 'image/png', dataBase64: 'cached', width: 1, height: 1 })
  request.mockRejectedValue(new Error('missing'))
  await act(async () => { renderer = create(createElement(Preview, { id: 'cached' })) })
  expect(renderer.root.findByType('output').props['data-url']).toBe('data:image/png;base64,cached')
  expect(request).not.toHaveBeenCalled()
  await act(async () => renderer.update(createElement(Preview, { id: 'absent' })))
  expect(renderer.root.findByType('output').props['data-url']).toBeUndefined()
})
