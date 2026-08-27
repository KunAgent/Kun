import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { testGraphConfig } from './graph-test-fixtures.test-support.js'
import { FileGraphWriteCoordinator, scopesOverlap } from './graph-write-coordinator.js'

const roots: string[] = []
const execFileAsync = promisify(execFile)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('FileGraphWriteCoordinator', () => {
  it('serializes overlapping path claims but allows disjoint writers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-writes-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const config = testGraphConfig({ writeIsolation: { mode: 'lease' } })
    let id = 0
    const coordinator = new FileGraphWriteCoordinator({
      rootDir: join(root, 'state'),
      config: () => config,
      nextId: (prefix) => `${prefix}_${++id}`
    })
    const first = await coordinator.acquire({
      runId: 'run_1',
      nodeId: 'node_1',
      attemptId: 'attempt_1',
      workspaceRoot: workspace,
      scopes: ['src']
    })
    expect(first.acquired).toBe(true)
    const conflict = await coordinator.acquire({
      runId: 'run_1',
      nodeId: 'node_2',
      attemptId: 'attempt_2',
      workspaceRoot: workspace,
      scopes: ['src/generated']
    })
    expect(conflict).toMatchObject({ acquired: false })
    const disjoint = await coordinator.acquire({
      runId: 'run_1',
      nodeId: 'node_3',
      attemptId: 'attempt_3',
      workspaceRoot: workspace,
      scopes: ['tests']
    })
    expect(disjoint.acquired).toBe(true)
    expect(scopesOverlap(['src'], ['src/generated'])).toBe(true)
    expect(scopesOverlap(['src'], ['tests'])).toBe(false)
    expect(scopesOverlap(['src'], ['SRC/generated'], true)).toBe(true)
    expect(scopesOverlap(['src'], ['SRC/generated'], false)).toBe(false)
  })

  it('serializes every writer in serialize mode and treats dot as full workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-writes-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const config = testGraphConfig({ writeIsolation: { mode: 'serialize' } })
    const coordinator = new FileGraphWriteCoordinator({
      rootDir: join(root, 'state'),
      config: () => config
    })
    const first = await coordinator.acquire({
      runId: 'run_serialize',
      nodeId: 'node_src',
      attemptId: 'attempt_src',
      workspaceRoot: workspace,
      scopes: ['src']
    })
    expect(first.acquired).toBe(true)
    await expect(coordinator.acquire({
      runId: 'run_serialize',
      nodeId: 'node_tests',
      attemptId: 'attempt_tests',
      workspaceRoot: workspace,
      scopes: ['tests']
    })).resolves.toMatchObject({ acquired: false })
    expect(scopesOverlap(['.'], ['src/generated'])).toBe(true)
  })

  it('rejects traversal and recovers expired leases after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-writes-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    let now = '2026-07-26T00:00:00.000Z'
    const config = testGraphConfig({
      writeIsolation: { mode: 'lease', leaseTtlMs: 1_000 }
    })
    const coordinator = new FileGraphWriteCoordinator({
      rootDir: join(root, 'state'),
      config: () => config,
      nowIso: () => now
    })
    await expect(coordinator.acquire({
      runId: 'run_1',
      nodeId: 'node_1',
      attemptId: 'attempt_bad',
      workspaceRoot: workspace,
      scopes: ['../outside']
    })).rejects.toThrow('invalid Graph write scope')
    await coordinator.acquire({
      runId: 'run_1',
      nodeId: 'node_1',
      attemptId: 'attempt_1',
      workspaceRoot: workspace,
      scopes: ['src']
    })
    now = '2026-07-26T00:00:02.000Z'
    await expect(coordinator.reconcile()).resolves.toMatchObject({ expiredLeases: 1 })
    expect((await coordinator.list()).leases[0]?.state).toBe('expired')
  })

  it('renews active leases and refuses renewal after expiry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-writes-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    let now = '2026-07-26T00:00:00.000Z'
    const config = testGraphConfig({
      writeIsolation: { mode: 'lease', leaseTtlMs: 1_000 }
    })
    const coordinator = new FileGraphWriteCoordinator({
      rootDir: join(root, 'state'),
      config: () => config,
      nowIso: () => now
    })
    const claim = await coordinator.acquire({
      runId: 'run_renew',
      nodeId: 'node_renew',
      attemptId: 'attempt_renew',
      workspaceRoot: workspace,
      scopes: ['src']
    })
    if (!claim.acquired) throw new Error('expected lease claim')
    now = '2026-07-26T00:00:00.500Z'
    await expect(coordinator.renew(claim.lease.leaseId)).resolves.toMatchObject({
      expiresAt: '2026-07-26T00:00:01.500Z'
    })
    now = '2026-07-26T00:00:02.000Z'
    await expect(coordinator.renew(claim.lease.leaseId)).rejects.toThrow(/expired/)
  })

  it('persists an accepted release disposition for idempotent integration replay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-writes-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const coordinator = new FileGraphWriteCoordinator({
      rootDir: join(root, 'state'),
      config: () => testGraphConfig({ writeIsolation: { mode: 'lease' } })
    })
    const claim = await coordinator.acquire({
      runId: 'run_replay',
      nodeId: 'node_replay',
      attemptId: 'attempt_replay',
      workspaceRoot: workspace,
      scopes: []
    })
    if (!claim.acquired) throw new Error('expected lease claim')

    await expect(coordinator.release(claim.lease.leaseId, 'accepted')).resolves.toMatchObject({
      state: 'released',
      releaseDisposition: 'accepted'
    })
    await expect(coordinator.release(claim.lease.leaseId, 'failed')).resolves.toMatchObject({
      state: 'released',
      releaseDisposition: 'accepted'
    })
    expect((await coordinator.list()).leases[0]).toMatchObject({
      releaseDisposition: 'accepted'
    })
  })

  it('integrates disjoint parallel worktrees including new files and is idempotent', async () => {
    const { repository, coordinator } = await worktreeHarness()
    const first = await coordinator.acquire({
      runId: 'run_1',
      nodeId: 'node_src',
      attemptId: 'attempt_src',
      workspaceRoot: repository,
      scopes: ['src']
    })
    const second = await coordinator.acquire({
      runId: 'run_1',
      nodeId: 'node_tests',
      attemptId: 'attempt_tests',
      workspaceRoot: repository,
      scopes: ['tests']
    })
    expect(first.acquired && second.acquired).toBe(true)
    if (!first.acquired || !second.acquired) throw new Error('expected worktree claims')
    await writeFile(join(first.workspaceRoot, 'src', 'a.txt'), 'src changed\n')
    await writeFile(join(first.workspaceRoot, 'src', 'new.txt'), 'new src file\n')
    await writeFile(join(second.workspaceRoot, 'tests', 'b.txt'), 'tests changed\n')
    await writeFile(join(second.workspaceRoot, 'tests', 'new.txt'), 'new test file\n')

    await expect(coordinator.captureWorktree('attempt_src')).resolves.toMatchObject({
      changedFiles: ['src/a.txt', 'src/new.txt']
    })
    await expect(coordinator.captureWorktree('attempt_tests')).resolves.toMatchObject({
      changedFiles: ['tests/b.txt', 'tests/new.txt']
    })
    await expect(coordinator.integrate('attempt_src')).resolves.toMatchObject({ outcome: 'applied' })
    await expect(coordinator.integrate('attempt_tests')).resolves.toMatchObject({ outcome: 'applied' })
    await expect(coordinator.integrate('attempt_src')).resolves.toMatchObject({ outcome: 'applied' })
    await expect(coordinator.cleanupRun('run_1')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceKind: 'worktree', state: 'completed' })
    ]))

    expect(normalizeLineEndings(await readFile(join(repository, 'src', 'new.txt'), 'utf8')))
      .toBe('new src file\n')
    expect(normalizeLineEndings(await readFile(join(repository, 'tests', 'new.txt'), 'utf8')))
      .toBe('new test file\n')
    await expect(stat(first.workspaceRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('integrates beside disjoint user changes without altering their content or staging', async () => {
    const { repository, coordinator } = await worktreeHarness()
    await writeFile(join(repository, 'tests', 'b.txt'), 'user unstaged change\n')
    await writeFile(join(repository, 'tests', 'staged.txt'), 'user staged file\n')
    await writeFile(join(repository, 'tests', 'untracked.txt'), 'user untracked file\n')
    await git(repository, ['add', 'tests/staged.txt'])
    const claim = await coordinator.acquire({
      runId: 'run_dirty_disjoint',
      nodeId: 'node_src',
      attemptId: 'attempt_dirty_disjoint',
      workspaceRoot: repository,
      scopes: ['src']
    })
    if (!claim.acquired) throw new Error('expected worktree claim')
    await writeFile(join(claim.workspaceRoot, 'src', 'a.txt'), 'graph change\n')
    await writeFile(join(claim.workspaceRoot, 'src', 'new.txt'), 'graph new file\n')

    await expect(coordinator.integrate('attempt_dirty_disjoint')).resolves.toMatchObject({
      outcome: 'applied'
    })

    expect(await readFile(join(repository, 'tests', 'b.txt'), 'utf8')).toBe('user unstaged change\n')
    expect(await readFile(join(repository, 'tests', 'staged.txt'), 'utf8')).toBe('user staged file\n')
    expect(await readFile(join(repository, 'tests', 'untracked.txt'), 'utf8')).toBe('user untracked file\n')
    expect(await gitOutput(repository, ['diff', '--name-only'])).toBe('tests/b.txt\n')
    expect(await gitOutput(repository, ['diff', '--cached', '--name-only'])).toBe([
      'src/a.txt',
      'src/new.txt',
      'tests/staged.txt',
      ''
    ].join('\n'))
    expect(await gitOutput(repository, ['ls-files', '--others', '--exclude-standard']))
      .toBe('tests/untracked.txt\n')
  })

  it('still requires human resolution when user changes overlap the Graph patch', async () => {
    const { repository, coordinator } = await worktreeHarness()
    const claim = await coordinator.acquire({
      runId: 'run_dirty_overlap',
      nodeId: 'node_src',
      attemptId: 'attempt_dirty_overlap',
      workspaceRoot: repository,
      scopes: ['src']
    })
    if (!claim.acquired) throw new Error('expected worktree claim')
    await writeFile(join(claim.workspaceRoot, 'src', 'a.txt'), 'graph change\n')
    await writeFile(join(repository, 'src', 'a.txt'), 'user overlapping change\n')

    await expect(coordinator.integrate('attempt_dirty_overlap')).resolves.toMatchObject({
      outcome: 'needs_human',
      reason: expect.stringContaining('uncommitted changes overlapping Graph patch: src/a.txt')
    })
    expect(await readFile(join(repository, 'src', 'a.txt'), 'utf8'))
      .toBe('user overlapping change\n')
    expect(await gitOutput(repository, ['diff', '--cached', '--name-only'])).toBe('')
  })

  it('allocates overlapping worktree writers into distinct isolated workspaces', async () => {
    const { repository, coordinator } = await worktreeHarness()
    const first = await coordinator.acquire({
      runId: 'run_overlap',
      nodeId: 'node_first',
      attemptId: 'attempt_first',
      workspaceRoot: repository,
      scopes: ['src']
    })
    const second = await coordinator.acquire({
      runId: 'run_overlap',
      nodeId: 'node_second',
      attemptId: 'attempt_second',
      workspaceRoot: repository,
      scopes: ['src/a.txt']
    })
    expect(first.acquired && second.acquired).toBe(true)
    if (!first.acquired || !second.acquired) throw new Error('expected isolated worktrees')
    expect(first.workspaceRoot).not.toBe(second.workspaceRoot)
  })

  it('refuses to integrate a worktree that writes outside its frozen scope', async () => {
    const { repository, coordinator } = await worktreeHarness()
    const claim = await coordinator.acquire({
      runId: 'run_1',
      nodeId: 'node_src',
      attemptId: 'attempt_scoped',
      workspaceRoot: repository,
      scopes: ['src']
    })
    if (!claim.acquired) throw new Error('expected worktree claim')
    await mkdir(join(claim.workspaceRoot, 'other'), { recursive: true })
    await writeFile(join(claim.workspaceRoot, 'other', 'escape.txt'), 'blocked\n')
    await expect(coordinator.captureChangedFiles('attempt_scoped')).resolves.toEqual({
      status: 'observed',
      changedFiles: ['other/escape.txt']
    })
    expect((await coordinator.list()).worktrees[0]).toMatchObject({
      state: 'conflict',
      lastError: expect.stringContaining('outside its frozen write scope')
    })
    await expect(coordinator.integrate('attempt_scoped')).resolves.toMatchObject({
      outcome: 'needs_human',
      reason: expect.stringContaining('outside its frozen write scope')
    })
    await expect(readFile(join(repository, 'other', 'escape.txt'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(coordinator.cleanupRun('run_1')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceKind: 'worktree', state: 'preserved' })
    ]))
    await expect(stat(claim.workspaceRoot)).resolves.toBeTruthy()
  })

  it('removes a pristine claim when durable attempt admission fails', async () => {
    const { coordinator, repository } = await worktreeHarness()
    const claim = await coordinator.acquire({
      runId: 'run_rollback',
      nodeId: 'node_rollback',
      attemptId: 'attempt_rollback',
      workspaceRoot: repository,
      scopes: ['src']
    })
    if (!claim.acquired || !claim.worktree) throw new Error('expected worktree claim')
    await coordinator.rollback(claim.lease.leaseId)
    const state = await coordinator.list()
    expect(state.leases.find((lease) => lease.leaseId === claim.lease.leaseId)?.state)
      .toBe('released')
    expect(state.worktrees.find((worktree) =>
      worktree.worktreeId === claim.worktree!.worktreeId)?.state).toBe('cleaned')
    await expect(stat(claim.workspaceRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('observes direct-workspace changes without blaming untouched pre-existing dirt', async () => {
    const { root, repository } = await worktreeHarness()
    await writeFile(join(repository, 'tests', 'b.txt'), 'user change before worker\n')
    const config = testGraphConfig({
      writeIsolation: { mode: 'serialize', allowWorktrees: false }
    })
    const coordinator = new FileGraphWriteCoordinator({
      rootDir: join(root, 'direct-state'),
      config: () => config
    })
    const claim = await coordinator.acquire({
      runId: 'run_direct',
      nodeId: 'node_direct',
      attemptId: 'attempt_direct',
      workspaceRoot: repository,
      scopes: ['src']
    })
    if (!claim.acquired) throw new Error('expected direct workspace claim')

    await writeFile(join(repository, 'src', 'a.txt'), 'worker change\n')
    await writeFile(join(repository, 'src', 'new.txt'), 'worker new file\n')

    await expect(coordinator.captureChangedFiles('attempt_direct')).resolves.toEqual({
      status: 'observed',
      changedFiles: ['src/a.txt', 'src/new.txt']
    })
  })

  it('persists an unavailable direct-workspace baseline instead of trusting worker claims', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-writes-baseline-'))
    roots.push(root)
    const workspace = join(root, 'not-a-repository')
    await mkdir(workspace)
    const config = testGraphConfig({
      writeIsolation: { mode: 'serialize', allowWorktrees: false }
    })
    const coordinator = new FileGraphWriteCoordinator({
      rootDir: join(root, 'state'),
      config: () => config
    })
    const claim = await coordinator.acquire({
      runId: 'run_baseline',
      nodeId: 'node_baseline',
      attemptId: 'attempt_baseline',
      workspaceRoot: workspace,
      scopes: ['src']
    })
    if (!claim.acquired) throw new Error('expected direct workspace claim')

    expect(claim.lease.baselineError).toBeTruthy()
    await expect(coordinator.captureChangedFiles('attempt_baseline')).resolves.toMatchObject({
      status: 'unavailable',
      error: expect.stringContaining('status --porcelain=v1')
    })
  })
})

function normalizeLineEndings(value: string): string {
  return value.replaceAll('\r\n', '\n')
}

async function worktreeHarness() {
  const root = await mkdtemp(join(tmpdir(), 'kun-graph-worktree-'))
  roots.push(root)
  const repository = join(root, 'repo')
  await mkdir(join(repository, 'src'), { recursive: true })
  await mkdir(join(repository, 'tests'), { recursive: true })
  await writeFile(join(repository, 'src', 'a.txt'), 'src base\n')
  await writeFile(join(repository, 'tests', 'b.txt'), 'tests base\n')
  await git(repository, ['init'])
  await git(repository, ['config', 'user.email', 'graph-test@example.test'])
  await git(repository, ['config', 'user.name', 'Graph Test'])
  await git(repository, ['add', '.'])
  await git(repository, ['commit', '-m', 'test: base'])
  const config = testGraphConfig({
    writeIsolation: { mode: 'worktree', allowWorktrees: true }
  })
  let id = 0
  return {
    root,
    repository,
    coordinator: new FileGraphWriteCoordinator({
      rootDir: join(root, 'state'),
      config: () => config,
      nextId: (prefix) => `${prefix}_${++id}`
    })
  }
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' })).stdout
}
