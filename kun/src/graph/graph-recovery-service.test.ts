import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileArtifactStore } from '../artifacts/artifact-store.js'
import { GRAPH_CONTRACT_VERSION, GraphNodeAttemptV1Schema } from '../contracts/graph.js'
import type { ChildRunRecord, DelegationRuntime } from '../delegation/delegation-runtime.js'
import { GraphControlService } from './graph-control-service.js'
import { GraphRecoveryService } from './graph-recovery-service.js'
import { FileGraphRunStore } from './graph-run-store.js'
import {
  testAssignmentSnapshot,
  testCompletedChild,
  testGraphConfig,
  testGraphPlan
} from './graph-test-fixtures.test-support.js'
import { FileGraphWriteCoordinator } from './graph-write-coordinator.js'
import { effectiveRunAttemptCount } from './graph-scheduler-policy.js'

const roots: string[] = []
const execFileAsync = promisify(execFile)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('GraphRecoveryService', () => {
  it('marks interrupted children orphaned, retries within budget, and records visible cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-recovery-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const config = testGraphConfig({
      scheduler: { maxAttemptsPerNode: 1 }
    })
    let id = 0
    const nextId = (prefix: string) => `${prefix}_${++id}`
    const store = new FileGraphRunStore({
      rootDir: join(root, 'graphs'),
      artifactStore: new FileArtifactStore(join(root, 'artifacts')),
      config: () => config,
      nextId
    })
    const control = new GraphControlService({ store, config: () => config, nextId })
    await control.create({
      runId: 'run_1',
      threadId: 'thread_1',
      projectId: 'project_1',
      sourceTurnId: 'turn_1',
	      plan: testGraphPlan({
	        workspaceRoot: workspace,
	        nodes: testGraphPlan().nodes.map((node) => ({
	          ...node,
	          maxAttempts: 1
	        })),
	        budget: {
	          ...testGraphPlan().budget,
	          maxAttemptsPerNode: 1
	        }
	      }),
      commandId: 'create_1',
      idempotencyKey: 'create_1',
      start: true
    })
    let run = (await store.get('run_1'))!
    run = (await store.append(run.id, {
      expectedSeq: run.lastEventSeq,
      graphRevision: run.currentRevision,
      commandId: 'ready_1',
      idempotencyKey: 'ready_1',
      event: {
        type: 'node_status_changed',
        payload: { nodeId: 'research', from: 'pending', to: 'ready' }
      }
    })).state
    const attempt = GraphNodeAttemptV1Schema.parse({
      version: GRAPH_CONTRACT_VERSION,
      id: 'attempt_1',
      runId: run.id,
      nodeId: 'research',
      revision: 1,
      attemptNumber: 1,
      iteration: 0,
      commandId: 'attempt_command_1',
      idempotencyKey: 'attempt_1',
      status: 'queued',
      assignment: {
        ...testAssignmentSnapshot(),
        workspaceRoot: workspace
      },
      childThreadId: 'child_1',
      queuedAt: new Date().toISOString(),
      tokenUsage: 0,
      elapsedMs: 0
    })
    run = (await store.append(run.id, {
      expectedSeq: run.lastEventSeq,
      graphRevision: run.currentRevision,
      commandId: 'attempt_created_1',
      idempotencyKey: 'attempt_created_1',
      event: { type: 'attempt_created', payload: { attempt } }
    })).state
    const signal = vi.fn()
    const delegation = {
      reconcileOrphanedChildRuns: vi.fn(async () => 1)
    } as unknown as DelegationRuntime
    const recovery = new GraphRecoveryService({
      store,
      config: () => config,
      writes: new FileGraphWriteCoordinator({
        rootDir: join(root, 'writes'),
        config: () => config,
        nextId
      }),
      delegation: () => delegation,
      supervision: () => ({ signal }),
      nextId
    })

    const report = await recovery.reconcile()
    const recovered = (await store.get('run_1'))!
    expect(report).toMatchObject({
      runsInspected: 1,
      orphanedAttempts: 1,
      retriedNodes: 1,
      orphanedChildRuns: 1
    })
    expect(recovered.nodes.research.status).toBe('ready')
    expect(recovered.nodes.research.attempts[0]?.status).toBe('orphaned')
    expect(effectiveRunAttemptCount(recovered)).toBe(0)
    expect(recovered.cleanup).toEqual([
      expect.objectContaining({
        resourceKind: 'worker',
        resourceId: 'child_1',
        state: 'orphaned'
      })
    ])
    expect(signal).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'recovery',
      nodeIds: ['research']
    }))
  })

  it('recovers a persisted completed child exactly once instead of orphaning it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-recovery-complete-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const config = testGraphConfig()
    let id = 0
    const nextId = (prefix: string) => `${prefix}_${++id}`
    const store = new FileGraphRunStore({
      rootDir: join(root, 'graphs'),
      artifactStore: new FileArtifactStore(join(root, 'artifacts')),
      config: () => config,
      nextId
    })
    const control = new GraphControlService({ store, config: () => config, nextId })
    await control.create({
      runId: 'run_completed_child',
      threadId: 'thread_1',
      projectId: 'project_1',
      sourceTurnId: 'turn_1',
      plan: testGraphPlan({ workspaceRoot: workspace }),
      commandId: 'create_completed_child',
      idempotencyKey: 'create_completed_child',
      start: true
    })
    let run = (await store.get('run_completed_child'))!
    run = (await store.append(run.id, {
      expectedSeq: run.lastEventSeq,
      graphRevision: run.currentRevision,
      commandId: 'ready_completed_child',
      idempotencyKey: 'ready_completed_child',
      event: {
        type: 'node_status_changed',
        payload: { nodeId: 'research', from: 'pending', to: 'ready' }
      }
    })).state
    const attempt = GraphNodeAttemptV1Schema.parse({
      version: GRAPH_CONTRACT_VERSION,
      id: 'attempt_completed_child',
      runId: run.id,
      nodeId: 'research',
      revision: 1,
      attemptNumber: 1,
      iteration: 0,
      commandId: 'attempt_completed_child',
      idempotencyKey: 'attempt_completed_child',
      status: 'queued',
      assignment: {
        ...testAssignmentSnapshot(),
        workspaceRoot: workspace
      },
      childThreadId: 'child_completed',
      queuedAt: new Date().toISOString(),
      tokenUsage: 0,
      elapsedMs: 0
    })
    run = (await store.append(run.id, {
      expectedSeq: run.lastEventSeq,
      graphRevision: run.currentRevision,
      commandId: 'attempt_created_completed',
      idempotencyKey: 'attempt_created_completed',
      event: { type: 'attempt_created', payload: { attempt } }
    })).state
    const child = {
      id: 'child_completed',
      parentThreadId: 'thread_1',
      parentTurnId: 'turn_1',
      prompt: 'bounded',
      status: 'completed',
      summary: '审'.repeat(4_311),
      evidence: undefined,
      usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
      durationMs: 25,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      returnFormat: 'summary'
    } as ChildRunRecord
    const delegation = {
      reconcileOrphanedChildRuns: vi.fn(async () => 0),
      diagnostics: vi.fn(async () => ({
        enabled: true,
        active: 0,
        childRuns: [child],
        aggregates: []
      }))
    } as unknown as DelegationRuntime
    const recovery = new GraphRecoveryService({
      store,
      config: () => config,
      writes: new FileGraphWriteCoordinator({
        rootDir: join(root, 'writes'),
        config: () => config,
        nextId
      }),
      delegation: () => delegation,
      nextId
    })

    const first = await recovery.reconcile()
    const recovered = (await store.get(run.id))!
    expect(first).toMatchObject({
      completedChildrenRecovered: 1,
      orphanedAttempts: 0
    })
    expect(recovered.nodes.research.status).toBe('submitted')
    expect(recovered.nodes.research.attempts[0]).toMatchObject({
      status: 'submitted',
      tokenUsage: 12,
      elapsedMs: 25
    })
    expect(recovered.nodes.research.attempts[0]?.result?.summary).toHaveLength(4_096)
    expect(recovered.nodes.research.attempts[0]?.result?.evidence[0]).toHaveLength(4_096)
    expect(recovered.budget.totalTokens).toBe(12)

    const recoveredSeq = recovered.lastEventSeq
    const second = await recovery.reconcile()
    expect(second.completedChildrenRecovered).toBe(0)
    expect((await store.get(run.id))?.lastEventSeq).toBe(recoveredSeq)
  })

  it('uses the live Host finalizer to recover files and verified checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-recovery-finalize-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'base.txt'), 'base\n')
    await git(workspace, ['init'])
    await git(workspace, ['config', 'user.email', 'graph-test@example.test'])
    await git(workspace, ['config', 'user.name', 'Graph Test'])
    await git(workspace, ['add', '.'])
    await git(workspace, ['commit', '-m', 'test: base'])
    const config = testGraphConfig({
      writeIsolation: { mode: 'serialize', allowWorktrees: false }
    })
    let id = 0
    const nextId = (prefix: string) => `${prefix}_${++id}`
    const store = new FileGraphRunStore({
      rootDir: join(root, 'graphs'),
      artifactStore: new FileArtifactStore(join(root, 'artifacts')),
      config: () => config,
      nextId
    })
    const base = testGraphPlan()
    const source = base.nodes[0]!
    if (source.assignment?.kind !== 'ephemeral') {
      throw new Error('expected ephemeral test assignment')
    }
    const writableSource = {
      ...source,
      assignment: { ...source.assignment, toolPolicy: 'inherit' as const },
      completion: {
        ...source.completion,
        requiredResultFields: ['summary' as const],
        review: {
          ...source.completion.review,
          deterministicChecks: ['verification']
        }
      },
      readScopes: ['.'],
      writeScopes: ['src']
    }
    const control = new GraphControlService({ store, config: () => config, nextId })
    await control.create({
      runId: 'run_recovery_finalize',
      threadId: 'thread_1',
      projectId: 'project_1',
      sourceTurnId: 'turn_1',
      plan: testGraphPlan({
        workspaceRoot: workspace,
        nodes: [writableSource],
        edges: [],
        completionNodeIds: [writableSource.id]
      }),
      commandId: 'create_recovery_finalize',
      idempotencyKey: 'create_recovery_finalize',
      start: true
    })
    let run = (await store.get('run_recovery_finalize'))!
    run = (await store.append(run.id, {
      expectedSeq: run.lastEventSeq,
      graphRevision: run.currentRevision,
      commandId: 'ready_recovery_finalize',
      idempotencyKey: 'ready_recovery_finalize',
      event: {
        type: 'node_status_changed',
        payload: { nodeId: writableSource.id, from: 'pending', to: 'ready' }
      }
    })).state
    const writes = new FileGraphWriteCoordinator({
      rootDir: join(root, 'writes'),
      config: () => config,
      nextId
    })
    const claim = await writes.acquire({
      runId: run.id,
      nodeId: writableSource.id,
      attemptId: 'attempt_recovery_finalize',
      workspaceRoot: workspace,
      scopes: ['src']
    })
    if (!claim.acquired) throw new Error('expected write claim')
    const attempt = GraphNodeAttemptV1Schema.parse({
      version: GRAPH_CONTRACT_VERSION,
      id: 'attempt_recovery_finalize',
      runId: run.id,
      nodeId: writableSource.id,
      revision: run.currentRevision,
      attemptNumber: 1,
      iteration: 0,
      commandId: 'attempt_recovery_finalize',
      idempotencyKey: 'attempt_recovery_finalize',
      status: 'queued',
      assignment: {
        ...testAssignmentSnapshot(),
        workspaceRoot: claim.workspaceRoot,
        readScopes: ['.'],
        writeScopes: ['src'],
        toolPolicy: 'inherit',
        sandboxMode: 'workspace-write'
      },
      childThreadId: 'child_recovery_finalize',
      queuedAt: new Date().toISOString(),
      tokenUsage: 0,
      elapsedMs: 0
    })
    await store.append(run.id, {
      expectedSeq: run.lastEventSeq,
      graphRevision: run.currentRevision,
      commandId: 'persist_recovery_finalize',
      idempotencyKey: 'persist_recovery_finalize',
      event: { type: 'attempt_created', payload: { attempt } }
    })
    await writeFile(join(workspace, 'src', 'result.txt'), 'worker result\n')
    const child = testCompletedChild('child_recovery_finalize', 'Recovered result.')
    const delegation = {
      reconcileOrphanedChildRuns: vi.fn(async () => 0),
      diagnostics: vi.fn(async () => ({
        enabled: true,
        active: 0,
        childRuns: [child],
        aggregates: []
      }))
    } as unknown as DelegationRuntime
    const verifyChecks = vi.fn(async () => [{
      name: 'verification',
      status: 'passed' as const,
      summary: 'Host verification passed.',
      artifactRefs: [],
      command: ['git', 'diff', '--check', 'HEAD'],
      exitCode: 0,
      workspaceRevision: 'test-revision',
      outputSummary: 'No output.'
    }])
    const recovery = new GraphRecoveryService({
      store,
      config: () => config,
      writes,
      delegation: () => delegation,
      verifyChecks,
      nextId
    })

    await recovery.reconcile()
    const recovered = (await store.get(run.id))!
    const recoveredAttempt = recovered.nodes.research.attempts[0]!
    expect(verifyChecks).toHaveBeenCalledOnce()
    expect(recoveredAttempt.result).toMatchObject({
      changedFiles: ['src/result.txt'],
      verifiedChecks: [expect.objectContaining({
        name: 'verification',
        status: 'passed'
      })]
    })
    expect(recoveredAttempt.validation).toMatchObject({ valid: true })
    expect(recoveredAttempt.status).toBe('submitted')
  })

  it('preserves completing runs so the scheduler can resume finalization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-recovery-completing-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const config = testGraphConfig()
    let id = 0
    const nextId = (prefix: string) => `${prefix}_${++id}`
    const store = new FileGraphRunStore({
      rootDir: join(root, 'graphs'),
      artifactStore: new FileArtifactStore(join(root, 'artifacts')),
      config: () => config,
      nextId
    })
    const control = new GraphControlService({ store, config: () => config, nextId })
    const created = await control.create({
      runId: 'run_completing',
      threadId: 'thread_1',
      projectId: 'project_1',
      sourceTurnId: 'turn_1',
      plan: testGraphPlan({ workspaceRoot: workspace }),
      commandId: 'create_completing',
      idempotencyKey: 'create_completing',
      start: true
    })
    await store.append(created.run.id, {
      expectedSeq: created.run.lastEventSeq,
      graphRevision: created.run.currentRevision,
      commandId: 'enter_completing',
      idempotencyKey: 'enter_completing',
      event: {
        type: 'run_status_changed',
        payload: { from: 'running', to: 'completing' }
      }
    })
    const recovery = new GraphRecoveryService({
      store,
      config: () => config,
      writes: new FileGraphWriteCoordinator({
        rootDir: join(root, 'writes'),
        config: () => config,
        nextId
      }),
      delegation: () => undefined,
      nextId
    })
    const report = await recovery.reconcile()
    expect(report.pausedRuns).toBe(0)
    expect((await store.get('run_completing'))?.status).toBe('completing')
  })

  it('preserves explicit cancel intent when recovery sees a pausing cancellation fence', async () => {
    // Production path: GraphControlService.cancel fences running → pausing with
    // reason "cancellation dispatch fence", then finishes as cancelled. A crash
    // after the fence but before the final cancelled transition leaves durable
    // status=pausing. GraphRecoveryService.reconcile() must not demote that to
    // resumable paused (reliability audit P1 cancel/recovery).
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-recovery-cancel-fence-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const config = testGraphConfig()
    let id = 0
    const nextId = (prefix: string) => `${prefix}_${++id}`
    const store = new FileGraphRunStore({
      rootDir: join(root, 'graphs'),
      artifactStore: new FileArtifactStore(join(root, 'artifacts')),
      config: () => config,
      nextId
    })
    const control = new GraphControlService({
      store,
      config: () => config,
      nextId,
      cancelActive: async () => {
        throw new Error('simulated process death after cancel fence')
      }
    })
    await control.create({
      runId: 'run_cancel_fence',
      threadId: 'thread_cancel',
      projectId: 'project_1',
      sourceTurnId: 'turn_1',
      plan: testGraphPlan({ workspaceRoot: workspace }),
      commandId: 'create_cancel_fence',
      idempotencyKey: 'create_cancel_fence',
      start: true
    })
    let cancellable = (await store.get('run_cancel_fence'))!
    cancellable = (await store.append(cancellable.id, {
      expectedSeq: cancellable.lastEventSeq,
      graphRevision: cancellable.currentRevision,
      commandId: 'ready_cancel_fence',
      idempotencyKey: 'ready_cancel_fence',
      event: {
        type: 'node_status_changed',
        payload: { nodeId: 'research', from: 'pending', to: 'ready' }
      }
    })).state
    const activeAttempt = GraphNodeAttemptV1Schema.parse({
      version: GRAPH_CONTRACT_VERSION,
      id: 'attempt_cancel_fence',
      runId: cancellable.id,
      nodeId: 'research',
      revision: cancellable.currentRevision,
      attemptNumber: 1,
      iteration: 0,
      commandId: 'attempt_cancel_fence',
      idempotencyKey: 'attempt_cancel_fence',
      status: 'queued',
      assignment: {
        ...testAssignmentSnapshot(),
        workspaceRoot: workspace
      },
      childThreadId: 'child_cancel_fence',
      queuedAt: new Date().toISOString(),
      tokenUsage: 0,
      elapsedMs: 0
    })
    cancellable = (await store.append(cancellable.id, {
      expectedSeq: cancellable.lastEventSeq,
      graphRevision: cancellable.currentRevision,
      commandId: 'attempt_created_cancel_fence',
      idempotencyKey: 'attempt_created_cancel_fence',
      event: { type: 'attempt_created', payload: { attempt: activeAttempt } }
    })).state
    await expect(control.cancel('run_cancel_fence', {
      commandId: 'cancel_mid_crash',
      idempotencyKey: 'cancel_mid_crash',
      reason: 'user cancelled the Graph run'
    })).rejects.toThrow(/simulated process death after cancel fence/)

    const fenced = (await store.get('run_cancel_fence'))!
    expect(fenced.status).toBe('pausing')
    expect(fenced.nodes.research.status).toBe('queued')
    expect(fenced.nodes.research.attempts[0]?.status).toBe('queued')

    const signal = vi.fn(async () => undefined)
    const recovery = new GraphRecoveryService({
      store,
      config: () => config,
      writes: new FileGraphWriteCoordinator({
        rootDir: join(root, 'writes'),
        config: () => config,
        nextId
      }),
      delegation: () => undefined,
      supervision: () => ({ signal }),
      nextId
    })
    const report = await recovery.reconcile()
    const recovered = (await store.get('run_cancel_fence'))!

    // Cancelled work must not become resumable. Preferred terminal is cancelled;
    // at minimum recovery must not leave status=paused after an explicit cancel fence.
    expect(recovered.status).toBe('cancelled')
    expect(recovered.status).not.toBe('paused')
    expect(recovered.nodes.research.status).toBe('cancelled')
    expect(recovered.nodes.research.attempts[0]?.status).toBe('cancelled')
    expect(recovered.cleanup).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceKind: 'journal',
        resourceId: recovered.id,
        state: 'completed'
      })
    ]))
    expect(report.pausedRuns).toBe(0)
    expect(report.retriedNodes).toBe(0)
    expect(report.orphanedAttempts).toBe(0)
    expect(signal).toHaveBeenCalledOnce()
    expect(signal).toHaveBeenCalledWith({
      runId: recovered.id,
      reason: 'completion',
      nodeIds: [],
      digest: 'GraphRun cancellation completed after runtime restart.'
    })

    const recoveredSeq = recovered.lastEventSeq
    const second = await recovery.reconcile()
    expect(second.runsInspected).toBe(0)
    expect((await store.get(recovered.id))?.lastEventSeq).toBe(recoveredSeq)
  })

  it('still recovers an interrupted ordinary pause as resumable paused', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-recovery-pause-fence-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const config = testGraphConfig()
    let id = 0
    const nextId = (prefix: string) => `${prefix}_${++id}`
    const store = new FileGraphRunStore({
      rootDir: join(root, 'graphs'),
      artifactStore: new FileArtifactStore(join(root, 'artifacts')),
      config: () => config,
      nextId
    })
    const control = new GraphControlService({
      store,
      config: () => config,
      nextId,
      pauseActive: async () => {
        throw new Error('simulated process death after pause fence')
      }
    })
    await control.create({
      runId: 'run_pause_fence',
      threadId: 'thread_pause',
      projectId: 'project_1',
      sourceTurnId: 'turn_1',
      plan: testGraphPlan({ workspaceRoot: workspace }),
      commandId: 'create_pause_fence',
      idempotencyKey: 'create_pause_fence',
      start: true
    })
    await expect(control.pause('run_pause_fence', {
      commandId: 'pause_mid_crash',
      idempotencyKey: 'pause_mid_crash'
    })).rejects.toThrow(/simulated process death after pause fence/)
    expect((await store.get('run_pause_fence'))?.status).toBe('pausing')

    const recovery = new GraphRecoveryService({
      store,
      config: () => config,
      writes: new FileGraphWriteCoordinator({
        rootDir: join(root, 'writes'),
        config: () => config,
        nextId
      }),
      delegation: () => undefined,
      nextId
    })
    const report = await recovery.reconcile()

    expect((await store.get('run_pause_fence'))?.status).toBe('paused')
    expect(report.pausedRuns).toBe(1)
  })
})

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}
