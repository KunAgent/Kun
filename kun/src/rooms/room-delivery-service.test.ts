import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRoomDelivery, prepareRoomReviewWorktree, applyRoomDelivery } from './room-delivery-service.js'
import { observeRoomRepository, createRoomTaskWorktree } from './task-workspace-service.js'

const exec = promisify(execFile)
const temporary: string[] = []
const ownership = async (): Promise<void> => {}
const git = async (cwd: string, ...args: string[]): Promise<string> =>
  (await exec('git', args, { cwd })).stdout.trim()
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'kun rooms 交付 '))
  temporary.push(base)
  const source = join(base, 'source project')
  await mkdir(source)
  await git(source, 'init', '-b', 'develop')
  await git(source, 'config', 'user.name', 'Kun Test')
  await git(source, 'config', 'user.email', 'kun-test@example.invalid')
  await writeFile(join(source, 'source.txt'), 'baseline\n')
  await git(source, 'add', '--', 'source.txt')
  await git(source, 'commit', '-m', 'baseline')
  const repository = await observeRoomRepository(source)
  const taskId = 'task_one'
  const workspace = await createRoomTaskWorktree({ repository, taskId,
    destination: join(base, 'task project'), assertOwnership: ownership })
  const artifacts = new Map<string, string>()
  const input = {
    repository, taskId, workspacePath: workspace.path, workspaceBranch: workspace.branch,
    baseRevision: workspace.baseRevision, id: 'delivery_one', attemptId: 'attempt_one',
    version: 1, summary: 'Implemented change', assertOwnership: ownership,
    persistDiff: async (id: string, diff: string) => {
      const existing = artifacts.get(id)
      if (existing !== undefined && existing !== diff) throw new Error('immutable artifact changed')
      artifacts.set(id, diff)
    }
  }
  return { base, source, repository, workspace, input, artifacts }
}

describe('room delivery Git lifecycle', () => {
  it('freezes only task files and preserves source staged, unstaged, and untracked changes', async () => {
    const f = await fixture()
    await writeFile(join(f.source, 'source.txt'), 'user staged\n')
    await git(f.source, 'add', '--', 'source.txt')
    await writeFile(join(f.source, 'source.txt'), 'user unstaged\n')
    await writeFile(join(f.source, 'private.txt'), 'user untracked\n')
    const status = await git(f.source, 'status', '--porcelain=v1')
    const index = await git(f.source, 'show', ':source.txt')
    await writeFile(join(f.workspace.path, 'source.txt'), 'task implementation\n')
    await writeFile(join(f.workspace.path, '带 空格.txt'), 'new file\n')
    const delivery = await createRoomDelivery(f.input)
    expect(delivery.baseRevision).toBe(f.repository.head)
    expect(delivery.versionHash).not.toBe(delivery.baseRevision)
    expect(delivery.changedFiles).toEqual(['source.txt', '带 空格.txt'])
    expect(f.artifacts.get(delivery.diffArtifactId)).toContain('+task implementation')
    expect(await git(f.source, 'status', '--porcelain=v1')).toBe(status)
    expect(await git(f.source, 'show', ':source.txt')).toBe(index)
    expect(await readFile(join(f.source, 'source.txt'), 'utf8')).toBe('user unstaged\n')
    expect(await readFile(join(f.source, 'private.txt'), 'utf8')).toBe('user untracked\n')
    expect((await observeRoomRepository(f.source)).head).toBe(f.repository.head)
    await expect(applyRoomDelivery({ ...f.input, delivery, expectedTarget: f.repository }))
      .rejects.toThrow('uncommitted')
    expect(await readFile(join(f.source, 'source.txt'), 'utf8')).toBe('user unstaged\n')
  })

  it('keeps a reviewer on an immutable snapshot when development continues', async () => {
    const f = await fixture()
    await writeFile(join(f.workspace.path, 'source.txt'), 'version one\n')
    const first = await createRoomDelivery(f.input)
    const review = await prepareRoomReviewWorktree({ ...f.input, delivery: first,
      destination: join(f.base, 'review one') })
    await writeFile(join(f.workspace.path, 'source.txt'), 'version two\n')
    const second = await createRoomDelivery({ ...f.input, id: 'delivery_two', version: 2 })
    expect(first.versionHash).not.toBe(second.versionHash)
    expect(review.versionHash).toBe(first.versionHash)
    expect(await readFile(join(review.path, 'source.txt'), 'utf8')).toBe('version one\n')
    expect((await observeRoomRepository(review.path, true)).branch).toBe('')
    expect(await prepareRoomReviewWorktree({ ...f.input, delivery: first, destination: review.path }))
      .toEqual(review)
    expect(await git(f.source, 'rev-parse', first.pinRef)).toBe(first.versionHash)
    expect(await git(f.source, 'rev-parse', second.pinRef)).toBe(second.versionHash)
    // Retrying an acknowledged or unacknowledged materialization cannot repin v1.
    const retried = await createRoomDelivery(f.input)
    expect(retried.versionHash).toBe(first.versionHash)
    expect(retried.changedFiles).toEqual(first.changedFiles)
    expect(f.artifacts.get(first.id)).toContain('+version one')
    expect(f.artifacts.get(first.id)).not.toContain('+version two')
  })

  it('applies a pinned commit only explicitly, and safely acknowledges a repeated application', async () => {
    const f = await fixture()
    await writeFile(join(f.workspace.path, 'source.txt'), 'delivered\n')
    const delivery = await createRoomDelivery(f.input)
    expect(await readFile(join(f.source, 'source.txt'), 'utf8')).toBe('baseline\n')
    const result = await applyRoomDelivery({ ...f.input, delivery, expectedTarget: f.repository })
    expect(result).toEqual({ head: delivery.versionHash, alreadyApplied: false })
    expect(await readFile(join(f.source, 'source.txt'), 'utf8')).toBe('delivered\n')
    expect(await applyRoomDelivery({ ...f.input, delivery, expectedTarget: f.repository }))
      .toEqual({ head: delivery.versionHash, alreadyApplied: true })
    await expect(access(f.workspace.path)).resolves.toBeUndefined()
    expect(await git(f.source, 'rev-parse', `refs/heads/${f.workspace.branch}`)).toBe(delivery.versionHash)
  })

  it('rejects a stale preview and divergent source history without overwriting either side', async () => {
    const f = await fixture()
    await writeFile(join(f.workspace.path, 'source.txt'), 'task delivery\n')
    const delivery = await createRoomDelivery(f.input)
    await writeFile(join(f.source, 'other.txt'), 'user committed\n')
    await git(f.source, 'add', '--', 'other.txt')
    await git(f.source, 'commit', '-m', 'advance source')
    const advanced = await observeRoomRepository(f.source)
    await expect(applyRoomDelivery({ ...f.input, delivery, expectedTarget: f.repository }))
      .rejects.toThrow('changed')
    await expect(applyRoomDelivery({ ...f.input, delivery, expectedTarget: advanced }))
      .rejects.toThrow('not a fast-forward')
    expect((await observeRoomRepository(f.source)).head).toBe(advanced.head)
    expect(await readFile(join(f.source, 'source.txt'), 'utf8')).toBe('baseline\n')
    expect(await readFile(join(f.source, 'other.txt'), 'utf8')).toBe('user committed\n')
    expect(await readFile(join(f.workspace.path, 'source.txt'), 'utf8')).toBe('task delivery\n')
  })

  it('pins a no-change task without producing an unnecessary commit', async () => {
    const f = await fixture()
    const delivery = await createRoomDelivery(f.input)
    expect(delivery.versionHash).toBe(f.repository.head)
    expect(delivery.changedFiles).toEqual([])
    expect(f.artifacts.get(delivery.id)).toBe('')
  })

  it('retains the delivery pin and working tree when artifact persistence fails', async () => {
    const f = await fixture()
    await writeFile(join(f.workspace.path, 'source.txt'), 'ready\n')
    await expect(createRoomDelivery({ ...f.input, persistDiff: async () => { throw new Error('storage offline') } }))
      .rejects.toThrow('storage offline')
    const head = (await observeRoomRepository(f.workspace.path)).head
    expect(await git(f.source, 'rev-parse', 'refs/kun/rooms/task_one/delivery_one')).toBe(head)
    expect((await createRoomDelivery(f.input)).versionHash).toBe(head)
    expect(await readFile(join(f.source, 'source.txt'), 'utf8')).toBe('baseline\n')
  })

  it('rejects stale ownership before staging and before applying', async () => {
    const f = await fixture()
    await writeFile(join(f.workspace.path, 'source.txt'), 'task dirty\n')
    const denied = async (): Promise<void> => { throw new Error('lease lost') }
    await expect(createRoomDelivery({ ...f.input, assertOwnership: denied })).rejects.toThrow('lease lost')
    expect(await git(f.workspace.path, 'diff', '--cached', '--name-only')).toBe('')
    const delivery = await createRoomDelivery(f.input)
    await expect(applyRoomDelivery({ ...f.input, delivery, expectedTarget: f.repository, assertOwnership: denied }))
      .rejects.toThrow('lease lost')
    expect((await observeRoomRepository(f.source)).head).toBe(f.repository.head)
  })

  it('validates delivery metadata before staging task files', async () => {
    const f = await fixture()
    await writeFile(join(f.workspace.path, 'source.txt'), 'task dirty\n')
    await expect(createRoomDelivery({ ...f.input, version: 0 })).rejects.toThrow()
    expect(await git(f.workspace.path, 'diff', '--cached', '--name-only')).toBe('')
    expect((await observeRoomRepository(f.workspace.path)).head).toBe(f.repository.head)
  })

  it('rejects changed branch identities and unfinished Git operations', async () => {
    const f = await fixture()
    await writeFile(join(f.workspace.path, 'source.txt'), 'task dirty\n')
    await expect(createRoomDelivery({ ...f.input, workspacePath: f.source })).rejects.toThrow('identity changed')
    await expect(createRoomDelivery({ ...f.input, workspaceBranch: 'develop' })).rejects.toThrow('does not belong')
    await writeFile(join(f.source, '.git', 'MERGE_HEAD'), f.repository.head)
    const delivery = await createRoomDelivery(f.input)
    await expect(applyRoomDelivery({ ...f.input, delivery, expectedTarget: f.repository }))
      .rejects.toThrow('unfinished Git operation')
    await rm(join(f.source, '.git', 'MERGE_HEAD'))
    await git(f.source, 'switch', '-c', 'other')
    await expect(applyRoomDelivery({ ...f.input, delivery, expectedTarget: f.repository })).rejects.toThrow('changed')
  })

  it('rejects a tampered delivery pin for reviews and application', async () => {
    const f = await fixture()
    await writeFile(join(f.workspace.path, 'source.txt'), 'task dirty\n')
    const delivery = await createRoomDelivery(f.input)
    await git(f.source, 'update-ref', delivery.pinRef, delivery.baseRevision)
    await expect(prepareRoomReviewWorktree({ ...f.input, delivery, destination: join(f.base, 'review') }))
      .rejects.toThrow('pin changed')
    await expect(applyRoomDelivery({ ...f.input, delivery, expectedTarget: f.repository }))
      .rejects.toThrow('pin changed')
  })

  it('disables user Git hooks for delivery commits', async () => {
    const f = await fixture()
    const hook = join(f.source, '.git', 'hooks', 'post-commit')
    await writeFile(hook, '#!/bin/sh\necho hook-ran > hook-output\n', { mode: 0o755 })
    await writeFile(join(f.workspace.path, 'source.txt'), 'task dirty\n')
    await createRoomDelivery(f.input)
    await expect(access(join(f.workspace.path, 'hook-output'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
