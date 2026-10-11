import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import type { RoomMessage } from '@shared/rooms-api'
import { RoomAppConnectionCard } from './RoomAppConnectionCard'
const mocks = vi.hoisted(() => ({ request: vi.fn(), roomsRequest: vi.fn() }))
vi.mock('./rooms-client', () => ({ roomsRequest: mocks.roomsRequest, roomRequestId: () => 'skip-1' }))
const card = { id: 'im-card', roomId: 'agent-room', body: 'Continue our conversation in Feishu', bodyRevision: 0,
  presentationKind: 'app_connection', appConnection: { serverId: 'im.feishu', status: 'requested', resumed: false } } as RoomMessage
let renderer: ReactTestRenderer | undefined
const button = (text: string) => renderer!.root.findAllByType('button').find((item) => item.children.includes(text))!
beforeEach(async () => {
  await i18n.changeLanguage('en'); vi.useFakeTimers()
  mocks.request.mockReset(); mocks.roomsRequest.mockReset()
  mocks.request.mockResolvedValue({ status: 'requested' })
  vi.stubGlobal('window', { kunGui: { personalAgentIm: mocks.request } })
})
afterEach(() => { if (renderer) act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals() })
describe('Agent IM native consent card', () => {
  it('renders consent and capability boundaries without starting registration', async () => {
    await act(async () => { renderer = create(createElement(RoomAppConnectionCard, { message: card })) })
    expect(mocks.request).toHaveBeenCalledWith({ action: 'status', roomId: 'agent-room', cardId: 'im-card' })
    expect(mocks.request.mock.calls.some(([input]) => input.action === 'start')).toBe(false)
    expect(JSON.stringify(renderer!.toJSON())).toContain('Keep Kun open')
    expect(JSON.stringify(renderer!.toJSON())).toContain('verified scanning account')
  })
  it('shows only the official returned QR after Continue and cancels on dismissal', async () => {
    await act(async () => { renderer = create(createElement(RoomAppConnectionCard, { message: card })) })
    mocks.request.mockResolvedValueOnce({ status: 'qr', attemptId: 'attempt1', url: 'https://open.feishu.cn/official', expiresAt: Date.now() + 300_000, interval: 3 })
    await act(async () => { button('Continue to official QR').props.onClick() })
    expect(mocks.request).toHaveBeenCalledWith({ action: 'start', roomId: 'agent-room', cardId: 'im-card', isLark: false })
    expect(renderer!.root.findAllByProps({ className: 'rooms-im-qr' })).toHaveLength(1)
    await act(async () => renderer!.unmount()); renderer = undefined
    expect(mocks.request).toHaveBeenCalledWith({ action: 'cancel', roomId: 'agent-room', cardId: 'im-card', attemptId: 'attempt1' })
  })
  it('offers regeneration after expiry and never saves QR content in a room message', async () => {
    await act(async () => { renderer = create(createElement(RoomAppConnectionCard, { message: card })) })
    mocks.request.mockResolvedValueOnce({ status: 'qr', attemptId: 'attempt1', url: 'https://open.feishu.cn/official', expiresAt: Date.now() + 1000, interval: 3 })
    await act(async () => { button('Continue to official QR').props.onClick() })
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    expect(JSON.stringify(renderer!.toJSON())).toContain('QR code expired')
    expect(mocks.roomsRequest).not.toHaveBeenCalled()
    expect(button('Continue to official QR')).toBeTruthy()
  })
  it('skips without requesting QR or credentials', async () => {
    mocks.roomsRequest.mockResolvedValue({})
    await act(async () => { renderer = create(createElement(RoomAppConnectionCard, { message: card })) })
    await act(async () => { button('Not now').props.onClick() })
    expect(mocks.request.mock.calls.some(([input]) => input.action === 'start')).toBe(false)
    expect(mocks.roomsRequest).toHaveBeenCalledWith('/v1/rooms/agent-room/app-connections/im-card/skip', 'POST', { clientRequestId: 'skip-1' })
  })
})
