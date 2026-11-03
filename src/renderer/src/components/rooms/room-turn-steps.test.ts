import { describe, expect, it } from 'vitest'
import type { RoomMessage, RoomRunStep } from '@shared/rooms-api'
import { changedFiles, privateTurnPositions, stepClock, stepCounts, stepSpanMs, stepsBetween, isToolStep } from './room-turn-steps'

const message = (id: string, createdAt: string, extra: Partial<RoomMessage> = {}) =>
  ({ id, roomId: 'room', messageSeq: 1, authorKind: 'member', authorMemberId: 'kun', authorLabelSnapshot: 'Kun',
    body: id, bodyRevision: 0, mentionMemberIds: [], attachmentIds: [], status: 'final', createdAt, ...extra }) as RoomMessage
const tool = (id: string, startedAt: string, extra: Partial<Extract<RoomRunStep, { kind: 'tool' }>> = {}): RoomRunStep =>
  ({ id, kind: 'tool', toolName: 'bash', toolKind: 'command_execution', status: 'done', startedAt, ...extra })

describe('private chat turns', () => {
  it('gives each run one header and spans steered user messages and choice cards', () => {
    const rows = [
      message('user', '2026-10-18T00:10:00Z', { authorKind: 'user', authorMemberId: undefined }),
      message('start', '2026-10-18T00:11:00Z', { originRunId: 'run-1' }),
      message('steer', '2026-10-18T00:12:00Z', { authorKind: 'user', authorMemberId: undefined }),
      message('choice', '2026-10-18T00:12:30Z', { originRunId: 'run-1', presentationKind: 'choice' }),
      message('final', '2026-10-18T00:15:00Z', { originRunId: 'run-1' }),
      message('next', '2026-10-18T00:16:00Z', { originRunId: 'run-2' })
    ]
    const positions = privateTurnPositions(rows)
    expect(positions.get('user')).toBeUndefined()
    expect(positions.get('choice')).toBeUndefined()
    expect(positions.get('start')).toEqual({ runId: 'run-1', first: true, last: false })
    expect(positions.get('final')).toEqual({ runId: 'run-1', first: false, last: true, since: '2026-10-18T00:11:00Z' })
    expect(positions.get('next')).toEqual({ runId: 'run-2', first: true, last: true })
  })

  it('splits steps between messages without dropping or repeating one', () => {
    const steps = [tool('a', '2026-10-18T00:10:30Z'), tool('b', '2026-10-18T00:11:00Z'), tool('c', '2026-10-18T00:14:59Z'), tool('d', '2026-10-18T00:15:00Z')]
    const before = stepsBetween(steps, undefined, '2026-10-18T00:11:00Z')
    const middle = stepsBetween(steps, '2026-10-18T00:11:00Z', '2026-10-18T00:15:00Z')
    const after = stepsBetween(steps, '2026-10-18T00:15:00Z')
    expect([before, middle, after].map((part) => part.map((step) => step.id))).toEqual([['a'], ['b', 'c'], ['d']])
  })

  it('counts work by kind, edits by distinct file, and spans live steps to now', () => {
    const steps = [
      tool('cmd', '2026-10-18T00:11:00Z', { endedAt: '2026-10-18T00:11:04Z' }),
      tool('edit-1', '2026-10-18T00:11:05Z', { toolName: 'edit', toolKind: 'file_change', target: 'src/a.ts' }),
      tool('edit-2', '2026-10-18T00:11:06Z', { toolName: 'edit', toolKind: 'file_change', target: 'src/a.ts' }),
      tool('read', '2026-10-18T00:11:07Z', { toolName: 'read', toolKind: 'tool_call', status: 'running' })
    ].filter(isToolStep)
    expect(stepCounts(steps)).toEqual([{ group: 'command', count: 1 }, { group: 'edit', count: 1 }, { group: 'read', count: 1 }])
    expect(changedFiles(steps)).toEqual(['src/a.ts'])
    expect(stepSpanMs(steps, Date.parse('2026-10-18T00:12:00Z'))).toBe(60_000)
  })

  it('formats step time compactly', () => {
    expect(stepClock(800)).toBe('1s')
    expect(stepClock(221_000)).toBe('3:41')
    expect(stepClock(3_725_000)).toBe('1:02:05')
  })
})
