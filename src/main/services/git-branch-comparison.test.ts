import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getGitBranchComparison, getGitFileDiff, parseNameStatusZ } from './git-branch-comparison'
import {
  addBareRemote,
  cleanupTestRepositories,
  createTestRepository,
  gitAvailable,
  isolateGitConfig
} from './git-test-repository'

beforeAll(isolateGitConfig)
afterEach(cleanupTestRepositories)

describe('branch comparison parsing', () => {
  it('reads renames and plain entries from name-status output', () => {
    expect(parseNameStatusZ(['M', 'src/a.ts', 'R087', 'old.ts', 'new.ts', 'D', 'gone.ts', ''].join('\0'))).toEqual([
      { path: 'src/a.ts', status: 'modified' },
      { path: 'new.ts', previousPath: 'old.ts', status: 'renamed' },
      { path: 'gone.ts', status: 'deleted' }
    ])
  })
})

describe.skipIf(!gitAvailable())('branch comparison in a real repository', () => {
  it('compares with the nearest base and lists commits, uncommitted and new files', async () => {
    const repo = await createTestRepository()
    await addBareRemote(repo)
    repo.git('push', '-q', '-u', 'origin', 'main')
    repo.git('remote', 'set-head', 'origin', 'main')
    repo.git('switch', '-q', '-c', 'develop')
    await repo.write('develop.txt', 'd\n')
    repo.git('add', '.')
    repo.git('commit', '-q', '-m', 'develop work')
    repo.git('switch', '-q', '-c', 'kun/feature')
    await repo.write('src/app.ts', 'export const a = 2\n')
    repo.git('commit', '-q', '-am', 'feat: change a')
    repo.git('push', '-q', '-u', 'origin', 'kun/feature')
    await repo.write('feature.txt', 'f\n')
    repo.git('add', '.')
    repo.git('commit', '-q', '-m', 'feat: add feature file')
    await repo.write('README.md', 'one\n')
    await repo.write('scratch.md', 's\n')

    const result = await getGitBranchComparison(repo.root)
    expect(result).toMatchObject({ ok: true, base: 'develop', ahead: 2, behind: 0 })
    if (!result.ok) return
    expect(result.mergeBase).toBe(repo.git('rev-parse', 'develop').trim())
    expect(result.files.map((file) => [file.path, file.status])).toEqual([
      ['README.md', 'modified'],
      ['feature.txt', 'added'],
      ['src/app.ts', 'modified'],
      ['scratch.md', 'untracked']
    ])
    expect(result.commits.map((commit) => [commit.subject, commit.pushed])).toEqual([
      ['feat: add feature file', false],
      ['feat: change a', true]
    ])

    const branchDiff = await getGitFileDiff({ workspaceRoot: repo.root, side: 'branch', path: 'src/app.ts', mergeBase: result.mergeBase })
    expect(branchDiff).toMatchObject({ ok: true, binary: false, truncated: false })
    if (branchDiff.ok) expect(branchDiff.diff).toContain('+export const a = 2')
  })

  it('has no base on the only branch', async () => {
    const repo = await createTestRepository()
    expect(await getGitBranchComparison(repo.root)).toMatchObject({ ok: false, reason: 'no_base' })
  })

  it('diffs one file per side, including untracked files', async () => {
    const repo = await createTestRepository()
    await repo.write('src/app.ts', 'export const a = 2\n')
    repo.git('add', 'src/app.ts')
    await repo.write('src/app.ts', 'export const a = 3\n')
    await repo.write('new.txt', 'hello\n')
    const staged = await getGitFileDiff({ workspaceRoot: repo.root, side: 'staged', path: 'src/app.ts' })
    const unstaged = await getGitFileDiff({ workspaceRoot: repo.root, side: 'unstaged', path: 'src/app.ts' })
    const untracked = await getGitFileDiff({ workspaceRoot: repo.root, side: 'unstaged', path: 'new.txt', untracked: true })
    expect(staged.ok && staged.diff).toContain('+export const a = 2')
    expect(unstaged.ok && unstaged.diff).toContain('+export const a = 3')
    expect(untracked.ok && untracked.diff).toContain('+hello')
    expect(await getGitFileDiff({ workspaceRoot: repo.root, side: 'unstaged', path: '../etc/passwd' })).toMatchObject({ ok: false })
    expect(await getGitFileDiff({ workspaceRoot: repo.root, side: 'branch', path: 'src/app.ts', mergeBase: 'HEAD' })).toMatchObject({ ok: false })
  })
})
