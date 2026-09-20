import { describe, expect, it } from 'vitest'
import type { RoomMessage, SendRoomMessage } from '@shared/rooms-api'
import {
  reconcilePendingSends,
  type RoomPendingSend
} from './useRoomPendingSends'
import {
  roomPeerInboxPaused,
  roomPeerUserActivity,
  roomRespondingMemberIds,
  roomWaitingMemberIds,
  roomPeerMemberBlocked
} from './room-receipt-helpers'
import type { RoomPeerTopicSummary } from '@shared/rooms-api'

const sendMessage = {
  clientRequestId: 'req-1',
  body: 'hello'
} as SendRoomMessage

const pendingItem = (overrides: Partial<RoomPendingSend> = {}): RoomPendingSend => ({
  clientRequestId: 'req-1',
  body: 'hello',
  message: sendMessage,
  createdAt: new Date().toISOString(),
  state: 'sending',
  ...overrides
})

const message = (clientRequestId?: string): RoomMessage =>
  ({
    id: 'msg-1',
    roomId: 'room',
    messageSeq: 1,
    authorKind: 'user',
    authorLabelSnapshot: 'me',
    body: 'hello',
    bodyRevision: 1,
    mentionMemberIds: [],
    attachmentIds: [],
    clientRequestId,
    createdAt: new Date().toISOString()
  }) as RoomMessage

describe('reconcilePendingSends', () => {
  it('drops optimistic rows once the server echoes the clientRequestId', () => {
    const result = reconcilePendingSends([pendingItem()], [message('req-1')], Date.now())
    expect(result).toHaveLength(0)
  })
  it('keeps rows that have no echo yet', () => {
    const result = reconcilePendingSends([pendingItem()], [message('other')], Date.now())
    expect(result).toHaveLength(1)
  })
  it('keeps failed rows until they are dismissed or retried', () => {
    const result = reconcilePendingSends(
      [pendingItem({ state: 'failed', error: 'boom' })],
      [],
      Date.now()
    )
    expect(result).toHaveLength(1)
  })
  it('times out unsettled rows so an echo-less runtime cannot strand them', () => {
    const old = pendingItem({
      state: 'sent',
      createdAt: new Date(Date.now() - 60_000).toISOString()
    })
    expect(reconcilePendingSends([old], [], Date.now())).toHaveLength(0)
  })
})

const member = (
  overrides: Partial<RoomPeerTopicSummary['members'][number]>
): RoomPeerTopicSummary['members'][number] => ({
  memberId: 'm1',
  state: 'idle',
  pendingCount: 0,
  seenInboxSeq: 0,
  handledInboxSeq: 0,
  responseCount: 0,
  ...overrides
})

const topic = (
  status: RoomPeerTopicSummary['status'],
  members: RoomPeerTopicSummary['members']
): RoomPeerTopicSummary =>
  ({ status, members }) as RoomPeerTopicSummary

describe('room-receipt-helpers', () => {
  it('lists responding and triaging members of active topics', () => {
    const topics = [
      topic('active', [member({ memberId: 'a', state: 'responding' }), member({ memberId: 'b', state: 'triaging' }), member({ memberId: 'c', state: 'idle' })]),
      topic('stopped', [member({ memberId: 'd', state: 'responding' })])
    ]
    expect(roomRespondingMemberIds(topics)).toEqual(['a', 'b'])
  })
  it('excludes blocked members from both lists', () => {
    expect(roomPeerMemberBlocked(member({ state: 'failed' }))).toBe(true)
    expect(roomPeerMemberBlocked(member({ waitingReason: 'member_budget_exhausted' }))).toBe(true)
    expect(roomPeerMemberBlocked(member({ state: 'responding' }))).toBe(false)
    const topics = [topic('active', [
      member({ memberId: 'a', state: 'responding', waitingReason: 'response_failed' }),
      member({ memberId: 'b', state: 'pending', pendingCount: 2 })
    ])]
    expect(roomRespondingMemberIds(topics)).toEqual([])
    expect(roomWaitingMemberIds(topics)).toEqual(['b'])
  })
  it('marks members with queued inbox events or pending state as waiting', () => {
    const topics = [topic('active', [
      member({ memberId: 'a', pendingCount: 1 }),
      member({ memberId: 'b', state: 'pending' }),
      member({ memberId: 'c', state: 'responding', pendingCount: 3 }),
      member({ memberId: 'd', state: 'idle' })
    ])]
    expect(roomWaitingMemberIds(topics)).toEqual(['a', 'b'])
  })
  it('does not count paused leftover inbox as user-facing pending work', () => {
    const stuck = topic('active', [
      member({ memberId: 'a', state: 'idle', pendingCount: 4, waitingReason: 'waiting_capacity' }),
      member({ memberId: 'b', state: 'pending', pendingCount: 1, waitingReason: 'waiting_capacity' })
    ])
    stuck.requestStatus = 'needs_input'
    expect(roomPeerInboxPaused(stuck, stuck.members[0])).toBe(true)
    expect(roomPeerUserActivity([stuck])).toEqual({ running: 0, pending: 0 })
    const working = topic('active', [
      member({ memberId: 'c', state: 'responding', pendingCount: 2 })
    ])
    expect(roomPeerUserActivity([working])).toEqual({ running: 1, pending: 2 })
  })
})
