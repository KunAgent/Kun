import { execFileSync } from 'node:child_process'
import { readFile, rename } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  commitGitChanges,
  discardGitPaths,
  pushGitBranch,
  stageGitPaths,
  unstageGitPaths
} from './git-commit-operations'
import {
  addBareRemote,
  cleanupTestRepositories,
  createTestRepository,
  gitAvailable,
  isolateGitConfig,
  repositoryAt,
  tempDirectory
} from './git-test-repository'
import { getGitWorkingState } from './git-working-state'

beforeAll(isolateGitConfig)
afterEach(cleanupTestRepositories)

async function lists(root: string): Promise<{ staged: string[]; unstaged: string[] }> {
  const state = await getGitWorkingState(root)
  if (!state.ok) throw new Error(state.message)
  return { staged: state.staged.map((entry) => entry.path), unstaged: state.unstaged.map((entry) => entry.path) }
}

describe.skipIf(!gitAvailable())('commit flow operations', () => {
  it('stages and unstages single paths and everything, including names that look like globs', async () => {
    const repo = await createTestRepository()
    await repo.write('src/app.ts', 'changed\n')
    await repo.write('weird[1].txt', 'glob\n')
    await repo.write('weird1.txt', 'plain\n')
    expect(await stageGitPaths({ workspaceRoot: repo.root, paths: ['weird[1].txt'] })).toEqual({ ok: true })
    expect((await lists(repo.root)).staged).toEqual(['weird[1].txt'])
    expect(await stageGitPaths({ workspaceRoot: repo.root })).toEqual({ ok: true })
    expect((await lists(repo.root)).staged).toEqual(['src/app.ts', 'weird1.txt', 'weird[1].txt'])
    expect(await unstageGitPaths({ workspaceRoot: repo.root, paths: ['src/app.ts'] })).toEqual({ ok: true })
    expect(await lists(repo.root)).toEqual({ staged: ['weird1.txt', 'weird[1].txt'], unstaged: ['src/app.ts'] })
    expect(await unstageGitPaths({ workspaceRoot: repo.root })).toEqual({ ok: true })
    expect((await lists(repo.root)).staged).toEqual([])
  })

  it('unstages before the first commit', async () => {
    const repo = await createTestRepository({ commit: false })
    await repo.write('a.txt', 'a\n')
    repo.git('add', 'a.txt')
    expect(await unstageGitPaths({ workspaceRoot: repo.root, paths: ['a.txt'] })).toEqual({ ok: true })
    expect(await lists(repo.root)).toEqual({ staged: [], unstaged: ['a.txt'] })
  })

  it('refuses paths that leave the repository', async () => {
    const repo = await createTestRepository()
    for (const path of ['../outside.txt', '/etc/hosts', 'src/../../x', '.', 'C:\\x']) {
      expect(await stageGitPaths({ workspaceRoot: repo.root, paths: [path] })).toMatchObject({ ok: false })
    }
    expect(await discardGitPaths({ workspaceRoot: repo.root, paths: ['../x'] }, async () => undefined)).toMatchObject({ ok: false })
  })

  it('restores tracked files from the index, keeps staged work and trashes untracked files', async () => {
    const repo = await createTestRepository()
    const trash = await tempDirectory('kun-git-trash-')
    await repo.write('README.md', 'staged\n')
    repo.git('add', 'README.md')
    await repo.write('README.md', 'staged then edited\n')
    await repo.write('src/app.ts', 'scratch\n')
    await repo.write('notes/new file.md', 'new\n')
    const trashed: string[] = []
    const result = await discardGitPaths(
      { workspaceRoot: repo.root, paths: ['README.md', 'src/app.ts', 'notes/new file.md', 'unchanged.txt'] },
      async (path) => {
        trashed.push(path)
        await rename(path, join(trash, basename(path)))
      }
    )
    expect(result).toEqual({ ok: true, restored: 2, trashed: 1 })
    expect(trashed).toEqual([join(repo.root, 'notes', 'new file.md')])
    expect(await readFile(join(repo.root, 'README.md'), 'utf8')).toBe('staged\n')
    expect(await readFile(join(repo.root, 'src', 'app.ts'), 'utf8')).toBe('export const a = 1\n')
    expect(await lists(repo.root)).toEqual({ staged: ['README.md'], unstaged: [] })
  })

  it('commits staged work, or everything when asked, and refuses empty commits', async () => {
    const repo = await createTestRepository()
    expect(await commitGitChanges({ workspaceRoot: repo.root, message: '  ' })).toMatchObject({ ok: false, reason: 'empty_message' })
    expect(await commitGitChanges({ workspaceRoot: repo.root, message: 'nothing' })).toMatchObject({ ok: false, reason: 'nothing_to_commit' })
    await repo.write('src/app.ts', 'export const a = 2\n')
    await repo.write('extra.txt', 'x\n')
    repo.git('add', 'src/app.ts')
    const staged = await commitGitChanges({ workspaceRoot: repo.root, message: 'feat: bump a\n\nBody line.\n' })
    expect(staged).toMatchObject({ ok: true, subject: 'feat: bump a' })
    expect(repo.git('log', '-1', '--format=%B').trim()).toBe('feat: bump a\n\nBody line.')
    expect((await lists(repo.root)).unstaged).toEqual(['extra.txt'])
    const all = await commitGitChanges({ workspaceRoot: repo.root, message: '-n starts like an option', stageAll: true })
    expect(all).toMatchObject({ ok: true, subject: '-n starts like an option' })
    expect(await lists(repo.root)).toEqual({ staged: [], unstaged: [] })
  })

  it('sets the upstream on the first push and pushes to it afterwards', async () => {
    const repo = await createTestRepository()
    const remote = await addBareRemote(repo)
    repo.git('switch', '-q', '-c', 'kun/feature')
    const first = await pushGitBranch({ workspaceRoot: repo.root })
    expect(first).toMatchObject({ ok: true, remote: 'origin', branch: 'kun/feature', setUpstream: true })
    expect(repo.git('rev-parse', '--abbrev-ref', '@{upstream}').trim()).toBe('origin/kun/feature')
    await repo.write('next.txt', 'n\n')
    await commitGitChanges({ workspaceRoot: repo.root, message: 'next', stageAll: true })
    const second = await pushGitBranch({ workspaceRoot: repo.root })
    expect(second).toMatchObject({ ok: true, setUpstream: false })
    const remoteHead = execFileSync('git', ['rev-parse', 'refs/heads/kun/feature'], { cwd: remote, encoding: 'utf8' }).trim()
    expect(remoteHead).toBe(repo.git('rev-parse', 'HEAD').trim())
  })

  it('reports a rejected push with git output and the command that ran', async () => {
    const repo = await createTestRepository()
    const remote = await addBareRemote(repo)
    repo.git('push', '-q', '-u', 'origin', 'main')
    const other = repositoryAt(await tempDirectory('kun-git-clone-'))
    execFileSync('git', ['clone', '-q', remote, other.root])
    other.git('config', 'user.email', 'other@example.com')
    other.git('config', 'user.name', 'Other')
    await other.write('theirs.txt', 'theirs\n')
    other.git('add', '.')
    other.git('commit', '-q', '-m', 'theirs')
    other.git('push', '-q', 'origin', 'main')
    await repo.write('ours.txt', 'ours\n')
    await commitGitChanges({ workspaceRoot: repo.root, message: 'ours', stageAll: true })
    const result = await pushGitBranch({ workspaceRoot: repo.root })
    expect(result).toMatchObject({ ok: false, reason: 'rejected', command: 'git push origin HEAD:refs/heads/main' })
    if (!result.ok) expect(result.output).toMatch(/rejected/)
  })

  it('explains why a push cannot run', async () => {
    const repo = await createTestRepository()
    expect(await pushGitBranch({ workspaceRoot: repo.root })).toMatchObject({ ok: false, reason: 'no_remote' })
    await addBareRemote(repo)
    repo.git('switch', '-q', '--detach')
    expect(await pushGitBranch({ workspaceRoot: repo.root })).toMatchObject({ ok: false, reason: 'detached' })
  })
})
