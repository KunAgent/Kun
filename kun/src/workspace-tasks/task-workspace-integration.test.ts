import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskWorkspaceStore } from './task-workspace-store.js'
import {
  TaskWorkspaceService,
  type TaskWorkspaceServiceOptions
} from './task-workspace-service.js'
import {
  TaskWorkspaceDiscardPending,
  type TaskWorkspaceArtifacts
} from './task-workspace-integration.js'
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
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' })).stdout
}

async function initRepo(dir: string, files: Record<string, string>): Promise<string> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init', '-b', 'main'])
  await git(dir, ['config', 'core.autocrlf', 'false'])
  await git(dir, ['config', 'user.email', 'twi-test@example.test'])
  await git(dir, ['config', 'user.name', 'TW Integration'])
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content)
  }
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'test: base'])
  return (await gitOutput(dir, ['rev-parse', 'HEAD'])).trim()
}

function harness(extra: Partial<TaskWorkspaceServiceOptions> = {}) {
  const make = async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-twi-data-'))
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'kun-twi-wt-'))
    roots.push(dataDir, worktreeRoot)
    const store = new TaskWorkspaceStore({ dataDir, flushDelayMs: 1 })
    await store.load()
    stores.push(store)
    const service = new TaskWorkspaceService({ store, lifecycle, worktreeRoot, ...extra })
    return { service, store, worktreeRoot }
  }
  const lifecycle = createWorktreeLifecycle({
    git: workspaceGit,
    commitGit: workspaceCommitGit,
    fence: assertWorkspaceWriteFence,
    withCommit: withWorkspaceWriteCommit
  })
  return { make, lifecycle }
}

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-twi-repo-'))
  roots.push(root)
  const repo = join(root, 'repo')
  await initRepo(repo, { 'a.txt': 'a\n', 'b.txt': 'b\n' })
  return repo
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

async function makeWorkspace(
  service: TaskWorkspaceService,
  repo: string,
  extra: Partial<CreateTaskWorkspaceRequest> = {}
): Promise<TaskWorkspaceRecord> {
  const created = service.create({
    ownerThreadId: 'thread-1',
    label: 'Integration Task',
    sourceRoot: repo,
    isolation: 'worktree',
    startFrom: { kind: 'current-head' },
    ...extra
  })
  return waitReady(service, created.workspaceId)
}

async function commitInWorktree(path: string, file: string, content: string): Promise<void> {
  await writeFile(join(path, file), content)
  await git(path, ['add', '.'])
  await git(path, ['commit', '-m', `test: ${file}`])
}

function memoryArtifacts(): TaskWorkspaceArtifacts & { puts: string[] } {
  const puts: string[] = []
  let next = 0
  return {
    puts,
    put: async (input) => {
      puts.push(input.content)
      return { meta: { id: `art-${++next}` } }
    }
  }
}

describe('task workspace capture', () => {
  it('captures committed and uncommitted changes into a patch artifact', async () => {
    const artifacts = memoryArtifacts()
    const { service } = await harness({ artifacts }).make()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo)
    await commitInWorktree(ws.path, 'a.txt', 'a committed\n')
    await writeFile(join(ws.path, 'new.txt'), 'dirty\n')
    const captured = await service.capture(ws.workspaceId)
    expect(captured.state).toBe('captured')
    expect(captured.changedFiles).toEqual(['a.txt', 'new.txt'])
    expect(captured.headRevision).not.toBe(captured.baseRevision)
    expect(captured.patchArtifactId).toBe('art-1')
    expect(artifacts.puts[0]).toContain('a committed')
    // Capture is repeatable and overwrites the previous patch.
    await writeFile(join(ws.path, 'new.txt'), 'dirty v2\n')
    const again = await service.capture(ws.workspaceId)
    expect(again.changedFiles).toEqual(['a.txt', 'new.txt'])
    expect(again.patchArtifactId).toBe('art-2')
    expect(artifacts.puts[1]).toContain('dirty v2')
  })
})

describe('task workspace apply-patch integration', () => {
  it('applies the worktree diff onto the source checkout', async () => {
    const { service } = await harness().make()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo)
    await commitInWorktree(ws.path, 'a.txt', 'a updated\n')
    const result = await service.integrate(ws.workspaceId, 'apply-patch')
    expect(result.outcome).toBe('applied')
    expect(result.record.state).toBe('integrated')
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('a updated\n')
    // Applied content stays staged in the source checkout (apply --index).
    const staged = await gitOutput(repo, ['diff', '--cached', '--name-only'])
    expect(staged.trim()).toBe('a.txt')
  })

  it('returns needs_human when the source HEAD moved', async () => {
    const { service } = await harness().make()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo)
    await commitInWorktree(ws.path, 'a.txt', 'a updated\n')
    await git(repo, ['commit', '--allow-empty', '-m', 'advance source'])
    const before = await gitOutput(repo, ['status', '--porcelain'])
    const result = await service.integrate(ws.workspaceId, 'apply-patch')
    expect(result.outcome).toBe('needs_human')
    expect(result.record.state).toBe('conflict')
    expect(result.record.recovery?.length).toBeGreaterThan(0)
    expect(await gitOutput(repo, ['status', '--porcelain'])).toBe(before)
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('a\n')
  })

  it('returns needs_human on overlapping dirty source changes', async () => {
    const { service } = await harness().make()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo)
    await commitInWorktree(ws.path, 'a.txt', 'a updated\n')
    await writeFile(join(repo, 'a.txt'), 'user edit\n')
    const result = await service.integrate(ws.workspaceId, 'apply-patch')
    expect(result.outcome).toBe('needs_human')
    expect(result.reason).toContain('uncommitted changes overlapping')
    // Source file content is preserved byte-for-byte.
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('user edit\n')
    const status = await gitOutput(repo, ['status', '--porcelain'])
    expect(status).toContain('a.txt')
    expect(status).not.toContain('new.txt')
  })

  it('does not count files staged by an earlier integration as user overlap', async () => {
    const { service } = await harness().make()
    const repo = await makeRepo()
    const first = await makeWorkspace(service, repo, { label: 'first' })
    await commitInWorktree(first.path, 'a.txt', 'a from first\n')
    expect((await service.integrate(first.workspaceId, 'apply-patch')).outcome).toBe('applied')
    const second = await makeWorkspace(service, repo, { ownerThreadId: 'thread-2', label: 'second' })
    expect(second.workspaceId).not.toBe(first.workspaceId)
    await commitInWorktree(second.path, 'b.txt', 'b from second\n')
    const result = await service.integrate(second.workspaceId, 'apply-patch')
    expect(result.outcome).toBe('applied')
    expect(await readFile(join(repo, 'b.txt'), 'utf8')).toBe('b from second\n')
  })
})

describe('task workspace merge-branch integration', () => {
  it('rebases onto an advanced target and fast-forwards it', async () => {
    const { service } = await harness().make()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo)
    expect(ws.targetBranch).toBe('main')
    await commitInWorktree(ws.path, 'feature.txt', 'feature\n')
    // Advance the target after the workspace was created.
    await writeFile(join(repo, 'upstream.txt'), 'upstream\n')
    await git(repo, ['add', '.'])
    await git(repo, ['commit', '-m', 'advance main'])
    const result = await service.integrate(ws.workspaceId, 'merge-branch')
    expect(result.outcome).toBe('merged')
    expect(result.record.state).toBe('integrated')
    expect(await gitOutput(repo, ['rev-parse', 'main'])).toBe(
      await gitOutput(repo, ['rev-parse', ws.branch!])
    )
    expect(await readFile(join(repo, 'feature.txt'), 'utf8')).toBe('feature\n')
    expect(await readFile(join(repo, 'upstream.txt'), 'utf8')).toBe('upstream\n')
  })

  it('fast-forwards without a rebase when the target did not move', async () => {
    const { service } = await harness().make()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo)
    await commitInWorktree(ws.path, 'feature.txt', 'feature\n')
    const result = await service.integrate(ws.workspaceId, 'merge-branch')
    expect(result.outcome).toBe('merged')
    const log = await gitOutput(repo, ['log', '--oneline', 'main'])
    expect(log).toContain('feature.txt')
  })

  it('returns conflict and preserves the worktree on a rebase conflict', async () => {
    const { service } = await harness().make()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo)
    await commitInWorktree(ws.path, 'a.txt', 'worker edit\n')
    await writeFile(join(repo, 'a.txt'), 'conflicting upstream\n')
    await git(repo, ['add', '.'])
    await git(repo, ['commit', '-m', 'conflicting upstream'])
    const result = await service.integrate(ws.workspaceId, 'merge-branch')
    expect(result.outcome).toBe('conflict')
    expect(result.record.state).toBe('conflict')
    expect(result.record.recovery?.join(' ')).toContain('preserved')
    await git(ws.path, ['rebase', '--abort']).catch(() => undefined)
    // The user's commit on main is untouched.
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('conflicting upstream\n')
    expect(await stat(ws.path)).toBeTruthy()
  })

  it('returns needs_human when there is no local integration branch', async () => {
    const { service } = await harness().make()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo, {
      startFrom: { kind: 'commit', sha: await gitOutput(repo, ['rev-parse', 'HEAD']).then((s) => s.trim()) }
    })
    expect(ws.targetBranch).toBeUndefined()
    const result = await service.integrate(ws.workspaceId, 'merge-branch')
    expect(result.outcome).toBe('needs_human')
    expect(result.reason).toContain('no local integration branch')
  })

  it('serializes concurrent integrations against the same repository', async () => {
    const base = createWorktreeLifecycle({
      git: workspaceGit,
      commitGit: workspaceCommitGit,
      fence: assertWorkspaceWriteFence,
      withCommit: withWorkspaceWriteCommit
    })
    const order: string[] = []
    const instrumented = {
      ...base,
      applyPatch: async (...args: Parameters<typeof base.applyPatch>) => {
        order.push('start')
        await new Promise((resolve) => setTimeout(resolve, 25))
        order.push('end')
        return base.applyPatch(...args)
      }
    }
    const { service } = await harness({ lifecycle: instrumented }).make()
    const repo = await makeRepo()
    const first = await makeWorkspace(service, repo, { label: 'one' })
    const second = await makeWorkspace(service, repo, { ownerThreadId: 'thread-2', label: 'two' })
    await commitInWorktree(first.path, 'a.txt', 'a1\n')
    expect(second.workspaceId).not.toBe(first.workspaceId)
    await commitInWorktree(second.path, 'b.txt', 'b2\n')
    const [a, b] = await Promise.all([
      service.integrate(first.workspaceId, 'apply-patch'),
      service.integrate(second.workspaceId, 'apply-patch')
    ])
    expect(a.outcome).toBe('applied')
    expect(b.outcome).toBe('applied')
    expect(order).toEqual(['start', 'end', 'start', 'end'])
  })
})

describe('task workspace discard and cleanup', () => {
  it('previews damage without confirm and force-removes with it', async () => {
    const { service } = await harness().make()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo)
    await commitInWorktree(ws.path, 'a.txt', 'a updated\n')
    await writeFile(join(ws.path, 'dirty.txt'), 'dirty\n')
    const pending = await service.discard(ws.workspaceId, false).then(
      () => { throw new Error('expected discard preview') },
      (error: unknown) => error
    )
    expect(pending).toBeInstanceOf(TaskWorkspaceDiscardPending)
    const preview = (pending as TaskWorkspaceDiscardPending).preview
    expect(preview.uncommittedFiles).toBeGreaterThan(0)
    expect(preview.unpushedCommits).toBeGreaterThan(0)
    expect(service.get(ws.workspaceId)?.state).toBe('ready')
    const removed = await service.discard(ws.workspaceId, true)
    expect(removed.state).toBe('removed')
    await expect(stat(ws.path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      gitOutput(repo, ['rev-parse', '--verify', ws.branch!])
    ).rejects.toBeTruthy()
  })

  it('cleanup preserves branches with unmerged commits', async () => {
    const { service } = await harness().make()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo)
    await commitInWorktree(ws.path, 'a.txt', 'a updated\n')
    // apply-patch leaves the worktree branch unmerged relative to main.
    expect((await service.integrate(ws.workspaceId, 'apply-patch')).outcome).toBe('applied')
    const cleaned = await service.cleanupIntegrated(ws.workspaceId)
    expect(cleaned.state).toBe('preserved')
    await expect(stat(ws.path)).rejects.toMatchObject({ code: 'ENOENT' })
    const preserved = await service.preservedBranches(repo)
    expect(preserved).toHaveLength(1)
    expect(preserved[0]!.branch).toBe(ws.branch)
    expect(preserved[0]!.aheadBy).toBeGreaterThan(0)
    expect(preserved[0]!.lastCommit).toBeTruthy()
  })

  it('preserves the workspace when non-force removal refuses a dirty tree', async () => {
    const { service } = await harness().make()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo)
    await writeFile(join(ws.path, 'dirty.txt'), 'uncommitted\n')
    expect((await service.integrate(ws.workspaceId, 'apply-patch')).outcome).toBe('applied')
    const cleaned = await service.cleanupIntegrated(ws.workspaceId)
    expect(cleaned.state).toBe('preserved')
    expect(cleaned.lastError).toContain('cleanup failed')
    expect(await stat(ws.path)).toBeTruthy()
  })

  it('cleanup removes merged branches and worktree cleanly', async () => {
    const { service } = await harness().make()
    const repo = await makeRepo()
    const ws = await makeWorkspace(service, repo)
    await commitInWorktree(ws.path, 'a.txt', 'a updated\n')
    expect((await service.integrate(ws.workspaceId, 'merge-branch')).outcome).toBe('merged')
    const cleaned = await service.cleanupIntegrated(ws.workspaceId)
    expect(cleaned.state).toBe('removed')
    await expect(stat(ws.path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await service.preservedBranches(repo)).toHaveLength(0)
  })
})
