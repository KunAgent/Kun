import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { createWorktreeLifecycle } from './worktree-lifecycle.js'
import { workspaceGit } from './workspace-git.js'

const execFileAsync = promisify(execFile)
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const lifecycle = createWorktreeLifecycle({
  git: workspaceGit,
  commitGit: workspaceGit,
  fence: async () => undefined,
  withCommit: (operation) => operation({ signal: new AbortController().signal })
})

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' })).stdout
}

async function repoHarness(): Promise<{ root: string; repo: string; base: string }> {
  const root = await mkdtemp(join(tmpdir(), 'kun-worktree-lifecycle-'))
  roots.push(root)
  const repo = join(root, 'repo')
  await mkdir(repo, { recursive: true })
  await git(repo, ['init'])
  await git(repo, ['config', 'user.email', 'lifecycle-test@example.test'])
  await git(repo, ['config', 'user.name', 'Lifecycle Test'])
  await writeFile(join(repo, 'a.txt'), 'base a\n')
  await writeFile(join(repo, 'b.txt'), 'base b\n')
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-m', 'test: base'])
  const base = (await gitOutput(repo, ['rev-parse', 'HEAD'])).trim()
  return { root, repo, base }
}

describe('worktree lifecycle', () => {
  it('creates a detached worktree at the start revision', async () => {
    const { root, repo, base } = await repoHarness()
    const path = join(root, 'wt-1')
    const created = await lifecycle.create({
      repositoryRoot: repo,
      path,
      startRevision: base
    })
    expect(created.baseRevision).toBe(base)
    expect(created.branch).toBeUndefined()
    expect(await stat(join(path, 'a.txt'))).toBeTruthy()
    expect((await gitOutput(path, ['rev-parse', 'HEAD'])).trim()).toBe(base)
  })

  it('creates a worktree on a new branch when asked', async () => {
    const { root, repo, base } = await repoHarness()
    const created = await lifecycle.create({
      repositoryRoot: repo,
      path: join(root, 'wt-branch'),
      startRevision: base,
      branch: 'kun/task-abc123'
    })
    expect(created.branch).toBe('kun/task-abc123')
    expect(await gitOutput(repo, ['branch', '--list', 'kun/task-abc123']))
      .toContain('kun/task-abc123')
  })

  it('captures both committed and uncommitted changes as one patch', async () => {
    const { root, repo, base } = await repoHarness()
    const path = join(root, 'wt-2')
    await lifecycle.create({ repositoryRoot: repo, path, startRevision: base })
    await writeFile(join(path, 'a.txt'), 'committed change\n')
    await git(path, ['add', '.'])
    await git(path, ['commit', '-m', 'worker commit'])
    await writeFile(join(path, 'new.txt'), 'uncommitted\n')
    const captured = await lifecycle.capture({ path, baseRevision: base })
    expect(captured.changedFiles).toEqual(['a.txt', 'new.txt'])
    expect(captured.patch).toContain('committed change')
    expect(captured.patch).toContain('uncommitted')
    expect(captured.headRevision).not.toBe(base)
  })

  it('applies a captured patch into the source checkout', async () => {
    const { root, repo, base } = await repoHarness()
    const path = join(root, 'wt-3')
    await lifecycle.create({ repositoryRoot: repo, path, startRevision: base })
    await writeFile(join(path, 'a.txt'), 'patched\n')
    const captured = await lifecycle.capture({ path, baseRevision: base })
    const result = await lifecycle.applyPatch(
      {
        repositoryRoot: repo,
        baseRevision: base,
        changedFiles: captured.changedFiles,
        patch: captured.patch
      },
      { ownedPaths: new Set() }
    )
    expect(result).toEqual({ outcome: 'applied' })
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('patched\n')
  })

  it('reports needs_human when the source HEAD moved', async () => {
    const { root, repo, base } = await repoHarness()
    const path = join(root, 'wt-4')
    await lifecycle.create({ repositoryRoot: repo, path, startRevision: base })
    await writeFile(join(path, 'a.txt'), 'patched\n')
    const captured = await lifecycle.capture({ path, baseRevision: base })
    await writeFile(join(repo, 'b.txt'), 'source moved on\n')
    await git(repo, ['add', '.'])
    await git(repo, ['commit', '-m', 'test: source moved'])
    const result = await lifecycle.applyPatch(
      {
        repositoryRoot: repo,
        baseRevision: base,
        changedFiles: captured.changedFiles,
        patch: captured.patch
      },
      { ownedPaths: new Set() }
    )
    expect(result).toEqual({
      outcome: 'needs_human',
      reason: 'repository HEAD changed since worktree allocation'
    })
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('base a\n')
  })

  it('reports needs_human on overlapping uncommitted source changes', async () => {
    const { root, repo, base } = await repoHarness()
    const path = join(root, 'wt-5')
    await lifecycle.create({ repositoryRoot: repo, path, startRevision: base })
    await writeFile(join(path, 'a.txt'), 'patched\n')
    const captured = await lifecycle.capture({ path, baseRevision: base })
    await writeFile(join(repo, 'a.txt'), 'user overlapping change\n')
    const result = await lifecycle.applyPatch(
      {
        repositoryRoot: repo,
        baseRevision: base,
        changedFiles: captured.changedFiles,
        patch: captured.patch
      },
      { ownedPaths: new Set(), patchLabel: 'Graph patch' }
    )
    expect(result).toMatchObject({ outcome: 'needs_human' })
    if (result.outcome === 'needs_human') {
      expect(result.reason).toContain('uncommitted changes overlapping Graph patch: a.txt')
    }
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('user overlapping change\n')
  })

  it('lets owned dirty paths reach git instead of an early needs_human', async () => {
    const { root, repo, base } = await repoHarness()
    const path = join(root, 'wt-6')
    await lifecycle.create({ repositoryRoot: repo, path, startRevision: base })
    await writeFile(join(path, 'a.txt'), 'patched\n')
    const captured = await lifecycle.capture({ path, baseRevision: base })
    await writeFile(join(repo, 'a.txt'), 'owned dirty\n')
    const result = await lifecycle.applyPatch(
      {
        repositoryRoot: repo,
        baseRevision: base,
        changedFiles: captured.changedFiles,
        patch: captured.patch
      },
      { ownedPaths: new Set(['a.txt']), patchLabel: 'Graph patch' }
    )
    expect(result).toMatchObject({ outcome: 'conflict' })
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('owned dirty\n')
  })

  it('reports conflict when the patch cannot apply', async () => {
    const { repo, base } = await repoHarness()
    const result = await lifecycle.applyPatch(
      {
        repositoryRoot: repo,
        baseRevision: base,
        changedFiles: ['a.txt'],
        patch: [
          'diff --git a/a.txt b/a.txt',
          'index 0000000..1111111 100644',
          '--- a/a.txt',
          '+++ b/a.txt',
          '@@ -1,1 +1,1 @@',
          '-completely different context',
          '+new line'
        ].join('\n')
      },
      { ownedPaths: new Set() }
    )
    expect(result).toMatchObject({ outcome: 'conflict' })
  })

  it('removes worktrees and keeps the repository clean', async () => {
    const { root, repo, base } = await repoHarness()
    const path = join(root, 'wt-7')
    await lifecycle.create({ repositoryRoot: repo, path, startRevision: base })
    await lifecycle.remove({ repositoryRoot: repo, path }, { force: true })
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await gitOutput(repo, ['worktree', 'list'])).split('\n').filter(Boolean))
      .toHaveLength(1)
  })
})
