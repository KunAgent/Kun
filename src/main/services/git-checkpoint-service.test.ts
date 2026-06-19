import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGitCheckpoint, restoreGitCheckpoint } from './git-checkpoint-service'

let sandbox = ''
let repoRoot = ''
let dataDir = ''

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'kun-git-checkpoint-'))
  repoRoot = join(sandbox, 'repo')
  dataDir = join(sandbox, 'data')
  execFileSync('git', ['init', '-b', 'main', repoRoot], { stdio: 'pipe' })
  execFileSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@example.com'], { stdio: 'pipe' })
  execFileSync('git', ['-C', repoRoot, 'config', 'user.name', 'Test'], { stdio: 'pipe' })
  await writeFile(join(repoRoot, 'tracked.txt'), 'base\n')
  await writeFile(join(repoRoot, 'staged.txt'), 'staged base\n')
  execFileSync('git', ['-C', repoRoot, 'add', '.'], { stdio: 'pipe' })
  execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'init'], { stdio: 'pipe' })
})

afterEach(async () => {
  if (!sandbox) return
  await rm(sandbox, { recursive: true, force: true })
  sandbox = ''
  repoRoot = ''
  dataDir = ''
})

describe('git checkpoint service', () => {
  it('restores staged, unstaged, and untracked files to the checkpoint state', async () => {
    await writeFile(join(repoRoot, 'tracked.txt'), 'checkpoint unstaged\n')
    await writeFile(join(repoRoot, 'staged.txt'), 'checkpoint staged\n')
    execFileSync('git', ['-C', repoRoot, 'add', 'staged.txt'], { stdio: 'pipe' })
    await writeFile(join(repoRoot, 'untracked.txt'), 'checkpoint untracked\n')

    const checkpoint = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_1'
    })
    expect(checkpoint.ok).toBe(true)
    if (!checkpoint.ok) throw new Error(checkpoint.message)

    await writeFile(join(repoRoot, 'tracked.txt'), 'agent changed\n')
    await writeFile(join(repoRoot, 'staged.txt'), 'agent staged changed\n')
    execFileSync('git', ['-C', repoRoot, 'add', 'tracked.txt', 'staged.txt'], { stdio: 'pipe' })
    await writeFile(join(repoRoot, 'untracked.txt'), 'agent changed untracked\n')
    await writeFile(join(repoRoot, 'agent-new.txt'), 'agent new\n')

    const restored = await restoreGitCheckpoint({
      dataDir,
      checkpointId: checkpoint.checkpointId
    })
    expect(restored.ok).toBe(true)
    if (!restored.ok) throw new Error(restored.message)

    expect(await readFile(join(repoRoot, 'tracked.txt'), 'utf-8')).toBe('checkpoint unstaged\n')
    expect(await readFile(join(repoRoot, 'staged.txt'), 'utf-8')).toBe('checkpoint staged\n')
    expect(await readFile(join(repoRoot, 'untracked.txt'), 'utf-8')).toBe('checkpoint untracked\n')
    expect(execFileSync('git', ['-C', repoRoot, 'status', '--porcelain=v1'], { encoding: 'utf-8' })
      .split('\n')
      .filter(Boolean)
      .sort()).toEqual([' M tracked.txt', 'M  staged.txt', '?? untracked.txt'].sort())
  })

  it('rolls back commits created after the checkpoint', async () => {
    const checkpoint = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_1'
    })
    expect(checkpoint.ok).toBe(true)
    if (!checkpoint.ok) throw new Error(checkpoint.message)

    await writeFile(join(repoRoot, 'tracked.txt'), 'committed by agent\n')
    execFileSync('git', ['-C', repoRoot, 'add', 'tracked.txt'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'agent commit'], { stdio: 'pipe' })
    await writeFile(join(repoRoot, 'after-commit.txt'), 'uncommitted after commit\n')

    const restored = await restoreGitCheckpoint({
      dataDir,
      checkpointId: checkpoint.checkpointId
    })
    expect(restored.ok).toBe(true)
    if (!restored.ok) throw new Error(restored.message)

    expect(await readFile(join(repoRoot, 'tracked.txt'), 'utf-8')).toBe('base\n')
    expect(restored.rescueCheckpointId).toMatch(/^gcp_/)
    expect(execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim()).toBe(
      checkpoint.head
    )
    expect(execFileSync('git', ['-C', repoRoot, 'status', '--porcelain=v1'], { encoding: 'utf-8' }).trim()).toBe('')
  })
})
