import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeEventDraft } from '../services/runtime-event-recorder.js'
import { TaskWorkspaceStore } from './task-workspace-store.js'
import {
  TaskWorkspaceService,
  type TaskWorkspaceServiceOptions
} from './task-workspace-service.js'
import { createWorktreeLifecycle } from './worktree-lifecycle.js'
import {
  assertWorkspaceWriteFence,
  workspaceCommitGit,
  workspaceGit,
  withWorkspaceWriteCommit
} from './workspace-git.js'
import type { CreateTaskWorkspaceRequest, TaskWorkspaceRecord } from '../contracts/task-workspace.js'

const execFileAsync = promisify(execFile)
const roots: string[] = []
const stores: TaskWorkspaceStore[] = []

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.flush()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' })).stdout
}

async function initRepo(dir: string, files: Record<string, string>): Promise<string> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init'])
  await git(dir, ['config', 'user.email', 'tw-test@example.test'])
  await git(dir, ['config', 'user.name', 'TW Test'])
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content)
  }
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'test: base'])
  return (await gitOutput(dir, ['rev-parse', 'HEAD'])).trim()
}

function harness(extra: Partial<TaskWorkspaceServiceOptions> = {}) {
  const drafts: RuntimeEventDraft[] = []
  const lifecycle = createWorktreeLifecycle({
    git: workspaceGit,
    commitGit: workspaceCommitGit,
    fence: assertWorkspaceWriteFence,
    withCommit: withWorkspaceWriteCommit
  })
  const make = async (): Promise<{
    service: TaskWorkspaceService
    store: TaskWorkspaceStore
    drafts: RuntimeEventDraft[]
    dataDir: string
    worktreeRoot: string
  }> => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-tws-data-'))
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'kun-tws-wt-'))
    roots.push(dataDir, worktreeRoot)
    const store = new TaskWorkspaceStore({ dataDir, flushDelayMs: 1 })
    await store.load()
    stores.push(store)
    const service = new TaskWorkspaceService({
      store,
      lifecycle,
      worktreeRoot,
      events: { record: (draft) => { drafts.push(draft) } },
      ...extra
    })
    return { service, store, drafts, dataDir, worktreeRoot }
  }
  return { make, drafts }
}

async function waitState(
  service: TaskWorkspaceService,
  id: string,
  states: string[]
): Promise<TaskWorkspaceRecord> {
  let record: TaskWorkspaceRecord | undefined
  await vi.waitFor(() => {
    record = service.get(id)
    if (!record || !states.includes(record.state)) {
      throw new Error(`waiting; state=${record?.state}`)
    }
  }, { timeout: 15_000, interval: 10 })
  return record as TaskWorkspaceRecord
}

function input(sourceRoot: string, extra: Partial<CreateTaskWorkspaceRequest> = {}) {
  return {
    ownerThreadId: 'thread-1',
    unitId: 'unit-1',
    label: 'Test Task',
    sourceRoot,
    isolation: 'worktree',
    startFrom: { kind: 'default-branch' },
    ...extra
  } satisfies CreateTaskWorkspaceRequest
}

describe('TaskWorkspaceService', () => {
  it('creates a worktree from origin/HEAD when a remote default exists', async () => {
    const { make } = harness()
    const remote = await mkdtemp(join(tmpdir(), 'kun-tws-remote-'))
    roots.push(remote)
    const remoteSha = await initRepo(remote, { 'remote.txt': 'from remote\n' })
    const { service } = await make()
    const localRoot = await mkdtemp(join(tmpdir(), 'kun-tws-local-'))
    roots.push(localRoot)
    const repoDir = join(localRoot, 'repo')
    await initRepo(repoDir, { 'local.txt': 'local base\n' })
    await git(repoDir, ['remote', 'add', 'origin', remote])
    await git(repoDir, ['fetch', 'origin'])
    await git(repoDir, ['remote', 'set-head', 'origin', '--auto'])
    const record = service.create(input(repoDir))
    const done = await waitState(service, record.workspaceId, ['ready', 'failed'])
    expect(done.state).toBe('ready')
    expect(done.baseRevision).toBe(remoteSha)
    expect(done.branch).toMatch(/^kun\/test-task-/)
    expect(await stat(join(done.path, 'remote.txt'))).toBeTruthy()
  })

  it('falls back to the local branch when no remote exists', async () => {
    const { service } = await harness().make()
    const root = await mkdtemp(join(tmpdir(), 'kun-tws-local-'))
    roots.push(root)
    const repo = join(root, 'repo')
    const head = await initRepo(repo, { 'a.txt': 'a\n' })
    const record = service.create(input(repo))
    const done = await waitState(service, record.workspaceId, ['ready', 'failed'])
    expect(done.state).toBe('ready')
    expect(done.baseRevision).toBe(head)
    expect(await stat(join(done.path, 'a.txt'))).toBeTruthy()
  })

  it('fails start_from_unresolved on detached HEAD without a remote', async () => {
    const { service } = await harness().make()
    const root = await mkdtemp(join(tmpdir(), 'kun-tws-detached-'))
    roots.push(root)
    const repo = join(root, 'repo')
    const head = await initRepo(repo, { 'a.txt': 'a\n' })
    await git(repo, ['checkout', '--detach', head])
    const record = service.create(input(repo))
    const done = await waitState(service, record.workspaceId, ['ready', 'failed'])
    expect(done.state).toBe('failed')
    expect(done.lastError).toContain('start_from_unresolved')
  })

  it('fails clearly for worktree isolation in a non-git directory', async () => {
    const { service } = await harness().make()
    const dir = await mkdtemp(join(tmpdir(), 'kun-tws-plain-'))
    roots.push(dir)
    const record = service.create(input(dir))
    const done = await waitState(service, record.workspaceId, ['ready', 'failed'])
    expect(done.state).toBe('failed')
    expect(done.lastError).toContain('not a git repository')
  })

  it('marks a non-git directory ready immediately with directory isolation', async () => {
    const { service } = await harness().make()
    const dir = await mkdtemp(join(tmpdir(), 'kun-tws-plain-'))
    roots.push(dir)
    const record = service.create(input(dir, { isolation: 'directory' }))
    const done = await waitState(service, record.workspaceId, ['ready', 'failed'])
    expect(done.state).toBe('ready')
    expect(done.path).toBe(dir)
  })

  it('rejects branch-name argument injection via check-ref-format', async () => {
    const { service } = await harness().make()
    const root = await mkdtemp(join(tmpdir(), 'kun-tws-inject-'))
    roots.push(root)
    const repo = join(root, 'repo')
    await initRepo(repo, { 'a.txt': 'a\n' })
    const record = service.create(
      input(repo, { startFrom: { kind: 'branch', name: '--upload-pack=x' } })
    )
    const done = await waitState(service, record.workspaceId, ['ready', 'failed'])
    expect(done.state).toBe('failed')
    expect(done.lastError).toContain('invalid branch name')
  })

  it('serializes two concurrent creates against the same repository', async () => {
    const { service } = await harness().make()
    const root = await mkdtemp(join(tmpdir(), 'kun-tws-par-'))
    roots.push(root)
    const repo = join(root, 'repo')
    await initRepo(repo, { 'a.txt': 'a\n' })
    const first = service.create(input(repo))
    const second = service.create(input(repo))
    const [a, b] = await Promise.all([
      waitState(service, first.workspaceId, ['ready', 'failed']),
      waitState(service, second.workspaceId, ['ready', 'failed'])
    ])
    expect(a.state).toBe('ready')
    expect(b.state).toBe('ready')
    expect(a.path).not.toBe(b.path)
  })

  it('marks a pre-aborted create cancelled', async () => {
    const { service } = await harness().make()
    const root = await mkdtemp(join(tmpdir(), 'kun-tws-cancel-'))
    roots.push(root)
    const repo = join(root, 'repo')
    await initRepo(repo, { 'a.txt': 'a\n' })
    const record = service.create(input(repo), AbortSignal.abort())
    const done = await waitState(service, record.workspaceId, ['ready', 'failed'])
    expect(done.state).toBe('failed')
    expect(done.lastError).toBe('cancelled')
  })

  it('cancels mid-setup, removes the worktree, and records cancelled', async () => {
    const setupStarted = vi.fn()
    const { service } = await harness({
      projectConfig: async () => ({
        worktree: {
          sharedDirectories: [], copyFiles: [],
          setup: [{ name: 'wait', command: 'sleep', args: ['60'], timeoutMs: 60_000 }],
          branchPrefix: 'kun/'
        }
      }),
      approvedSetup: async () => [
        { name: 'wait', command: 'sleep', args: ['60'], timeoutMs: 60_000 }
      ],
      setupRunner: {
        run: (_id, _cwd, _steps, signal) => {
          setupStarted()
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          })
        }
      }
    }).make()
    const root = await mkdtemp(join(tmpdir(), 'kun-tws-cancel2-'))
    roots.push(root)
    const repo = join(root, 'repo')
    await initRepo(repo, { 'a.txt': 'a\n' })
    const record = service.create(input(repo))
    await vi.waitFor(() => {
      if (!setupStarted.mock.calls.length) throw new Error('setup not started')
    }, { timeout: 15_000, interval: 10 })
    service.cancel(record.workspaceId)
    const done = await waitState(service, record.workspaceId, ['failed'])
    expect(done.lastError).toBe('cancelled')
    await expect(stat(done.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('marks in-flight records failed on restart and retries them', async () => {
    const { make } = harness()
    const first = await make()
    const root = await mkdtemp(join(tmpdir(), 'kun-tws-restart-'))
    roots.push(root)
    const repo = join(root, 'repo')
    await initRepo(repo, { 'a.txt': 'a\n' })
    // Simulate a record stranded mid-create by a crashed process.
    const stranded = first.store.insert({
      workspaceId: 'tws_stranded01',
      ownerThreadId: 'thread-1',
      isolation: 'worktree',
      sourceRoot: repo,
      path: repo,
      startFrom: { kind: 'current-head' },
      state: 'creating',
      setup: { status: 'pending' },
      changedFiles: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
    expect(first.service.recoverInterrupted()).toBe(1)
    expect(first.store.get(stranded.workspaceId)?.state).toBe('failed')
    first.service.retry(stranded.workspaceId)
    const done = await waitState(first.service, stranded.workspaceId, ['ready', 'failed'])
    expect(done.state).toBe('ready')
  })

  it('emits a task_workspace event per progress step', async () => {
    const { make, drafts } = harness()
    const { service } = await make()
    const root = await mkdtemp(join(tmpdir(), 'kun-tws-events-'))
    roots.push(root)
    const repo = join(root, 'repo')
    await initRepo(repo, { 'a.txt': 'a\n' })
    const record = service.create(input(repo))
    await waitState(service, record.workspaceId, ['ready', 'failed'])
    const events = drafts.filter((draft) => draft.kind === 'task_workspace')
    expect(events.length).toBeGreaterThanOrEqual(3)
    for (const event of events) {
      expect(event.threadId).toBe('thread-1')
      if (event.kind === 'task_workspace') {
        expect(event.taskWorkspace.workspaceId).toBe(record.workspaceId)
      }
    }
    const last = events.at(-1)
    expect(last?.kind === 'task_workspace' && last.taskWorkspace.state).toBe('ready')
  })

  it('marks unapproved declared setup as not-approved and still ready', async () => {
    const { service } = await harness({
      projectConfig: async () => ({
        worktree: {
          sharedDirectories: [], copyFiles: [],
          setup: [{ name: 'install', command: 'bun', args: ['install'], timeoutMs: 5_000 }],
          branchPrefix: 'kun/'
        }
      }),
      // No approvedSetup grant: declared steps stay unapproved.
      approvedSetup: async () => []
    }).make()
    const root = await mkdtemp(join(tmpdir(), 'kun-tws-unapproved-'))
    roots.push(root)
    const repo = join(root, 'repo')
    await initRepo(repo, { 'a.txt': 'a\n' })
    const record = service.create(input(repo))
    const done = await waitState(service, record.workspaceId, ['ready', 'failed'])
    expect(done.state).toBe('ready')
    expect(done.setup.status).toBe('not-approved')
  })

  it('markReady rescues a failed setup record', async () => {
    const { service } = await harness({
      projectConfig: async () => ({
        worktree: {
          sharedDirectories: [], copyFiles: [],
          setup: [{ name: 'boom', command: 'false', args: [], timeoutMs: 5_000 }],
          branchPrefix: 'kun/'
        }
      }),
      approvedSetup: async () => [{ name: 'boom', command: 'false', args: [], timeoutMs: 5_000 }],
      setupRunner: { run: async () => ({ status: 'failed' as const }) }
    }).make()
    const root = await mkdtemp(join(tmpdir(), 'kun-tws-markready-'))
    roots.push(root)
    const repo = join(root, 'repo')
    await initRepo(repo, { 'a.txt': 'a\n' })
    const record = service.create(input(repo))
    const failed = await waitState(service, record.workspaceId, ['failed'])
    expect(failed.setup.status).toBe('failed')
    const ready = service.markReady(record.workspaceId)
    expect(ready.state).toBe('ready')
  })
})
