import { expect, it } from 'vitest'
import type { RoomMessage } from '@shared/rooms-api'
import { projectStreamingMessages } from './RoomStreamingTimeline'
const message = (id: string, body: string, status: RoomMessage['status'] = 'streaming', messageSeq = 1) =>
  ({ id, body, status, messageSeq } as RoomMessage)
it('preserves every historical reference and never rolls a final result back to a draft', () => {
  const old = message('old', 'earlier', 'final'), draft = message('current', 'abc')
  const rows = [old, draft]
  const next = projectStreamingMessages(rows, [message('current', 'abcdef')])
  expect(next[0]).toBe(old); expect(next[1].body).toBe('abcdef')
  expect(projectStreamingMessages(next, [message('current', 'abc')])).toBe(next)
  const final = [old, message('current', 'final', 'final')]
  expect(projectStreamingMessages(final, [message('current', 'abcdefghi')])).toBe(final)
  expect(projectStreamingMessages(final, [])).toBe(final)
})
it('keeps every live segment by id and lets a committed segment take over without duplication', () => {
  const rows = [message('user', 'ask', 'final', 0)]
  const live = [message('seg-1', 'first', 'streaming', 1), message('seg-2', 'second', 'streaming', 2)]
  const merged = projectStreamingMessages(rows, live)
  expect(merged.map((m) => m.id)).toEqual(['user', 'seg-1', 'seg-2'])
  const persisted = projectStreamingMessages([...rows, message('seg-1', 'first final', 'final', 1)],
    [message('seg-1', 'first final draft', 'streaming', 1), message('seg-2', 'second', 'streaming', 2)])
  expect(persisted.filter((m) => m.id === 'seg-1')).toHaveLength(1)
  expect(persisted.find((m) => m.id === 'seg-1')!.body).toBe('first final')
  expect(persisted.map((m) => m.id)).toEqual(['user', 'seg-1', 'seg-2'])
})
