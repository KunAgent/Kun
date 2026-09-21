import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room, RoomMessage } from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomEmojiPicker } from './RoomEmojiPicker'
import { RoomMessageRow } from './RoomMessageRow'

const api = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./rooms-client', async (original) => ({ ...(await original<typeof import('./rooms-client')>()),
  roomsRequest: api.request, roomRequestId: () => 'req-fixed' }))
vi.mock('./useRoomEvents', () => ({ subscribeRoomEvents: () => () => {} }))
vi.mock('./RoomMessageBody', () => ({ RoomMessageBody: ({ body }: { body: string }) => createElement('p', {}, body) }))

const room = { id: 'room', members: [{ id: 'member', displayName: 'Member', role: 'developer' }] } as unknown as Room
const message = { id: 'm1', roomId: 'room', authorKind: 'member', authorMemberId: 'member',
  authorLabelSnapshot: 'Member', body: 'hello', rootRequestId: 'topic', messageSeq: 1, bodyRevision: 0,
  mentionMemberIds: [], attachmentIds: [], createdAt: '2026-09-15T00:00:00Z' } as RoomMessage
const props = { onReply: vi.fn(), onPin: vi.fn(), onTask: vi.fn(), onViewReply: vi.fn() }

describe('room message row actions', () => {
  let renderer: ReactTestRenderer | undefined
  beforeEach(async () => { await i18n.changeLanguage('en'); api.request.mockReset().mockResolvedValue({ reactions: { roomId: 'room', messageId: 'm1', revision: 0, reactions: [] } }) })
  afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined })

  it('offers the emoji picker inside the message action toolbar and posts new reactions', async () => {
    await act(async () => { renderer = create(createElement(RoomMessageRow, { room, message, ...props })) })
    const picker = renderer!.root.findByType(RoomEmojiPicker)
    expect(picker.props.disabled).toBe(false)
    await act(async () => picker.props.onChoose('🎉'))
    expect(api.request).toHaveBeenCalledWith('/v1/rooms/room/messages/m1/reactions', 'PUT',
      { clientRequestId: 'req-fixed', emoji: '🎉', active: true })
  })

  it('omits the reaction picker when no room context is available', async () => {
    await act(async () => { renderer = create(createElement(RoomMessageRow, { message, ...props })) })
    expect(renderer!.root.findAllByType(RoomEmojiPicker)).toHaveLength(0)
  })
})
