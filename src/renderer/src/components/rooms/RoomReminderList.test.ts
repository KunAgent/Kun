import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import type { Room, RoomReminderEntry } from '@shared/rooms-api'
import { RoomReminderList } from './RoomReminderList'

const mocks = vi.hoisted(() => ({ resource: vi.fn(), pause: vi.fn(), cancel: vi.fn(), refresh: vi.fn() }))
vi.mock('./agent-client', () => ({ useAgentResource: mocks.resource }))
vi.mock('./rooms-client', () => ({ roomPath: (id: string) => `/v1/rooms/${id}`,
  roomsClient: { setRoomReminderPaused: mocks.pause, cancelRoomReminder: mocks.cancel } }))
const room = { id: 'private', conversationKind: 'user_agent' } as Room
const entry = { reminderId: 'reminder', roomId: room.id, note: 'Review current progress',
  status: 'scheduled', fireAt: '2026-09-30T13:00:00.000Z', updatedAt: '2026-09-30T12:00:00.000Z',
  timezone: 'America/New_York', recurrence: { kind: 'daily', localTime: '09:00' },
  quietHours: { start: '22:00', end: '08:00' }, revision: 2 } as RoomReminderEntry

describe('Room reminder controls', () => {
  let renderer: ReactTestRenderer | undefined
  const button = (label: string) => renderer!.root.findAllByType('button').find((item) => item.children.includes(label))!
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.resource.mockReturnValue({ data: { reminders: [entry] }, refresh: mocks.refresh })
    mocks.pause.mockResolvedValue(undefined); mocks.cancel.mockResolvedValue(undefined)
  })
  afterEach(() => { if (renderer) act(() => renderer?.unmount()) })
  it('shows the explicit timezone and recurrence, and pauses via the scoped client', async () => {
    await act(async () => { renderer = create(createElement(RoomReminderList, { room })) })
    const text = JSON.stringify(renderer!.toJSON())
    expect(text).toContain('America/New_York')
    expect(text).toContain('Daily at 09:00')
    expect(text).toContain('Quiet hours 22:00')
    await act(async () => { button('Pause').props.onClick() })
    expect(mocks.pause).toHaveBeenCalledWith(room.id, entry, true)
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })
  it('resumes paused schedules and allows cancellation', async () => {
    const paused = { ...entry, status: 'paused' }
    mocks.resource.mockReturnValue({ data: { reminders: [paused] }, refresh: mocks.refresh })
    await act(async () => { renderer = create(createElement(RoomReminderList, { room })) })
    await act(async () => { button('Resume').props.onClick() })
    expect(mocks.pause).toHaveBeenCalledWith(room.id, paused, false)
    await act(async () => { button('Cancel').props.onClick() })
    expect(mocks.cancel).toHaveBeenCalledWith(room.id, paused)
  })
  it('blocks repeated clicks during a mutation and exposes errors for retry', async () => {
    let reject!: (error: Error) => void
    mocks.pause.mockReturnValue(new Promise((_resolve, fail) => { reject = fail }))
    await act(async () => { renderer = create(createElement(RoomReminderList, { room })) })
    await act(async () => {
      const click = button('Pause').props.onClick
      click(); click()
    })
    expect(mocks.pause).toHaveBeenCalledOnce()
    expect(button('Cancel').props.disabled).toBe(true)
    await act(async () => { reject(new Error('Reminder changed since it was read')) })
    expect(renderer!.root.findByProps({ role: 'alert' }).children).toContain('Reminder changed since it was read')
    expect(button('Pause').props.disabled).toBe(false)
  })
  it('does not expose actions for completed schedules', async () => {
    mocks.resource.mockReturnValue({ data: { reminders: [{ ...entry, status: 'fired', endedReason: 'schedule_complete' }] }, refresh: mocks.refresh })
    await act(async () => { renderer = create(createElement(RoomReminderList, { room })) })
    expect(renderer!.root.findAllByType('button')).toHaveLength(0)
    expect(JSON.stringify(renderer!.toJSON())).toContain('Schedule completed')
  })
})
