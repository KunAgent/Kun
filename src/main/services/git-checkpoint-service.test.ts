import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import {
  cleanupUnusedGitCheckpoints,
  cleanupUnusedGitCheckpointsIfDue,
  createGitCheckpoint,
  restoreGitCheckpoint,
  testResolvePathWithinRepository
} from './git-checkpoint-service'

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
  execFileSync('git', ['-C', repoRoot, 'config', 'core.autocrlf', 'false'], { stdio: 'pipe' })
  execFileSync('git', ['-C', repoRoot, 'config', 'core.eol', 'lf'], { stdio: 'pipe' })
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

  it('writes a checkpoint manifest with canonical thread and workspace identity', async () => {
    const checkpoint = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_manifest'
    })
    expect(checkpoint.ok).toBe(true)
    if (!checkpoint.ok) throw new Error(checkpoint.message)

    const manifest = JSON.parse(
      await readFile(join(dataDir, 'git-checkpoints', checkpoint.checkpointId, 'manifest.json'), 'utf-8')
    ) as {
      version: number
      checkpointId: string
      threadId: string
      repositoryRootCanonical: string
      workspaceRootCanonical?: string
    }

    const repoRootCanonical = normalize(await realpath(repoRoot))

    expect(manifest).toMatchObject({
      version: 1,
      checkpointId: checkpoint.checkpointId,
      threadId: 'thr_manifest',
      repositoryRootCanonical: repoRootCanonical,
      workspaceRootCanonical: repoRootCanonical
    })
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
    await symlink(outsideDir, join(repoRoot, 'link'), process.platform === 'win32' ? 'junction' : 'dir')

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

  it('refuses to restore when the active thread does not match the checkpoint manifest', async () => {
    const checkpoint = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_expected'
    })
    expect(checkpoint.ok).toBe(true)
    if (!checkpoint.ok) throw new Error(checkpoint.message)

    await writeFile(join(repoRoot, 'tracked.txt'), 'agent editing\n')

    const restored = await restoreGitCheckpoint({
      dataDir,
      checkpointId: checkpoint.checkpointId,
      expectedThreadId: 'thr_other',
      expectedWorkspaceRoot: repoRoot
    })
    expect(restored.ok).toBe(false)
    if (restored.ok) throw new Error('expected restore to be refused')
    expect(restored.reason).toBe('error')
    expect(restored.message).toContain('Checkpoint belongs to thread thr_expected, not thr_other.')
    expect(await readFile(join(repoRoot, 'tracked.txt'), 'utf-8')).toBe('agent editing\n')
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

  it('deletes checkpoint directories that are not referenced by thread data', async () => {
    const used = 'gcp_used'
    const unused = 'gcp_unused'
    await mkdir(join(dataDir, 'git-checkpoints', used), { recursive: true })
    await mkdir(join(dataDir, 'git-checkpoints', unused), { recursive: true })
    await mkdir(join(dataDir, 'threads', 'thr_1'), { recursive: true })
    await writeFile(
      join(dataDir, 'threads', 'thr_1', 'items.jsonl'),
      `${JSON.stringify({ id: 'item_1', workspaceCheckpointId: used })}\n`,
      'utf-8'
    )

    const result = await cleanupUnusedGitCheckpoints({ dataDir, graceMs: 0 })

    expect(result.scanned).toBe(2)
    expect(result.kept).toBe(1)
    expect(result.deleted).toBe(1)
    expect(result.deletedIds).toEqual([unused])
    await expect(stat(join(dataDir, 'git-checkpoints', used))).resolves.toBeTruthy()
    await expect(stat(join(dataDir, 'git-checkpoints', unused))).rejects.toThrow()
  })

  it('keeps recently created checkpoints (create-vs-flush grace) and deletes old ones', async () => {
    const fresh = 'gcp_fresh'
    const stale = 'gcp_stale'
    await mkdir(join(dataDir, 'git-checkpoints', fresh), { recursive: true })
    await mkdir(join(dataDir, 'git-checkpoints', stale), { recursive: true })
    // Backdate the stale checkpoint beyond the grace window; the fresh one keeps
    // its just-now mtime and must not be deleted (its referencing item may not
    // be flushed yet).
    const old = new Date('2020-01-01T00:00:00.000Z')
    await utimes(join(dataDir, 'git-checkpoints', stale), old, old)

    const result = await cleanupUnusedGitCheckpoints({ dataDir, graceMs: 10 * 60 * 1000 })

    expect(result.deletedIds).toEqual([stale])
    expect(result.kept).toBe(1)
    await expect(stat(join(dataDir, 'git-checkpoints', fresh))).resolves.toBeTruthy()
    await expect(stat(join(dataDir, 'git-checkpoints', stale))).rejects.toThrow()
  })

  it('records cleanup state and skips runs before the configured interval elapses', async () => {
    await mkdir(join(dataDir, 'git-checkpoints', 'gcp_first'), { recursive: true })

    const first = await cleanupUnusedGitCheckpointsIfDue({
      dataDir,
      intervalDays: 3,
      graceMs: 0,
      now: new Date('2026-01-01T00:00:00.000Z')
    })
    expect(first.due).toBe(true)
    if (!first.due) throw new Error('expected cleanup to run')
    expect(first.result.deletedIds).toEqual(['gcp_first'])

    await mkdir(join(dataDir, 'git-checkpoints', 'gcp_second'), { recursive: true })
    const skipped = await cleanupUnusedGitCheckpointsIfDue({
      dataDir,
      intervalDays: 3,
      graceMs: 0,
      now: new Date('2026-01-03T23:59:59.000Z')
    })
    expect(skipped.due).toBe(false)
    await expect(stat(join(dataDir, 'git-checkpoints', 'gcp_second'))).resolves.toBeTruthy()

    const second = await cleanupUnusedGitCheckpointsIfDue({
      dataDir,
      intervalDays: 3,
      graceMs: 0,
      now: new Date('2026-01-04T00:00:00.000Z')
    })
    expect(second.due).toBe(true)
    if (!second.due) throw new Error('expected cleanup to run after interval')
    expect(second.result.deletedIds).toEqual(['gcp_second'])
  })
})

describe('git checkpoint storage limits (issue #651)', () => {
  it('stores checkpoints under a user-configured directory (e.g. another drive)', async () => {
    const customRoot = join(sandbox, 'other-drive', 'kun-checkpoints')
    const checkpoint = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_1',
      storage: { checkpointsRoot: customRoot }
    })
    expect(checkpoint.ok).toBe(true)
    if (!checkpoint.ok) throw new Error(checkpoint.message)
    await expect(stat(join(customRoot, checkpoint.checkpointId, 'metadata.json'))).resolves.toBeTruthy()
    // Nothing should have been written under the default data dir location.
    await expect(stat(join(dataDir, 'git-checkpoints', checkpoint.checkpointId))).rejects.toBeTruthy()
  })

  it('skips untracked files larger than the per-file cap and records them', async () => {
    await writeFile(join(repoRoot, 'small.txt'), 'tiny')
    await writeFile(join(repoRoot, 'huge.bin'), Buffer.alloc(2_000_000, 1))
    const checkpoint = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_1',
      storage: { maxUntrackedFileBytes: 1_000_000 }
    })
    expect(checkpoint.ok).toBe(true)
    if (!checkpoint.ok) throw new Error(checkpoint.message)
    const dir = join(dataDir, 'git-checkpoints', checkpoint.checkpointId)
    const metadata = JSON.parse(await readFile(join(dir, 'metadata.json'), 'utf-8')) as {
      untrackedFiles: string[]; skippedUntracked?: string[]
    }
    expect(metadata.untrackedFiles).toContain('small.txt')
    expect(metadata.skippedUntracked).toContain('huge.bin')
    await expect(stat(join(dir, 'untracked', 'huge.bin'))).rejects.toBeTruthy()
    await expect(stat(join(dir, 'untracked', 'small.txt'))).resolves.toBeTruthy()
  })

  it('stops snapshotting untracked files once the total budget is hit', async () => {
    await writeFile(join(repoRoot, 'a.bin'), Buffer.alloc(600_000, 1))
    await writeFile(join(repoRoot, 'b.bin'), Buffer.alloc(600_000, 1))
    const checkpoint = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_1',
      storage: { maxUntrackedFileBytes: 1_000_000, maxUntrackedTotalBytes: 1_000_000 }
    })
    if (!checkpoint.ok) throw new Error(checkpoint.message)
    const dir = join(dataDir, 'git-checkpoints', checkpoint.checkpointId)
    const metadata = JSON.parse(await readFile(join(dir, 'metadata.json'), 'utf-8')) as {
      untrackedFiles: string[]; skippedUntracked?: string[]
    }
    // One file fits the 1MB budget, the second is skipped.
    expect(metadata.untrackedFiles.length).toBe(1)
    expect(metadata.skippedUntracked?.length).toBe(1)
  })

  it('marks a checkpoint with skipped untracked files as partial and refuses to restore it (no data loss)', async () => {
    // A large untracked file is skipped by the size cap, so the checkpoint is
    // partial. Restoring would `git clean -fd` the never-captured file, so the
    // restore must be refused unless the caller opts in.
    await writeFile(join(repoRoot, 'huge.bin'), Buffer.alloc(2_000_000, 1))
    const checkpoint = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_partial',
      storage: { maxUntrackedFileBytes: 1_000_000 }
    })
    if (!checkpoint.ok) throw new Error(checkpoint.message)
    const dir = join(dataDir, 'git-checkpoints', checkpoint.checkpointId)
    const metadata = JSON.parse(await readFile(join(dir, 'metadata.json'), 'utf-8')) as { completeness?: string }
    expect(metadata.completeness).toBe('partial')

    const restored = await restoreGitCheckpoint({ dataDir, checkpointId: checkpoint.checkpointId })
    expect(restored.ok).toBe(false)
    if (restored.ok) throw new Error('expected partial restore to be refused')
    expect(restored.reason).toBe('partial')
    expect('skippedUntracked' in restored && restored.skippedUntracked).toContain('huge.bin')
    // The destructive ops never ran: the skipped file is byte-for-byte intact.
    expect((await stat(join(repoRoot, 'huge.bin'))).size).toBe(2_000_000)
  })

  it('marks a fully-captured checkpoint as complete', async () => {
    await writeFile(join(repoRoot, 'small.txt'), 'tiny')
    const checkpoint = await createGitCheckpoint({ dataDir, workspaceRoot: repoRoot, threadId: 'thr_complete' })
    if (!checkpoint.ok) throw new Error(checkpoint.message)
    const dir = join(dataDir, 'git-checkpoints', checkpoint.checkpointId)
    const metadata = JSON.parse(await readFile(join(dir, 'metadata.json'), 'utf-8')) as { completeness?: string }
    expect(metadata.completeness).toBe('complete')
  })

  it('restores a partial checkpoint only when the bounded rescue is complete', async () => {
    await writeFile(join(repoRoot, 'huge.bin'), Buffer.alloc(2_000_000, 7))
    const checkpoint = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_partial_ok',
      storage: { maxUntrackedFileBytes: 1_000_000 }
    })
    if (!checkpoint.ok) throw new Error(checkpoint.message)

    const restored = await restoreGitCheckpoint({
      dataDir,
      checkpointId: checkpoint.checkpointId,
      allowPartialRestore: true
    })
    expect(restored.ok).toBe(true)
    if (!restored.ok) throw new Error(restored.message)
    expect(restored.rescueCheckpointId).toMatch(/^gcp_/)
    // The file exceeds the original checkpoint's custom cap but fits the normal
    // bounded rescue policy, so it remains recoverable.
    const rescueUntracked = join(dataDir, 'git-checkpoints', restored.rescueCheckpointId as string, 'untracked', 'huge.bin')
    expect((await stat(rescueUntracked)).size).toBe(2_000_000)
  })

  it('fails closed before reset/clean when the rescue snapshot is partial', async () => {
    await writeFile(join(repoRoot, 'huge.bin'), Buffer.alloc(6_000_000, 9))
    const checkpoint = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_partial_rescue',
      storage: { maxUntrackedFileBytes: 1_000_000 }
    })
    if (!checkpoint.ok) throw new Error(checkpoint.message)

    const restored = await restoreGitCheckpoint({
      dataDir,
      checkpointId: checkpoint.checkpointId,
      allowPartialRestore: true
    })
    expect(restored.ok).toBe(false)
    if (restored.ok) throw new Error('expected incomplete rescue to refuse restore')
    expect(restored.reason).toBe('partial')
    expect((await stat(join(repoRoot, 'huge.bin'))).size).toBe(6_000_000)
  })

  it('prunes oldest checkpoints beyond the per-thread cap', async () => {
    const ids: string[] = []
    for (let i = 0; i < 4; i += 1) {
      const cp = await createGitCheckpoint({
        dataDir,
        workspaceRoot: repoRoot,
        threadId: 'thr_cap',
        checkpointId: `gcp_${1000 + i}_fixed-${i}`,
        storage: { maxPerThread: 2 }
      })
      if (!cp.ok) throw new Error(cp.message)
      ids.push(cp.checkpointId)
    }
    const root = join(dataDir, 'git-checkpoints')
    // Only the two newest survive; the two oldest are pruned.
    await expect(stat(join(root, ids[0]))).rejects.toBeTruthy()
    await expect(stat(join(root, ids[1]))).rejects.toBeTruthy()
    await expect(stat(join(root, ids[2]))).resolves.toBeTruthy()
    await expect(stat(join(root, ids[3]))).resolves.toBeTruthy()
  })
})
