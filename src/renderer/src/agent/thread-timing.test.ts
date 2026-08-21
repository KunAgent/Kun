import { describe, expect, it } from 'vitest'
import { buildTurnDurationByUserId } from './thread-timing'

describe('buildTurnDurationByUserId', () => {
  it.each(['completed', 'failed', 'aborted'])(
    'maps a %s runtime turn to its user message duration',
    (status) => {
      const durations = buildTurnDurationByUserId([
        {
          id: `turn-${status}`,
          status,
          createdAt: '2026-05-25T09:00:00.000Z',
          startedAt: '2026-05-25T09:00:01.000Z',
          finishedAt: '2026-05-25T09:01:13.500Z',
          items: [
            { id: `user-${status}`, kind: 'user_message' },
            { id: `assistant-${status}`, kind: 'assistant_text' }
          ]
        }
      ])

      expect(durations).toEqual({ [`user-${status}`]: 72_500 })
    }
  )

  it('falls back to item timestamps when the turn range is incomplete', () => {
    const durations = buildTurnDurationByUserId([
      {
        id: 'turn-2',
        status: 'failed',
        items: [
          {
            id: 'user-2',
            kind: 'user_message',
            createdAt: '2026-05-25T09:00:00.000Z'
          },
          {
            id: 'tool-2',
            kind: 'command_execution',
            createdAt: '2026-05-25T09:00:02.000Z',
            finishedAt: '2026-05-25T09:00:07.000Z'
          },
          {
            id: 'assistant-2',
            kind: 'assistant_text',
            createdAt: '2026-05-25T09:00:07.000Z',
            finishedAt: '2026-05-25T09:00:09.250Z'
          }
        ]
      }
    ])

    expect(durations).toEqual({ 'user-2': 9_250 })
  })

  it('ignores running turns and invalid terminal ranges', () => {
    const durations = buildTurnDurationByUserId([
      {
        id: 'turn-running',
        status: 'running',
        createdAt: '2026-05-25T09:00:00.000Z',
        items: [{ id: 'user-running', kind: 'user_message' }]
      },
      {
        id: 'turn-without-user',
        status: 'completed',
        startedAt: '2026-05-25T09:00:00.000Z',
        finishedAt: '2026-05-25T09:00:01.000Z',
        items: [{ id: 'assistant-3', kind: 'assistant_text' }]
      },
      {
        id: 'turn-negative',
        status: 'completed',
        startedAt: '2026-05-25T09:00:02.000Z',
        finishedAt: '2026-05-25T09:00:01.000Z',
        items: [{ id: 'user-4', kind: 'user_message' }]
      }
    ])

    expect(durations).toEqual({})
  })
})
