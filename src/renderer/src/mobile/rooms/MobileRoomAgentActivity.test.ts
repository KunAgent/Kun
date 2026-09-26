// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RoomMessage } from '@shared/rooms-api'
import type { Room } from '@shared/rooms-api'
import { directActivityLabelKey, groupActivity } from './MobileRoomAgentActivity'
import { ROOM_REPLY_AWAIT_TIMEOUT_MS, latestReplyId, useRoomReplyAwaiting } from '../../components/rooms/use-room-reply-awaiting'

const message = (id: string, authorKind: RoomMessage['authorKind']) => ({ id, authorKind }) as RoomMessage
const active = (status: string) => ({ active: { status }, approvals: [], userInputs: [] }) as never

it('labels the run like the desktop progress line', () => {
  expect(directActivityLabelKey(null, false)).toBeNull()
  expect(directActivityLabelKey(null, true)).toBe('directQueued')
  expect(directActivityLabelKey(active('running'), false)).toBe('directResponding')
  expect(directActivityLabelKey(active('pending'), false)).toBe('directQueued')
  expect(directActivityLabelKey(active('stopping'), false)).toBe('directStopping')
  expect(directActivityLabelKey({ active: { status: 'running' }, approvals: [{}], userInputs: [] } as never, false))
    .toBe('roomsState_needs_approval')
  expect(directActivityLabelKey({ active: { status: 'running',
    steer: { operationId: 'op', targetTurnId: 't1', targetRunId: 'r1' } }, approvals: [], userInputs: [] } as never, false))
    .toBe('directSteered')
})

it('describes group activity: responding, then waiting inbox, then receipt', () => {
  const room = { members: [{ id: 'm1', displayName: 'Dev' }, { id: 'm2', displayName: 'Review' }] } as unknown as Room
  const t = ((key: string, options?: { name?: string }) => options?.name ? `${key}:${options.name}` : key) as never
  expect(groupActivity(room, ['m1'], [], false, t)).toEqual({ memberId: 'm1', label: 'DevroomsTyping_is' })
  expect(groupActivity(room, [], ['m2'], false, t)).toBeNull()
  expect(groupActivity(room, [], ['m2'], true, t)).toEqual({ memberId: 'm2', label: 'roomsReceipt_waiting:Review' })
  expect(groupActivity(room, [], [], true, t)).toEqual({ label: 'roomsReceipt_fallback' })
})

it('finds the latest agent reply id', () => {
  expect(latestReplyId([message('a', 'member'), message('b', 'user')])).toBe('a')
  expect(latestReplyId([message('b', 'user')])).toBeNull()
})

let root: Root
let host: HTMLDivElement
let hook: ReturnType<typeof useRoomReplyAwaiting>
function Probe({ running, messages }: { running: boolean; messages: RoomMessage[] }) {
  hook = useRoomReplyAwaiting(running, messages)
  return null
}
const render = (running: boolean, messages: RoomMessage[]) => act(() => root.render(createElement(Probe, { running, messages })))
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

it('stays awaiting after send until the run starts', () => {
  const history = [message('old', 'member')]
  render(false, history)
  act(() => hook.markSent())
  expect(hook.awaiting).toBe(true)
  render(true, history)
  expect(hook.awaiting).toBe(false)
})

it('clears on a new agent reply or after the timeout', () => {
  const history = [message('old', 'member')]
  render(false, history)
  act(() => hook.markSent())
  render(false, [...history, message('new', 'member')])
  expect(hook.awaiting).toBe(false)
  act(() => hook.markSent())
  expect(hook.awaiting).toBe(true)
  act(() => { vi.advanceTimersByTime(ROOM_REPLY_AWAIT_TIMEOUT_MS) })
  expect(hook.awaiting).toBe(false)
})
