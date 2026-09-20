import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Room, RoomMember } from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomContentCard } from './RoomContentCard'
import { RoomMessageBody } from './RoomMessageBody'
import { RoomLinkPreview } from './RoomLinkPreview'
import { RoomAvatar } from './RoomAvatar'
import { useRoomPresentationPreferences } from './room-presentation-preferences'

const requests = vi.hoisted(() => vi.fn())
vi.mock('./rooms-client', () => ({ roomsRequest: requests }))
vi.mock('./room-mentions', () => ({ RoomMentionBody: ({ body }: { body: string }) => body }))
vi.mock('./RoomImageLightbox', () => ({ RoomImageLightbox: () => null }))
const room = { id: 'content-room', revision: 1, members: [], repositories: [] } as unknown as Room
let renderer: ReactTestRenderer | undefined
let intersect: (entries: Array<{ isIntersecting: boolean }>) => void
beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof intersect) { intersect = callback }
    observe() {}
    disconnect() {}
  })
  requests.mockReset()
  useRoomPresentationPreferences.setState({ autoLinkPreviews: true })
})
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals() })

it('fetches image summary and thumbnail only after visibility, and original pixels only after a click', async () => {
  const reference = { kind: 'attachment', attachmentId: 'lazy-image' } as const
  requests.mockImplementation(async (path: string) => {
    const mode = new URL(path, 'http://kun').searchParams.get('mode')
    return { reference, state: 'available', title: 'Photo', kind: 'image', width: 800, height: 600,
      ...(mode === 'thumbnail' ? { thumbnail: { mimeType: 'image/jpeg', dataBase64: 'YQ==', width: 320, height: 240 } } : {}),
      ...(mode === 'preview' ? { preview: { type: 'image', image: { mimeType: 'image/png', dataBase64: 'YQ==', width: 800, height: 600 } } } : {}) }
  })
  await act(async () => { renderer = create(createElement(RoomContentCard, { room, reference, messageId: 'message' }), { createNodeMock: () => ({}) }) })
  expect(requests).not.toHaveBeenCalled()
  await act(async () => intersect([{ isIntersecting: true }]))
  expect(requests.mock.calls.map(([path]) => new URL(path, 'http://kun').searchParams.get('mode'))).toEqual(['summary', 'thumbnail'])
  const image = renderer!.root.findByType('img')
  expect(image.props.width).toBe(320)
  expect(image.props.height).toBe(240)
  expect(image.props.src).toMatch(/^data:image\/jpeg;/)
  await act(async () => renderer!.root.findByProps({ 'aria-label': 'Photo' }).props.onClick())
  expect(new URL(requests.mock.calls.at(-1)![0], 'http://kun').searchParams.get('mode')).toBe('preview')
  expect(requests.mock.calls.every(([path]) => new URL(path, 'http://kun').searchParams.get('message_id') === 'message')).toBe(true)
})

it('does not generate external previews for run traces, disabled settings, or offscreen messages', async () => {
  requests.mockResolvedValue({ preview: { state: 'none' } })
  await act(async () => { renderer = create(createElement(RoomMessageBody, { room, messageId: 'raw-trace', body: 'https://public.test', attachmentIds: [] })) })
  expect(requests).not.toHaveBeenCalled()
  act(() => renderer!.unmount())
  useRoomPresentationPreferences.setState({ autoLinkPreviews: false })
  await act(async () => { renderer = create(createElement(RoomLinkPreview, { roomId: room.id, messageId: 'message', body: 'https://public.test' }), { createNodeMock: () => ({}) }) })
  expect(requests).not.toHaveBeenCalled()
  act(() => useRoomPresentationPreferences.setState({ autoLinkPreviews: true }))
  expect(requests).not.toHaveBeenCalled()
  await act(async () => intersect([{ isIntersecting: true }]))
  expect(requests).toHaveBeenCalledTimes(1)
  act(() => renderer!.unmount())
  requests.mockClear()
  await act(async () => { renderer = create(createElement(RoomLinkPreview, { roomId: room.id, messageId: 'visible', body: 'https://public.test https://second.test' }), { createNodeMock: () => ({}) }) })
  expect(requests).not.toHaveBeenCalled()
  await act(async () => intersect([{ isIntersecting: true }]))
  expect(requests).toHaveBeenCalledTimes(1)
  expect(requests.mock.calls[0][0]).toBe('/v1/rooms/content-room/messages/visible/link-preview')
})

it('renders only proxied link image bytes and hides them immediately when previews are disabled', async () => {
  requests.mockImplementation(async (path: string) => path.endsWith('/image')
    ? { image: { mimeType: 'image/jpeg', dataBase64: 'YQ==', width: 120, height: 80 } }
    : { preview: { state: 'available', url: 'https://public.test', title: 'Public page', hasImage: true } })
  await act(async () => { renderer = create(createElement(RoomLinkPreview, { roomId: room.id, messageId: 'proxied', body: 'https://public.test' }), { createNodeMock: () => ({}) }) })
  await act(async () => intersect([{ isIntersecting: true }]))
  expect(renderer!.root.findByType('img').props.src).toBe('data:image/jpeg;base64,YQ==')
  expect(requests).toHaveBeenCalledTimes(2)
  act(() => useRoomPresentationPreferences.setState({ autoLinkPreviews: false }))
  expect(renderer!.root.findAllByType('img')).toHaveLength(0)
})

it('keeps the explicitly chosen builtin portrait stable when role or name changes', async () => {
  const member = { id: 'member', displayName: 'Name', role: 'developer', avatar: { kind: 'builtin', id: 'scientist' } } as RoomMember
  await act(async () => { renderer = create(createElement(RoomAvatar, { member, label: member.displayName })) })
  expect(renderer!.root.findByProps({ 'data-avatar-id': 'scientist' })).toBeTruthy()
  await act(async () => { renderer!.update(createElement(RoomAvatar, { member: { ...member, displayName: 'New name', role: 'reviewer' }, label: 'New name' })) })
  expect(renderer!.root.findByProps({ 'data-avatar-id': 'scientist' })).toBeTruthy()
  expect(requests).not.toHaveBeenCalled()
})
