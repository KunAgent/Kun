import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import { createGitCheckpoint, restoreGitCheckpoint, testResolvePathWithinRepository } from './git-checkpoint-service'

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
  it('stores checkpoint heads outside visible git refs', async () => {
    const checkpoint = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_1'
    })
    expect(checkpoint.ok).toBe(true)
    if (!checkpoint.ok) throw new Error(checkpoint.message)

    const checkpointDir = join(dataDir, 'git-checkpoints', checkpoint.checkpointId)
    const metadata = JSON.parse(await readFile(join(checkpointDir, 'metadata.json'), 'utf-8')) as {
      checkpointRef?: string
    }
    expect(metadata.checkpointRef).toBeUndefined()
    await expect(stat(join(checkpointDir, 'head.bundle'))).resolves.toBeTruthy()

    const refs = execFileSync('git', ['-C', repoRoot, 'show-ref'], { encoding: 'utf-8' })
    expect(refs).not.toContain('refs/kun/checkpoints')
  })

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

  it('restores from the head bundle when the checkpoint commit was pruned', async () => {
    const checkpoint = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_1'
    })
    expect(checkpoint.ok).toBe(true)
    if (!checkpoint.ok) throw new Error(checkpoint.message)

    execFileSync('git', ['-C', repoRoot, 'checkout', '--orphan', 'replacement'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repoRoot, 'rm', '-rf', '.'], { stdio: 'pipe' })
    await writeFile(join(repoRoot, 'tracked.txt'), 'replacement\n')
    execFileSync('git', ['-C', repoRoot, 'add', 'tracked.txt'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'replacement'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repoRoot, 'branch', '-D', 'main'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repoRoot, 'branch', '-m', 'main'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repoRoot, 'reflog', 'expire', '--expire=now', '--all'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repoRoot, 'gc', '--prune=now'], { stdio: 'pipe' })

    expect(() => execFileSync('git', ['-C', repoRoot, 'cat-file', '-e', `${checkpoint.head}^{commit}`], {
      stdio: 'pipe'
    })).toThrow()

    const restored = await restoreGitCheckpoint({
      dataDir,
      checkpointId: checkpoint.checkpointId
    })
    expect(restored.ok).toBe(true)
    if (!restored.ok) throw new Error(restored.message)

    expect(await readFile(join(repoRoot, 'tracked.txt'), 'utf-8')).toBe('base\n')
    expect(execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim()).toBe(
      checkpoint.head
    )
    const refs = execFileSync('git', ['-C', repoRoot, 'show-ref'], { encoding: 'utf-8' })
    expect(refs).not.toContain('refs/kun/checkpoints')
  })

  it('refuses to restore when a tampered checkpoint smuggles a path-traversal untracked entry', async () => {
    // Build a legitimate checkpoint, then rewrite its metadata.json so an
    // untracked entry escapes the repository root (`../escape.txt`). The restore
    // must reject the traversal rather than copying the file outside the repo.
    const checkpoint = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_traversal'
    })
    expect(checkpoint.ok).toBe(true)
    if (!checkpoint.ok) throw new Error(checkpoint.message)

    const checkpointDir = join(dataDir, 'git-checkpoints', checkpoint.checkpointId)
    const metadataPath = join(checkpointDir, 'metadata.json')
    const metadata = JSON.parse(await readFile(metadataPath, 'utf-8')) as {
      untrackedFiles: string[]
      [key: string]: unknown
    }
    metadata.untrackedFiles = ['../escape.txt']
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8')

    // Plant a payload at the smuggled source location inside the checkpoint
    // untracked dir so the existence check would succeed without the guard.
    const smuggledSource = join(checkpointDir, 'untracked', '..', 'escape.txt')
    await writeFile(smuggledSource, 'escaped payload\n')

    // The destination the traversal would write to, OUTSIDE the repo.
    const escapeTarget = join(repoRoot, '..', 'escape.txt')

    const restored = await restoreGitCheckpoint({
      dataDir,
      checkpointId: checkpoint.checkpointId
    })
    expect(restored.ok).toBe(false)
    if (restored.ok) throw new Error('expected restore to be refused')
    expect(restored.reason).toBe('error')
    expect(restored.message).toMatch(/escapes the repository root/)

    // Nothing must have been written outside the repository.
    await expect(stat(escapeTarget)).rejects.toThrow()
  })

  it('refuses to restore when a tampered checkpoint smuggles an absolute untracked path', async () => {
    const checkpoint = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_absolute'
    })
    expect(checkpoint.ok).toBe(true)
    if (!checkpoint.ok) throw new Error(checkpoint.message)

    const checkpointDir = join(dataDir, 'git-checkpoints', checkpoint.checkpointId)
    const metadataPath = join(checkpointDir, 'metadata.json')
    const metadata = JSON.parse(await readFile(metadataPath, 'utf-8')) as {
      untrackedFiles: string[]
      [key: string]: unknown
    }
    metadata.untrackedFiles = ['/tmp/escape-absolute.txt']
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8')

    const restored = await restoreGitCheckpoint({
      dataDir,
      checkpointId: checkpoint.checkpointId
    })
    expect(restored.ok).toBe(false)
    if (restored.ok) throw new Error('expected restore to be refused')
    expect(restored.reason).toBe('error')
    expect(restored.message).toMatch(/invalid untracked path|escapes the repository root/)
  })

  it('resolvePathWithinRepository rejects a path that escapes via an in-repo symlink', async () => {
    // An in-repo symlink `repo/link -> /outside` makes the relative path
    // `link/payload.txt` lexically contained (target startsWith repo+sep), but
    // cp() would follow the link and write OUTSIDE the repo. The helper must
    // resolve the target's real path (walking up to the existing symlink dir)
    // and reject the escape. This is the regression for the symlink-anchored
    // traversal that a lexical-only check misses.
    const outsideDir = join(sandbox, 'outside')
    await mkdir(outsideDir, { recursive: true })
    await symlink(outsideDir, join(repoRoot, 'link'), 'dir')

    await expect(
      testResolvePathWithinRepository(repoRoot, 'link/payload.txt')
    ).rejects.toThrow(/escapes the repository root/)
    // And nothing should have been created outside the repo.
    await expect(stat(join(outsideDir, 'payload.txt'))).rejects.toThrow()
  })

  it('resolvePathWithinRepository accepts a legitimate path inside the repo', async () => {
    const { realpath } = await import('node:fs/promises')
    await mkdir(join(repoRoot, 'sub'), { recursive: true })
    // The helper anchors against the realpath'd root (macOS /var -> /private/var),
    // so compare against the canonical root, not the lexical repoRoot.
    const repoReal = await realpath(repoRoot)
    await expect(
      testResolvePathWithinRepository(repoRoot, 'sub/file.txt')
    ).resolves.toBe(normalize(join(repoReal, 'sub', 'file.txt')))
  })

  it('resolvePathWithinRepository rejects traversal, absolute, and null-byte paths', async () => {
    await expect(testResolvePathWithinRepository(repoRoot, '../escape.txt')).rejects.toThrow()
    await expect(testResolvePathWithinRepository(repoRoot, '/tmp/escape.txt')).rejects.toThrow()
    await expect(testResolvePathWithinRepository(repoRoot, 'evil\0.txt')).rejects.toThrow()
    await expect(testResolvePathWithinRepository(repoRoot, '.')).rejects.toThrow()
    await expect(testResolvePathWithinRepository(repoRoot, '..')).rejects.toThrow()
  })

  it('refuses to restore while a thread is running and leaves the working tree untouched', async () => {
    const checkpoint = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_busy'
    })
    expect(checkpoint.ok).toBe(true)
    if (!checkpoint.ok) throw new Error(checkpoint.message)

    // Mutate the working tree after the checkpoint so we can assert the restore
    // did NOT clobber it. If the busy guard fails open, these changes vanish.
    await writeFile(join(repoRoot, 'tracked.txt'), 'agent editing\n')
    await writeFile(join(repoRoot, 'post-checkpoint.txt'), 'should survive\n')
    const headBefore = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim()

    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      // ThreadSummary exposes `status` (idle|running|archived|deleted), NOT
      // `state`. A running thread must be reported as status === 'running'.
      body: JSON.stringify({ threads: [{ id: 'thr_running', status: 'running' }] })
    }))

    const restored = await restoreGitCheckpoint({
      dataDir,
      checkpointId: checkpoint.checkpointId,
      runtimeRequest
    })

    expect(restored.ok).toBe(false)
    if (restored.ok) throw new Error('expected restore to be refused')
    expect(restored.reason).toBe('error')
    expect(restored.message).toMatch(/Cannot restore checkpoint while a thread is running/)

    // The busy guard must fire BEFORE any destructive git op, so the runtime
    // probe is the only call made and the working tree is byte-for-byte intact.
    expect(runtimeRequest).toHaveBeenCalledTimes(1)
    expect(await readFile(join(repoRoot, 'tracked.txt'), 'utf-8')).toBe('agent editing\n')
    expect(await readFile(join(repoRoot, 'post-checkpoint.txt'), 'utf-8')).toBe('should survive\n')
    expect(execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim()).toBe(headBefore)
  })

  it('restores when the runtime reports all threads idle (runtimeRequest exercised)', async () => {
    const checkpoint = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_idle'
    })
    expect(checkpoint.ok).toBe(true)
    if (!checkpoint.ok) throw new Error(checkpoint.message)

    await writeFile(join(repoRoot, 'tracked.txt'), 'changed after checkpoint\n')
    await writeFile(join(repoRoot, 'new-after.txt'), 'new\n')

    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({ threads: [{ id: 'thr_a', status: 'idle' }, { id: 'thr_b', status: 'archived' }] })
    }))

    const restored = await restoreGitCheckpoint({
      dataDir,
      checkpointId: checkpoint.checkpointId,
      runtimeRequest
    })
    expect(restored.ok).toBe(true)
    if (!restored.ok) throw new Error(restored.message)
    // The guard ran and let the restore proceed.
    expect(runtimeRequest).toHaveBeenCalledTimes(1)
    // Restore rewound the tracked file to its checkpoint content and removed the
    // post-checkpoint untracked file (git clean -fd).
    expect(await readFile(join(repoRoot, 'tracked.txt'), 'utf-8')).toBe('base\n')
    await expect(stat(join(repoRoot, 'new-after.txt'))).rejects.toThrow()
  })
})
