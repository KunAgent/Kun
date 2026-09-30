import { describe, expect, it } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import { privateDeliveryState } from './room-im-delivery.js'

const at = Date.parse('2026-09-29T09:00:00.000Z')
function result(id: string, toolName: string, seconds: number, output: unknown = { ok: true }, isError = false): TurnItem {
  return { id, kind: 'tool_result', role: 'tool', status: 'completed', threadId: 'thread', turnId: 'turn',
    createdAt: new Date(at + seconds * 1000).toISOString(), callId: id, toolName, output, isError } as TurnItem
}
const publish = (id: string, phase: string, seconds: number) => result(id, 'send_im_message', seconds,
  { accepted: true, phase })

describe('private Room delivery state', () => {
  it('requires a visible response for a new user request and preserves silent wakes', () => {
    expect(privateDeliveryState([], 'turn', at, true).gate).toBe('start')
    expect(privateDeliveryState([], 'turn', at, false).gate).toBe('none')
    expect(privateDeliveryState([result('failed', 'send_im_message', 1, {}, true)], 'turn', at + 5000, true).gate).toBe('start')
  })

  it('triggers bounded progress after time or completed work, then resets', () => {
    const start = publish('start', 'start', 0)
    const five = [1, 2, 3, 4, 5].map((n) => result(String(n), 'bash', n))
    expect(privateDeliveryState([start, ...five], 'turn', at + 9000, true).gate).toBe('none')
    expect(privateDeliveryState([start, ...five], 'turn', at + 30000, true).gate).toBe('progress')
    const six = result('6', 'bash', 9)
    expect(privateDeliveryState([start, ...five, six], 'turn', at + 9999, true).gate).toBe('none')
    expect(privateDeliveryState([start, ...five, six], 'turn', at + 10000, true).gate).toBe('progress')
    expect(privateDeliveryState([start, ...five, six, publish('update', 'progress', 11)], 'turn', at + 31000, true).gate).toBe('none')
  })

  it('invalidates a final answer when later work occurs and accepts a user card', () => {
    const final = publish('final', 'final', 0)
    expect(privateDeliveryState([final], 'turn', at + 1000, true).finalCurrent).toBe(true)
    expect(privateDeliveryState([final, result('work', 'bash', 2)], 'turn', at + 32000, true)).toMatchObject({
      finalCurrent: false, gate: 'progress'
    })
    expect(privateDeliveryState([result('card', 'request_app_connection', 1, { requested: true })], 'turn', at + 1000, true))
      .toMatchObject({ published: true, waitingOnUser: true, gate: 'none' })
  })

  it('answers a new steering message at the next safe model step', () => {
    const user = { id: 'steer', kind: 'user_message', role: 'user', status: 'completed', threadId: 'thread', turnId: 'turn',
      createdAt: new Date(at + 2000).toISOString(), text: 'Also check the profile.' } as TurnItem
    expect(privateDeliveryState([publish('first', 'start', 0), user], 'turn', at + 3000, true).gate).toBe('start')
  })

  it('treats a pending user card as visible without treating its later answer as a final reply', () => {
    const card = { id: 'input', kind: 'user_input', role: 'assistant', status: 'pending',
      threadId: 'thread', turnId: 'turn', createdAt: new Date(at + 1000).toISOString() } as TurnItem
    expect(privateDeliveryState([card], 'turn', at + 2000, true)).toMatchObject({
      published: true, waitingOnUser: true, gate: 'none', finalCurrent: false
    })
    expect(privateDeliveryState([{ ...card, status: 'submitted' } as TurnItem], 'turn', at + 2000, true)).toMatchObject({
      published: true, waitingOnUser: false, finalCurrent: false
    })
  })

  it('does not count an already connected app as a visible card and recovers a committed message without a tool result', () => {
    expect(privateDeliveryState([result('connected', 'request_app_connection', 1,
      { connected: true })], 'turn', at + 2000, true).gate).toBe('start')
    expect(privateDeliveryState([], 'turn', at + 2000, true, {
      lastVisibleAt: new Date(at + 1000).toISOString(), lastDeliveryPhase: 'final'
    })).toMatchObject({ published: true, finalCurrent: true, gate: 'none' })
  })
})
