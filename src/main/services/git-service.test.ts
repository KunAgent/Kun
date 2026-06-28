import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, sep } from 'node:path'
import {
  checkoutGitBranchWorktree,
  createGitBranchWorktree,
  createAndSwitchGitBranch,
  getGitBranches,
  listGitBranchWorktrees,
  removeGitBranchWorktree,
  switchGitBranch
} from './git-service'

/**
 * Integration tests for git-service.ts that exercise the real `git` binary
 * in a temp repository. These complement the unit tests for findNearestGitRoot
 * (in git-discovery.test.ts) by proving that the public entry points
 * (`getGitBranches`, `switchGitBranch`, `createAndSwitchGitBranch`) actually
 * return the right `repositoryRoot` when called with a subdirectory path.
 *
 * See issue #98: user reported that GUI showed "未检测到 Git" when the
 * workspace was a sub-folder of a repo. The fix walks up to find the nearest
 * `.git` root before calling git, so callers can pass a subdirectory and
 * still get a usable result.
 */

let sandbox = ''
let repoRoot = ''

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'ds-gui-git-service-'))
  repoRoot = await realpath(sandbox)
  // Initialise a real git repo with one commit on `main` and a few sub-dirs.
  // `realpath` resolves the macOS /tmp symlink so the returned repositoryRoot
  // matches what `git rev-parse --show-toplevel` returns (which also resolves
  // symlinks).
  execFileSync('git', ['init', '-b', 'main', repoRoot], { stdio: 'pipe' })
  execFileSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@example.com'], { stdio: 'pipe' })
  execFileSync('git', ['-C', repoRoot, 'config', 'user.name', 'Test'], { stdio: 'pipe' })
  await writeFile(join(repoRoot, 'README.md'), 'test')
  execFileSync('git', ['-C', repoRoot, 'add', 'README.md'], { stdio: 'pipe' })
  execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'init'], { stdio: 'pipe' })
})

afterEach(async () => {
  if (sandbox) {
    await rm(sandbox, { recursive: true, force: true })
    sandbox = ''
    repoRoot = ''
  }
})

describe('getGitBranches — integration with real git', () => {
  it('returns ok with the repo root when called from a nested subdirectory (issue #98)', async () => {
    // Build a 5-level nested subdirectory inside the repo: <root>/a/b/c/d/e
    const deep = join(repoRoot, 'a', 'b', 'c', 'd', 'e')
    await mkdir(deep, { recursive: true })

    const result = await getGitBranches(deep)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable: just checked ok')

    // `repositoryRoot` must be the repo root (not the subdirectory we passed in).
    expect(result.repositoryRoot).toBe(repoRoot)
    // And we should see the default branch we created.
    expect(result.currentBranch).toBe('main')
    expect(result.branches.map((b) => b.name)).toContain('main')
    // Working tree is clean, no untracked files inside the subdir.
    expect(result.dirtyCount).toBe(0)
  })

  it('returns ok when called from the repo root itself', async () => {
    const result = await getGitBranches(repoRoot)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.repositoryRoot).toBe(repoRoot)
    expect(result.currentBranch).toBe('main')
  })

  it('reports dirty files inside the workspace subdirectory', async () => {
    const sub = join(repoRoot, 'src')
    await mkdir(sub, { recursive: true })
    await writeFile(join(sub, 'untracked.ts'), 'export const x = 1\n')

    const result = await getGitBranches(sub)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.repositoryRoot).toBe(repoRoot)
    expect(result.dirtyCount).toBeGreaterThanOrEqual(1)
  })

  it('returns not_git_repo when the path is outside any repository', async () => {
    // A fresh tmpdir (no .git anywhere up the chain on this host).
    const outside = await mkdtemp(join(tmpdir(), 'ds-gui-git-outside-'))
    try {
      const result = await getGitBranches(outside)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected not_git_repo, got ok')
      expect(result.reason).toBe('not_git_repo')
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('returns no_workspace for an empty workspace root', async () => {
    const result = await getGitBranches('   ')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected no_workspace, got ok')
    expect(result.reason).toBe('no_workspace')
  })
})

describe('switchGitBranch / createAndSwitchGitBranch — integration with real git', () => {
  it('switches to an existing branch from a subdirectory', async () => {
    // Pre-create a feature branch with one commit on top of main.
    execFileSync('git', ['-C', repoRoot, 'checkout', '-b', 'feature/x'], { stdio: 'pipe' })
    await writeFile(join(repoRoot, 'feature.txt'), 'feature work')
    execFileSync('git', ['-C', repoRoot, 'add', 'feature.txt'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'feature'], { stdio: 'pipe' })
    // Back to main so we have something to switch away from.
    execFileSync('git', ['-C', repoRoot, 'checkout', 'main'], { stdio: 'pipe' })

    const sub = join(repoRoot, 'src', 'components')
    await mkdir(sub, { recursive: true })

    const result = await switchGitBranch(sub, 'feature/x')

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.repositoryRoot).toBe(repoRoot)
    expect(result.currentBranch).toBe('feature/x')

    // Confirm the underlying git state actually changed.
    const actual = execFileSync('git', ['-C', repoRoot, 'branch', '--show-current'], {
      encoding: 'utf8'
    }).trim()
    expect(actual).toBe('feature/x')
  })

  it('creates a new branch from a subdirectory and switches to it', async () => {
    const sub = join(repoRoot, 'src', 'components')
    await mkdir(sub, { recursive: true })

    const result = await createAndSwitchGitBranch(sub, 'feature/y')

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.repositoryRoot).toBe(repoRoot)
    expect(result.currentBranch).toBe('feature/y')
    expect(readdirSync(join(repoRoot, '.git', 'refs', 'heads'))).toContain('feature')
  })
})

describe('worktree branch checkout — integration with real git', () => {
  it('checks out an existing branch into a new worktree without switching the main repo', async () => {
    execFileSync('git', ['-C', repoRoot, 'checkout', '-b', 'feature/worktree'], { stdio: 'pipe' })
    await writeFile(join(repoRoot, 'worktree.txt'), 'worktree branch')
    execFileSync('git', ['-C', repoRoot, 'add', 'worktree.txt'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'worktree branch'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repoRoot, 'checkout', 'main'], { stdio: 'pipe' })

    const sub = join(repoRoot, 'src', 'components')
    const worktreeRoot = join(sandbox, 'kun-worktrees')
    await mkdir(sub, { recursive: true })

    const result = await checkoutGitBranchWorktree(sub, 'feature/worktree', worktreeRoot)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.sourceRepositoryRoot).toBe(repoRoot)
    expect(result.repositoryRoot).toBe(result.worktreePath)
    expect(result.worktreePath).not.toBe(repoRoot)
    const worktreeRootReal = await realpath(worktreeRoot)
    const relativeWorktreePath = relative(worktreeRootReal, result.worktreePath).split(sep)
    expect(relativeWorktreePath).toHaveLength(2)
    expect(relativeWorktreePath[0]).toMatch(/^[0-9a-f]{4}$/)
    expect(relativeWorktreePath[1]).toBe(basename(repoRoot))
    expect(result.worktreePath).not.toContain('feature-worktree')
    expect(result.currentBranch).toMatch(/^kun\/worktree-[0-9a-f]{6}$/)

    const mainBranch = execFileSync('git', ['-C', repoRoot, 'branch', '--show-current'], {
      encoding: 'utf8'
    }).trim()
    const worktreeBranch = execFileSync('git', ['-C', result.worktreePath, 'branch', '--show-current'], {
      encoding: 'utf8'
    }).trim()
    expect(mainBranch).toBe('main')
    expect(worktreeBranch).toBe(result.currentBranch)
    execFileSync('git', ['-C', repoRoot, 'merge-base', '--is-ancestor', 'feature/worktree', worktreeBranch], {
      stdio: 'pipe'
    })
  })

  it('creates multiple derived worktrees from the same source branch', async () => {
    const sub = join(repoRoot, 'src', 'components')
    const worktreeRoot = join(sandbox, 'kun-worktrees')
    await mkdir(sub, { recursive: true })

    const first = await checkoutGitBranchWorktree(sub, 'main', worktreeRoot)
    const second = await checkoutGitBranchWorktree(sub, 'main', worktreeRoot)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('unreachable')
    expect(first.worktreePath).not.toBe(second.worktreePath)
    expect(first.currentBranch).toMatch(/^kun\/worktree-[0-9a-f]{6}$/)
    expect(second.currentBranch).toMatch(/^kun\/worktree-[0-9a-f]{6}$/)
    expect(first.currentBranch).not.toBe(second.currentBranch)

    const listed = await listGitBranchWorktrees(repoRoot, worktreeRoot)
    expect(listed.ok).toBe(true)
    if (!listed.ok) throw new Error('unreachable')
    expect(listed.worktrees.map((item) => item.path)).toEqual(
      expect.arrayContaining([first.worktreePath, second.worktreePath])
    )
  })

  it('creates a derived worktree branch when the selected branch is checked out in the main repo', async () => {
    const sub = join(repoRoot, 'src', 'components')
    const worktreeRoot = join(sandbox, 'kun-worktrees')
    await mkdir(sub, { recursive: true })

    const result = await checkoutGitBranchWorktree(sub, 'main', worktreeRoot)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.sourceRepositoryRoot).toBe(repoRoot)
    expect(result.repositoryRoot).toBe(result.worktreePath)
    expect(result.worktreePath).not.toBe(repoRoot)
    expect(result.currentBranch).toMatch(/^kun\/worktree-[0-9a-f]{6}$/)

    const mainBranch = execFileSync('git', ['-C', repoRoot, 'branch', '--show-current'], {
      encoding: 'utf8'
    }).trim()
    const worktreeBranch = execFileSync('git', ['-C', result.worktreePath, 'branch', '--show-current'], {
      encoding: 'utf8'
    }).trim()
    expect(mainBranch).toBe('main')
    expect(worktreeBranch).toBe(result.currentBranch)
    execFileSync('git', ['-C', repoRoot, 'merge-base', '--is-ancestor', 'main', worktreeBranch], {
      stdio: 'pipe'
    })
  })

  it('creates a new branch in a new worktree without switching the main repo', async () => {
    const sub = join(repoRoot, 'src', 'components')
    const worktreeRoot = join(sandbox, 'kun-worktrees')
    await mkdir(sub, { recursive: true })

    const result = await createGitBranchWorktree(sub, 'feature/new-worktree', worktreeRoot)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.sourceRepositoryRoot).toBe(repoRoot)
    expect(result.repositoryRoot).toBe(result.worktreePath)
    expect(result.worktreePath).not.toBe(repoRoot)
    const worktreeRootReal = await realpath(worktreeRoot)
    const relativeWorktreePath = relative(worktreeRootReal, result.worktreePath).split(sep)
    expect(relativeWorktreePath).toHaveLength(2)
    expect(relativeWorktreePath[0]).toMatch(/^[0-9a-f]{4}$/)
    expect(relativeWorktreePath[1]).toBe(basename(repoRoot))
    expect(result.worktreePath).not.toContain('feature-new-worktree')
    expect(result.currentBranch).toBe('feature/new-worktree')

    const mainBranch = execFileSync('git', ['-C', repoRoot, 'branch', '--show-current'], {
      encoding: 'utf8'
    }).trim()
    const worktreeBranch = execFileSync('git', ['-C', result.worktreePath, 'branch', '--show-current'], {
      encoding: 'utf8'
    }).trim()
    expect(mainBranch).toBe('main')
    expect(worktreeBranch).toBe('feature/new-worktree')

    const listed = await listGitBranchWorktrees(repoRoot, worktreeRoot)
    expect(listed.ok).toBe(true)
    if (!listed.ok) throw new Error('unreachable')
    expect(listed.worktrees.map((item) => item.path)).toContain(result.worktreePath)

    await removeGitBranchWorktree({
      workspaceRoot: repoRoot,
      worktreePath: result.worktreePath
    })
    const afterRemove = await listGitBranchWorktrees(repoRoot, worktreeRoot)
    expect(afterRemove.ok).toBe(true)
    if (!afterRemove.ok) throw new Error('unreachable')
    expect(afterRemove.worktrees.map((item) => item.path)).not.toContain(result.worktreePath)
  })
})

describe('getGitBranches — worktree annotations', () => {
  it('flags a branch checked out in another worktree and points back to the primary checkout', async () => {
    // Park `main` in a linked worktree so the main repo and the worktree share
    // a repository but hold different branches — the scenario that produced the
    // "'develop' is already used by worktree" error.
    execFileSync('git', ['-C', repoRoot, 'checkout', '-b', 'feature/parked'], { stdio: 'pipe' })
    const worktreePath = join(sandbox, 'linked', basename(repoRoot))
    await mkdir(join(worktreePath, '..'), { recursive: true })
    execFileSync('git', ['-C', repoRoot, 'worktree', 'add', worktreePath, 'main'], { stdio: 'pipe' })
    const worktreeReal = await realpath(worktreePath)

    // From the main repo: `main` lives in the linked (non-primary) worktree.
    const fromMain = await getGitBranches(repoRoot)
    expect(fromMain.ok).toBe(true)
    if (!fromMain.ok) throw new Error('unreachable')
    expect(fromMain.primaryRepositoryRoot).toBe(repoRoot)
    const mainRow = fromMain.branches.find((b) => b.name === 'main')
    expect(mainRow?.worktreePath).toBe(worktreeReal)
    expect(mainRow?.worktreePrimary).toBe(false)
    // The current branch is never flagged as living elsewhere.
    expect(fromMain.branches.find((b) => b.name === 'feature/parked')?.worktreePath).toBeUndefined()

    // From the linked worktree: `feature/parked` lives in the primary checkout.
    const fromWorktree = await getGitBranches(worktreeReal)
    expect(fromWorktree.ok).toBe(true)
    if (!fromWorktree.ok) throw new Error('unreachable')
    expect(fromWorktree.primaryRepositoryRoot).toBe(repoRoot)
    const parkedRow = fromWorktree.branches.find((b) => b.name === 'feature/parked')
    expect(parkedRow?.worktreePath).toBe(repoRoot)
    expect(parkedRow?.worktreePrimary).toBe(true)
    expect(fromWorktree.branches.find((b) => b.name === 'main')?.worktreePath).toBeUndefined()
  })
})
