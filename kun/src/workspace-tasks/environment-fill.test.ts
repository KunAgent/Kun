import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  environmentFillEligibility,
  fillTaskWorktreeEnvironment
} from './environment-fill.js'

const execFileAsync = promisify(execFile)
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}

/** Repo with `.env` + `deps/` ignored; `tracked.txt` committed. */
async function initRepo(): Promise<{ repo: string; worktree: string }> {
  const root = await mkdtemp(join(tmpdir(), 'kun-envfill-'))
  roots.push(root)
  const repo = join(root, 'repo')
  const worktree = join(root, 'worktree')
  await mkdir(join(repo, 'deps'), { recursive: true })
  await mkdir(worktree, { recursive: true })
  await writeFile(join(repo, '.gitignore'), '.env\ndeps/\n')
  await writeFile(join(repo, 'tracked.txt'), 'tracked\n')
  await writeFile(join(repo, '.env'), 'SECRET=1\n')
  await writeFile(join(repo, 'deps', 'lib.js'), 'x\n')
  await git(repo, ['init'])
  await git(repo, ['config', 'user.email', 'ef@test'])
  await git(repo, ['config', 'user.name', 'EF'])
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-m', 'base'])
  return { repo, worktree }
}

describe('environmentFillEligibility', () => {
  it('rejects tracked, missing, and unsafe paths', async () => {
    const { repo } = await initRepo()
    expect(await environmentFillEligibility(repo, 'tracked.txt')).toBe('tracked')
    expect(await environmentFillEligibility(repo, 'does-not-exist')).toBe('missing')
    expect(await environmentFillEligibility(repo, '../repo/.env')).toBe('unsafe_path')
    expect(await environmentFillEligibility(repo, '/abs/path')).toBe('unsafe_path')
    // An untracked but not-ignored path is not eligible either.
    await writeFile(join(repo, 'untracked.txt'), 'u\n')
    expect(await environmentFillEligibility(repo, 'untracked.txt')).toBe('not_ignored')
  })

  it('rejects symlinks that resolve outside the repository', async () => {
    const { repo } = await initRepo()
    const outside = await mkdtemp(join(tmpdir(), 'kun-envfill-out-'))
    roots.push(outside)
    await writeFile(join(outside, 'secret.txt'), 'x\n')
    await symlink(outside, join(repo, 'escape'), 'dir').catch(() => undefined)
    expect(await environmentFillEligibility(repo, 'escape')).toBe('unsafe_path')
  })
})

describe('fillTaskWorktreeEnvironment', () => {
  it('symlinks shared directories into the worktree', async () => {
    const { repo, worktree } = await initRepo()
    const result = await fillTaskWorktreeEnvironment({
      repoRoot: repo,
      worktreePath: worktree,
      config: { sharedDirectories: [{ path: 'deps', mode: 'symlink' }] }
    })
    expect(result.shared).toEqual(['deps'])
    const link = await lstat(join(worktree, 'deps'))
    expect(link.isSymbolicLink()).toBe(true)
    expect(await readFile(join(worktree, 'deps', 'lib.js'), 'utf8')).toBe('x\n')
  })

  it('copies ignored files without overwriting existing targets', async () => {
    const { repo, worktree } = await initRepo()
    await writeFile(join(worktree, '.env'), 'EXISTING=1\n')
    const result = await fillTaskWorktreeEnvironment({
      repoRoot: repo,
      worktreePath: worktree,
      config: { copyFiles: ['.env', 'tracked.txt', 'gone.txt'] }
    })
    // Existing destination is never overwritten; tracked/missing skipped.
    expect(result.copied).toEqual([])
    expect(result.skipped).toEqual([
      { path: '.env', reason: 'exists' },
      { path: 'tracked.txt', reason: 'tracked' },
      { path: 'gone.txt', reason: 'missing' }
    ])
    expect(await readFile(join(worktree, '.env'), 'utf8')).toBe('EXISTING=1\n')
  })

  it('copies a copyFiles entry when the destination is absent', async () => {
    const { repo, worktree } = await initRepo()
    const result = await fillTaskWorktreeEnvironment({
      repoRoot: repo,
      worktreePath: worktree,
      config: { copyFiles: ['.env'] }
    })
    expect(result.copied).toEqual(['.env'])
    expect(await readFile(join(worktree, '.env'), 'utf8')).toBe('SECRET=1\n')
  })

  it('merges user-level sharedPaths with the project config', async () => {
    const { repo, worktree } = await initRepo()
    const result = await fillTaskWorktreeEnvironment({
      repoRoot: repo,
      worktreePath: worktree,
      config: { copyFiles: ['.env'] },
      userSharedPaths: [{ path: 'deps', mode: 'symlink' }]
    })
    expect(result.shared).toEqual(['deps'])
    expect(result.copied).toEqual(['.env'])
  })

  it('clone mode falls back to symlink with a warning off darwin', async () => {
    const { repo, worktree } = await initRepo()
    const result = await fillTaskWorktreeEnvironment({
      repoRoot: repo,
      worktreePath: worktree,
      config: { sharedDirectories: [{ path: 'deps', mode: 'clone' }] },
      platform: 'linux'
    })
    expect(result.shared).toEqual(['deps'])
    expect(result.warnings.some((warning) => warning.includes('clone'))).toBe(true)
  })
})
