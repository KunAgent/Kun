import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import { buildWorkSessionGroups, workSessionDisplayTitle } from './work-sessions-model'
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

describe('buildWorkSessionGroups', () => {
  it('groups Work sessions by space and library, newest first, with their anchors', () => {
    const groups = buildWorkSessionGroups({
      spaces: [SPACE],
      libraries: [LIBRARY],
      registry,
      boards: [{ id: 'roadmap', workspaceRoot: SPACE, threadIds: ['board'] }],
      threads: [
        thread('space', SPACE, { updatedAt: '2026-10-03T00:00:00.000Z' }),
        thread('doc', SPACE, { updatedAt: '2026-10-02T00:00:00.000Z' }),
        thread('board', SPACE, { updatedAt: '2026-10-01T00:00:00.000Z' }),
        thread('paper', LIBRARY),
        thread('code', SPACE, { agentSurface: 'code' }),
        thread('archived', SPACE, { archived: true }),
        thread('side', SPACE, { relation: 'side' })
      ]
    })
    expect(groups.map((group) => [group.kind, group.root])).toEqual([['space', SPACE], ['library', LIBRARY]])
    expect(groups[0].sessions.map((session) => [session.id, session.anchor.kind])).toEqual([
      ['space', 'space'], ['doc', 'file'], ['board', 'whiteboard']
    ])
    expect(groups[1].sessions[0].anchor).toEqual({ kind: 'paper', path: `${LIBRARY}/papers/react-2023` })
  })

  it('keeps empty spaces so they can start a session, and filters by title or file', () => {
    const groups = buildWorkSessionGroups({
      spaces: [SPACE, '/Users/me/Empty'],
      libraries: [],
      registry,
      threads: [thread('doc', SPACE), thread('space', SPACE, { title: 'Budget review' })],
      query: 'readme'
    })
    expect(groups.map((group) => group.sessions.map((session) => session.id))).toEqual([['doc'], []])
  })

  it('hides placeholder titles so the UI can name the session itself', () => {
    expect(workSessionDisplayTitle(WRITE_ASSISTANT_THREAD_TITLE)).toBe('')
    expect(workSessionDisplayTitle('  Quarterly plan ')).toBe('Quarterly plan')
  })
})
