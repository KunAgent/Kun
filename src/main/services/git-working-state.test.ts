import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  addBareRemote,
  cleanupTestRepositories,
  createTestRepository,
  gitAvailable,
  isolateGitConfig,
  tempDirectory
} from './git-test-repository'
import { getGitWorkingState, parseGitStatusPorcelainV2, parseNumstatZ } from './git-working-state'

beforeAll(isolateGitConfig)
afterEach(cleanupTestRepositories)

describe('git working state parsing', () => {
  it('splits porcelain v2 records into staged and unstaged entries', () => {
    const stdout = [
      '# branch.oid 0123456789abcdef0123456789abcdef01234567',
      '# branch.head feature/x',
      '# branch.upstream origin/feature/x',
      '# branch.ab +2 -1',
      '1 MM N... 100644 100644 100644 aaa bbb src/both changed.ts',
      '1 .D N... 100644 100644 000000 aaa aaa gone.ts',
      '2 R. N... 100644 100644 100644 aaa bbb R100 src/new.ts',
      'src/old.ts',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts',
      '? notes/todo list.md',
      ''
    ].join('\0')
    const parsed = parseGitStatusPorcelainV2(stdout)
    expect(parsed).toMatchObject({ branch: 'feature/x', upstream: 'origin/feature/x', ahead: 2, behind: 1 })
    expect(parsed.staged).toEqual([
      { path: 'src/both changed.ts', status: 'modified' },
      { path: 'src/new.ts', previousPath: 'src/old.ts', status: 'renamed' }
    ])
    expect(parsed.unstaged).toEqual([
      { path: 'src/both changed.ts', status: 'modified' },
      { path: 'gone.ts', status: 'deleted' },
      { path: 'conflict.ts', status: 'conflicted' },
      { path: 'notes/todo list.md', status: 'untracked' }
    ])
  })

  it('reads an unborn header and collapsed untracked folders', () => {
    const parsed = parseGitStatusPorcelainV2(['# branch.oid (initial)', '# branch.head main', '? vendor/', ''].join('\0'))
    expect(parsed).toMatchObject({ head: null, branch: 'main', upstream: null, ahead: 0, behind: 0 })
    expect(parsed.unstaged).toEqual([{ path: 'vendor', status: 'untracked' }])
  })

  it('keys numstat renames by destination and marks binary files', () => {
    const stdout = ['3\t1\tsrc/a.ts', '0\t0\t', 'old.ts', 'new.ts', '-\t-\timage.png', ''].join('\0')
    expect([...parseNumstatZ(stdout)]).toEqual([
      ['src/a.ts', { additions: 3, deletions: 1 }],
      ['new.ts', { additions: 0, deletions: 0 }],
      ['image.png', { additions: null, deletions: null }]
    ])
  })
})

describe.skipIf(!gitAvailable())('git working state in a real repository', () => {
  it('reports staged, unstaged and untracked files with line counts from a sub-folder', async () => {
    const repo = await createTestRepository()
    await repo.write('src/app.ts', 'export const a = 2\nexport const b = 3\n')
    repo.git('add', 'src/app.ts')
    await repo.write('README.md', 'one\n')
    await repo.write('docs/new note.md', 'a\nb\nc\n')
    const state = await getGitWorkingState(join(repo.root, 'src'))
    expect(state.ok).toBe(true)
    if (!state.ok) return
    expect(state.repositoryRoot).toBe(repo.root)
    expect(state.branch).toBe('main')
    expect(state.upstream).toBeNull()
    expect(state.pushRemote).toBeNull()
    expect(state.staged).toEqual([{ path: 'src/app.ts', status: 'modified', additions: 2, deletions: 1 }])
    expect(state.unstaged).toEqual([
      { path: 'README.md', status: 'modified', additions: 0, deletions: 1 },
      { path: 'docs/new note.md', status: 'untracked', additions: 3, deletions: 0 }
    ])
  })

  it('tracks ahead / behind against the upstream and counts unpushed commits without one', async () => {
    const repo = await createTestRepository()
    await addBareRemote(repo)
    repo.git('push', '-q', '-u', 'origin', 'main')
    await repo.write('a.txt', 'a\n')
    repo.git('add', '.')
    repo.git('commit', '-q', '-m', 'ahead')
    const tracked = await getGitWorkingState(repo.root)
    expect(tracked).toMatchObject({ ok: true, upstream: 'origin/main', ahead: 1, behind: 0, unpushed: 1, pushRemote: 'origin' })

    repo.git('switch', '-q', '-c', 'feature')
    await repo.write('b.txt', 'b\n')
    repo.git('add', '.')
    repo.git('commit', '-q', '-m', 'feature work')
    const untracked = await getGitWorkingState(repo.root)
    expect(untracked).toMatchObject({ ok: true, branch: 'feature', upstream: null, ahead: 0, unpushed: 2, pushRemote: 'origin' })
  })

  it('handles a repository before its first commit', async () => {
    const repo = await createTestRepository({ commit: false })
    await repo.write('first.txt', 'x\n')
    repo.git('add', 'first.txt')
    const state = await getGitWorkingState(repo.root)
    expect(state).toMatchObject({
      ok: true,
      head: null,
      staged: [{ path: 'first.txt', status: 'added', additions: 1, deletions: 0 }],
      unstaged: []
    })
  })

  it('reports a folder outside any repository', async () => {
    const outside = await tempDirectory('kun-git-outside-')
    const state = await getGitWorkingState(outside)
    expect(state).toMatchObject({ ok: false })
  })
})
