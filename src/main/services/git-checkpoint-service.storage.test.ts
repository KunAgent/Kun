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

  it('keeps the newest message-referenced checkpoints within the hard cap (issue #1156)', async () => {
    const ids: string[] = []
    for (let i = 0; i < 2; i += 1) {
      const checkpoint = await createGitCheckpoint({
        dataDir,
        workspaceRoot: repoRoot,
        threadId: 'thr_referenced_cap',
        checkpointId: `gcp_${2000 + i}_fixed-${i}`,
        storage: { maxPerThread: 2 }
      })
      if (!checkpoint.ok) throw new Error(checkpoint.message)
      ids.push(checkpoint.checkpointId)
    }
    await mkdir(join(dataDir, 'threads', 'thr_referenced_cap'), { recursive: true })
    await writeFile(
      join(dataDir, 'threads', 'thr_referenced_cap', 'items.jsonl'),
      `${JSON.stringify({ id: 'item_1', workspaceCheckpointId: ids[0] })}\n`,
      'utf-8'
    )

    for (let i = 2; i < 4; i += 1) {
      const checkpoint = await createGitCheckpoint({
        dataDir,
        workspaceRoot: repoRoot,
        threadId: 'thr_referenced_cap',
        checkpointId: `gcp_${2000 + i}_fixed-${i}`,
        storage: { maxPerThread: 2 }
      })
      if (!checkpoint.ok) throw new Error(checkpoint.message)
      ids.push(checkpoint.checkpointId)
    }

    const root = join(dataDir, 'git-checkpoints')
    // Hard cap: only the two newest survive; the referenced-but-old ids[0]
    // and unreferenced ids[1] are gone. Their rollbacks become expired.
    await expect(stat(join(root, ids[0]))).rejects.toThrow()
    await expect(stat(join(root, ids[1]))).rejects.toThrow()
    await expect(stat(join(root, ids[2]))).resolves.toBeTruthy()
    await expect(stat(join(root, ids[3]))).resolves.toBeTruthy()
  })

  it('skips creation with quota_exceeded when the total cap cannot be met (issue #1156)', async () => {
    const first = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_quota'
    })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    // A cap below the actual staged checkpoint must refuse publication.
    const second = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_quota',
      storage: { maxTotalBytes: 1 }
    })
    expect(second.ok).toBe(false)
    if (second.ok) throw new Error('expected quota refusal')
    expect(second.reason).toBe('quota_exceeded')
    await expect(stat(join(dataDir, 'git-checkpoints', first.checkpointId))).rejects.toThrow()
  })

  it('restore reports not_found for a checkpoint evicted by retention (issue #1156)', async () => {
    const checkpoint = await createGitCheckpoint({
      dataDir,
      workspaceRoot: repoRoot,
      threadId: 'thr_expire',
      checkpointId: 'gcp_3000_expiring'
    })
    if (!checkpoint.ok) throw new Error(checkpoint.message)
    await rm(join(dataDir, 'git-checkpoints', checkpoint.checkpointId), { recursive: true, force: true })
    const restored = await restoreGitCheckpoint({ dataDir, checkpointId: checkpoint.checkpointId })
    expect(restored.ok).toBe(false)
    if (restored.ok) throw new Error('expected not_found')
    expect(restored.reason).toBe('not_found')
  })
})
