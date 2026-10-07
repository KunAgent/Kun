import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import { buildWorkSessions, workSessionDisplayTitle } from './work-sessions-model'
import { WRITE_ASSISTANT_THREAD_TITLE, type WriteThreadRegistry } from './write-thread-registry'

const SPACE = '/Users/me/Work/Reports'
const LIBRARY = '/Users/me/Papers'

function thread(id: string, workspace: string, extra: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    id,
    title: `Session ${id}`,
    updatedAt: '2026-10-01T00:00:00.000Z',
    model: 'deepseek-chat',
    mode: 'agent',
    workspace,
    agentSurface: 'write',
    ...extra
  }
}

const registry: WriteThreadRegistry = {
  version: 1,
  workspaces: {
    [SPACE]: {
      activeThreadId: 'doc',
      threadIds: ['doc', 'space', 'board'],
      fileThreadIds: { [`${SPACE}/README.md`]: 'doc' },
      fileThreadHistoryIds: { [`${SPACE}/README.md`]: ['doc'] }
    },
    [LIBRARY]: {
      activeThreadId: 'paper',
      threadIds: ['paper'],
      fileThreadIds: { [`${LIBRARY}/papers/react-2023`]: 'paper' },
      fileThreadHistoryIds: { [`${LIBRARY}/papers/react-2023`]: ['paper'] }
    }
  }
}

describe('buildWorkSessions', () => {
  it('lists the space\'s Work sessions newest first, with their anchors', () => {
    const sessions = buildWorkSessions({
      root: SPACE,
      registry: {
        ...registry,
        workspaces: {
          ...registry.workspaces,
          [SPACE]: {
            ...registry.workspaces[SPACE],
            threadIds: ['doc', 'space', 'board', 'unit', 'research'],
            fileThreadHistoryIds: {
              ...registry.workspaces[SPACE].fileThreadHistoryIds,
              [`${SPACE}/papers/react-2023`]: ['unit'],
              [`${SPACE}/.kun-research/rs-abc123`]: ['research']
            }
          }
        }
      },
      boards: [{ id: 'roadmap', workspaceRoot: SPACE, threadIds: ['board'] }],
      threads: [
        thread('space', SPACE, { updatedAt: '2026-10-05T00:00:00.000Z' }),
        thread('doc', SPACE, { updatedAt: '2026-10-04T00:00:00.000Z' }),
        thread('board', SPACE, { updatedAt: '2026-10-03T00:00:00.000Z' }),
        thread('unit', SPACE, { updatedAt: '2026-10-02T00:00:00.000Z' }),
        thread('research', SPACE, { updatedAt: '2026-10-01T00:00:00.000Z' }),
        thread('paper', LIBRARY),
        thread('code', SPACE, { agentSurface: 'code' }),
        thread('archived', SPACE, { archived: true }),
        thread('side', SPACE, { relation: 'side' })
      ]
    })
    expect(sessions.map((session) => [session.id, session.anchor.kind])).toEqual([
      ['space', 'space'], ['doc', 'file'], ['board', 'whiteboard'], ['unit', 'paper'], ['research', 'research']
    ])
    expect(sessions[3].anchor).toEqual({ kind: 'paper', path: `${SPACE}/papers/react-2023` })
    expect(sessions[4].anchor).toEqual({ kind: 'research', sessionId: 'rs-abc123' })
  })

  it('lists another space only for that space', () => {
    const sessions = buildWorkSessions({ root: LIBRARY, registry, threads: [thread('doc', SPACE), thread('paper', LIBRARY)] })
    expect(sessions.map((session) => session.id)).toEqual(['paper'])
  })

  it('filters by title or file', () => {
    const sessions = buildWorkSessions({
      root: SPACE,
      registry,
      threads: [thread('doc', SPACE), thread('space', SPACE, { title: 'Budget review' })],
      query: 'readme'
    })
    expect(sessions.map((session) => session.id)).toEqual(['doc'])
  })

  it('hides placeholder titles so the UI can name the session itself', () => {
    expect(workSessionDisplayTitle(WRITE_ASSISTANT_THREAD_TITLE)).toBe('')
    expect(workSessionDisplayTitle('  Quarterly plan ')).toBe('Quarterly plan')
  })
})
