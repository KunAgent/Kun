import { expect, it } from 'vitest'
import type { RoomMessage } from '@shared/rooms-api'
import { projectStreamingMessage } from './RoomStreamingTimeline'
const message = (id: string, body: string, status: RoomMessage['status'] = 'streaming') => ({ id, body, status, messageSeq: 1 } as RoomMessage)
it('preserves every historical reference and never rolls a final result back to a draft', () => {
  const old = message('old', 'earlier', 'final'), draft = message('current', 'abc')
  const rows = [old, draft]
  const next = projectStreamingMessage(rows, message('current', 'abcdef'))
  expect(next[0]).toBe(old); expect(next[1].body).toBe('abcdef')
  expect(projectStreamingMessage(next, message('current', 'abc'))).toBe(next)
  const final = [old, message('current', 'final', 'final')]
  expect(projectStreamingMessage(final, message('current', 'abcdefghi'))).toBe(final)
  expect(projectStreamingMessage(final, null)).toBe(final)
})
