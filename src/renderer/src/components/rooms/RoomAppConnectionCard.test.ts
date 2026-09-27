import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import type { RoomMessage } from '@shared/rooms-api'
import { RoomAppConnectionCard } from './RoomAppConnectionCard'

const mocks = vi.hoisted(() => ({ listRoomApps: vi.fn(), addRoomApp: vi.fn(), authorizeRoomApp: vi.fn(), roomsRequest: vi.fn() }))
vi.mock('./room-apps-client', () => ({ listRoomApps: mocks.listRoomApps, addRoomApp: mocks.addRoomApp,
  authorizeRoomApp: mocks.authorizeRoomApp }))
vi.mock('./rooms-client', () => ({ roomsRequest: mocks.roomsRequest, roomRequestId: () => 'click-1' }))

const card = { id: 'card-1', roomId: 'private-room', body: 'I need Gmail to search your inbox.', bodyRevision: 0,
  presentationKind: 'app_connection', appConnection: { serverId: 'google_gmail', status: 'requested', resumed: false } } as RoomMessage

describe('Room app connection card', () => {
  let renderer: ReactTestRenderer | undefined
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    Object.values(mocks).forEach((mock) => mock.mockReset())
  })
  afterEach(() => { if (renderer) act(() => renderer?.unmount()) })

  it('adds the known app, starts OAuth, then asks Kun to continue the task', async () => {
    mocks.listRoomApps.mockResolvedValue({ servers: [], statuses: {}, oauth: {} })
    mocks.addRoomApp.mockResolvedValue(undefined)
    mocks.authorizeRoomApp.mockResolvedValue(undefined)
    mocks.roomsRequest.mockResolvedValue({ message: { ...card, bodyRevision: 1,
      appConnection: { serverId: 'google_gmail', status: 'connected', resumed: true } } })
    await act(async () => { renderer = create(createElement(RoomAppConnectionCard, { message: card })) })
    const continueButton = renderer!.root.findAllByType('button').find((button) => button.children.some((child) => child === 'Continue'))!
    await act(async () => { continueButton.props.onClick(); await Promise.resolve() })
    expect(mocks.addRoomApp).toHaveBeenCalledWith('google_gmail', 'https://gmailmcp.googleapis.com/mcp/v1')
    expect(mocks.authorizeRoomApp).toHaveBeenCalledWith('google_gmail')
    expect(mocks.roomsRequest).toHaveBeenCalledWith('/v1/rooms/private-room/app-connections/card-1/complete', 'POST', { clientRequestId: 'click-1' })
    expect(renderer!.root.findByProps({ className: 'rooms-app-connection-done' }).children.some((child) => child === 'Kun is continuing the task')).toBe(true)
  })

  it('skips without adding or authorizing the app', async () => {
    mocks.roomsRequest.mockResolvedValue({ message: { ...card, bodyRevision: 1,
      appConnection: { serverId: 'google_gmail', status: 'skipped', resumed: true } } })
    await act(async () => { renderer = create(createElement(RoomAppConnectionCard, { message: card })) })
    const skip = renderer!.root.findAllByType('button').find((button) => button.children.includes('Skip'))!
    await act(async () => { skip.props.onClick(); await Promise.resolve() })
    expect(mocks.addRoomApp).not.toHaveBeenCalled()
    expect(mocks.authorizeRoomApp).not.toHaveBeenCalled()
    expect(mocks.roomsRequest).toHaveBeenCalledWith('/v1/rooms/private-room/app-connections/card-1/skip', 'POST', { clientRequestId: 'click-1' })
  })
})
