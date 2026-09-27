import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskWorkspaceStore } from './task-workspace-store.js'
import { TaskWorkspaceService } from './task-workspace-service.js'
import { createWorktreeLifecycle } from './worktree-lifecycle.js'
import {
  assertWorkspaceWriteFence,
  workspaceCommitGit,
  workspaceGit,
  withWorkspaceWriteCommit
} from './workspace-git.js'
import type {
  CreateTaskWorkspaceRequest,
  TaskWorkspaceRecord
} from '../contracts/task-workspace.js'

const execFileAsync = promisify(execFile)
const roots: string[] = []
const stores: TaskWorkspaceStore[] = []

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.flush()))
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
})

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}

async function initRepo(dir: string, remote = false): Promise<void> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init', '-b', 'main'])
  await git(dir, ['config', 'user.email', 'twp-test@example.test'])
  await git(dir, ['config', 'user.name', 'TW Preview'])
  await writeFile(join(dir, 'a.txt'), 'a\n')
  await writeFile(join(dir, 'b.txt'), 'b\n')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'test: base'])
  if (remote) await git(dir, ['remote', 'add', 'origin', 'https://example.test/r.git'])
}

function makeHarness() {
  const lifecycle = createWorktreeLifecycle({
    git: workspaceGit,
    commitGit: workspaceCommitGit,
    fence: assertWorkspaceWriteFence,
    withCommit: withWorkspaceWriteCommit
  })
  return async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-twp-data-'))
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'kun-twp-wt-'))
    roots.push(dataDir, worktreeRoot)
    const store = new TaskWorkspaceStore({ dataDir, flushDelayMs: 1 })
    await store.load()
    stores.push(store)
    return { service: new TaskWorkspaceService({ store, lifecycle, worktreeRoot }), store }
  }
}

async function waitReady(
  service: TaskWorkspaceService,
  id: string
): Promise<TaskWorkspaceRecord> {
  let record: TaskWorkspaceRecord | undefined
  await vi.waitFor(() => {
    record = service.get(id)
    if (!record || record.state === 'creating' || record.state === 'setting-up') {
      throw new Error(`waiting; state=${record?.state}`)
    }
  }, { timeout: 15_000, interval: 10 })
  if (record!.state !== 'ready') throw new Error(`workspace failed: ${record!.lastError}`)
  return record!
}

async function makeRepo(remote = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-twp-repo-'))
  roots.push(root)
  const repo = join(root, 'repo')
  await initRepo(repo, remote)
  return repo
}

async function makeWorkspace(
  service: TaskWorkspaceService,
  repo: string,
  extra: Partial<CreateTaskWorkspaceRequest> = {}
): Promise<TaskWorkspaceRecord> {
  const created = service.create({
    ownerThreadId: 'thread-1',
    label: 'Preview Task',
    sourceRoot: repo,
    isolation: 'worktree',
    startFrom: { kind: 'current-head' },
    ...extra
  })
  return waitReady(service, created.workspaceId)
}

describe('taskWorkspaceIntegratePreview', () => {
  it('enables both modes on a clean committed worktree', async () => {
    const { service } = await makeHarness()()
    const repo = await makeRepo(true)
    const ws = await makeWorkspace(service, repo)
    await writeFile(join(ws.path, 'a.txt'), 'a changed\n')
    await git(ws.path, ['add', '.'])
    await git(ws.path, ['commit', '-m', 'test: work'])
    const preview = await service.integratePreview(ws.workspaceId)
    expect(preview).toEqual({
      canApplyPatch: true,
      canMergeBranch: true,
      hasUncommitted: false,
      hasRemote: true
    })
  })

  it('blocks apply-patch when the source HEAD moved; merge stays available', async () => {
    const { service } = await makeHarness()()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo)
    await writeFile(join(repo, 'b.txt'), 'b moved\n')
    await git(repo, ['add', '.'])
    await git(repo, ['commit', '-m', 'test: source moved'])
    const preview = await service.integratePreview(ws.workspaceId)
    expect(preview.canApplyPatch).toBe(false)
    expect(preview.applyBlockReason).toMatch(/HEAD changed/)
    expect(preview.canMergeBranch).toBe(true)
  })

  it('blocks both modes on overlapping dirty source changes', async () => {
    const { service } = await makeHarness()()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo)
    await writeFile(join(ws.path, 'a.txt'), 'a worktree\n')
    await git(ws.path, ['add', '.'])
    await git(ws.path, ['commit', '-m', 'test: work'])
    await writeFile(join(repo, 'a.txt'), 'a source dirty\n')
    const preview = await service.integratePreview(ws.workspaceId)
    expect(preview.canApplyPatch).toBe(false)
    expect(preview.applyBlockReason).toMatch(/overlapping/)
    expect(preview.canMergeBranch).toBe(false)
    expect(preview.mergeBlockReason).toMatch(/overlapping/)
  })

  it('ignores non-overlapping dirty source files', async () => {
    const { service } = await makeHarness()()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo)
    await writeFile(join(ws.path, 'a.txt'), 'a worktree\n')
    await writeFile(join(repo, 'unrelated.txt'), 'unrelated\n')
    const preview = await service.integratePreview(ws.workspaceId)
    expect(preview.canApplyPatch).toBe(true)
    expect(preview.hasUncommitted).toBe(true)
  })

  it('blocks merge-branch when the worktree has no branch', async () => {
    const { service, store } = await makeHarness()()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo)
    await writeFile(join(ws.path, 'a.txt'), 'a worktree\n')
    store.update(ws.workspaceId, {
      branch: undefined,
      targetBranch: undefined,
      updatedAt: new Date().toISOString()
    })
    const preview = await service.integratePreview(ws.workspaceId)
    expect(preview.canMergeBranch).toBe(false)
    expect(preview.mergeBlockReason).toMatch(/no local integration branch/)
    expect(preview.canApplyPatch).toBe(true)
  })

  it('blocks merge-branch when the branch ref was deleted', async () => {
    const { service } = await makeHarness()()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo)
    // update-ref bypasses the worktree check `branch -D` performs.
    await git(repo, ['update-ref', '-d', `refs/heads/${ws.branch as string}`])
    const preview = await service.integratePreview(ws.workspaceId)
    expect(preview.canMergeBranch).toBe(false)
    expect(preview.mergeBlockReason).toMatch(/no longer exists/)
  })

  it('reports no remote and uncommitted worktree changes', async () => {
    const { service } = await makeHarness()()
    const repo = await makeRepo(false)
    const ws = await makeWorkspace(service, repo)
    await writeFile(join(ws.path, 'a.txt'), 'a dirty\n')
    const preview = await service.integratePreview(ws.workspaceId)
    expect(preview.hasRemote).toBe(false)
    expect(preview.hasUncommitted).toBe(true)
    // Uncommitted changes are still patch-integrable (capture stages them).
    expect(preview.canApplyPatch).toBe(true)
  })

  it('blocks both modes outside integrable states', async () => {
    const { service, store } = await makeHarness()()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo)
    store.update(ws.workspaceId, {
      state: 'integrated',
      updatedAt: new Date().toISOString()
    })
    const preview = await service.integratePreview(ws.workspaceId)
    expect(preview.canApplyPatch).toBe(false)
    expect(preview.canMergeBranch).toBe(false)
    expect(preview.applyBlockReason).toMatch(/integrated/)
  })

  it('blocks non-worktree isolation without probing git', async () => {
    const { service } = await makeHarness()()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo, { isolation: 'local' })
    const preview = await service.integratePreview(ws.workspaceId)
    expect(preview.canApplyPatch).toBe(false)
    expect(preview.applyBlockReason).toMatch(/local isolation/)
  })

  it('is read-only: no index, tree, or record mutation', async () => {
    const { service, store } = await makeHarness()()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo)
    await writeFile(join(ws.path, 'a.txt'), 'a dirty\n')
    const before = {
      record: store.get(ws.workspaceId),
      sourceStatus: (await workspaceGit(repo, ['status', '--porcelain'])).trim(),
      worktreeStatus: (await workspaceGit(ws.path, ['status', '--porcelain'])).trim(),
      worktreeIndex: (await workspaceGit(ws.path, ['diff', '--cached', '--name-only'])).trim()
    }
    await service.integratePreview(ws.workspaceId)
    expect(store.get(ws.workspaceId)).toEqual(before.record)
    expect((await workspaceGit(repo, ['status', '--porcelain'])).trim())
      .toBe(before.sourceStatus)
    expect((await workspaceGit(ws.path, ['status', '--porcelain'])).trim())
      .toBe(before.worktreeStatus)
    // Nothing staged the dirty file.
    expect((await workspaceGit(ws.path, ['diff', '--cached', '--name-only'])).trim())
      .toBe(before.worktreeIndex)
  })
})
