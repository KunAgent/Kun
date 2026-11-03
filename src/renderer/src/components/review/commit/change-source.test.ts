import { describe, expect, it } from 'vitest'
import type { GitWorkingState } from '@shared/git-commit'
import type { ChatBlock } from '../../../agent/types'
import { commitPlan, discardSummary, firstPushCommand, lastTurnBlocks, splitRepositoryPath } from './change-source'

type ReadyState = Extract<GitWorkingState, { ok: true }>

function state(patch: Partial<ReadyState> = {}): ReadyState {
  return {
    ok: true, repositoryRoot: '/repo', branch: 'kun/x', head: 'abc1234', upstream: 'origin/kun/x', ahead: 0, behind: 0,
    unpushed: 0, pushRemote: 'origin', staged: [], unstaged: [], truncated: false, ...patch
  }
}
const file = (path: string, status: ReadyState['staged'][number]['status'] = 'modified') =>
  ({ path, status, additions: 1, deletions: 0 })

describe('change sources', () => {
  it('takes the blocks after the last user message as the last turn', () => {
    const blocks = [
      { kind: 'user', id: 'u1' },
      { kind: 'assistant', id: 'a1' },
      { kind: 'user', id: 'u2' },
      { kind: 'assistant', id: 'a2' }
    ] as unknown as ChatBlock[]
    expect(lastTurnBlocks(blocks).map((block) => block.id)).toEqual(['a2'])
    expect(lastTurnBlocks(blocks.slice(1, 2)).map((block) => block.id)).toEqual(['a1'])
  })

  it('splits paths into name and folder', () => {
    expect(splitRepositoryPath('src/a/b.ts')).toEqual({ name: 'b.ts', directory: 'src/a' })
    expect(splitRepositoryPath('README.md')).toEqual({ name: 'README.md', directory: '' })
  })
})

describe('commit plan', () => {
  it('commits the index when something is staged', () => {
    expect(commitPlan(state({ staged: [file('a')], unstaged: [file('b')] }))).toMatchObject({
      stageAll: false, fileCount: 1, canCommit: true, canPush: true, firstPush: false, pushOnly: 0
    })
  })

  it('stages everything first when nothing is staged', () => {
    expect(commitPlan(state({ unstaged: [file('a'), file('b', 'untracked')] }))).toMatchObject({ stageAll: true, fileCount: 2 })
  })

  it('blocks commits on conflicts and pushes on detached HEAD or a missing remote', () => {
    expect(commitPlan(state({ unstaged: [file('a', 'conflicted')] }))).toMatchObject({ canCommit: false, blocker: 'conflicts' })
    expect(commitPlan(state({ branch: null, staged: [file('a')] }))).toMatchObject({ canPush: false, pushBlocker: 'detached' })
    expect(commitPlan(state({ pushRemote: null, staged: [file('a')] }))).toMatchObject({ canPush: false, pushBlocker: 'no_remote' })
  })

  it('offers a push for unpushed commits and for a branch the remote does not have yet', () => {
    expect(commitPlan(state({ ahead: 2, unpushed: 2 })).pushOnly).toBe(2)
    expect(commitPlan(state({ upstream: null }))).toMatchObject({ firstPush: true, pushOnly: 1 })
    expect(commitPlan(state())).toMatchObject({ pushOnly: 0 })
    expect(commitPlan(state({ upstream: null, head: null })).pushOnly).toBe(0)
    expect(firstPushCommand(state({ upstream: null }))).toBe('git push -u origin kun/x')
  })

  it('separates tracked and untracked files for the discard confirmation', () => {
    const summary = discardSummary([file('a'), file('b', 'untracked'), file('c', 'conflicted'), file('d', 'deleted')])
    expect(summary.tracked.map((entry) => entry.path)).toEqual(['a', 'd'])
    expect(summary.untracked.map((entry) => entry.path)).toEqual(['b'])
  })
})
