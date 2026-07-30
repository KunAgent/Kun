import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileArtifactStore } from '../artifacts/artifact-store.js'
import { GRAPH_CONTRACT_VERSION, GraphPlanV1Schema } from '../contracts/graph.js'
import type {
  ChildRunRecord,
  ChildSecuritySnapshot,
  DelegationRuntime
} from '../delegation/delegation-runtime.js'
import { GraphAssignmentResolver } from './graph-assignment.js'
import { GraphControlService } from './graph-control-service.js'
import { FileGraphRunStore } from './graph-run-store.js'
import { GraphMailbox } from './graph-mailbox.js'
import { GraphScheduler } from './graph-scheduler.js'
import { GraphWorkerSessionRegistry } from './graph-worker-sessions.js'
import { FileGraphWriteCoordinator } from './graph-write-coordinator.js'
import { FileProjectAgentRegistry } from './project-agent-registry.js'
import {
  testCompletedChild,
  testGraphConfig,
  testGraphPlan
} from './graph-test-fixtures.test-support.js'
import {
  autoLeadSupervision,
  cleanupSchedulerHarnesses,
  rejectWhenAborted,
  schedulerHarness,
  schedulerTestRoots as roots,
  waitFor
} from '../../tests/graph-scheduler-test-harness.js'
afterEach(cleanupSchedulerHarnesses)
describe('GraphScheduler', () => {
  it('completes regardless of a legacy Graph token ceiling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-scheduler-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(workspace, 'src'), { recursive: true })
    const config = testGraphConfig({
      supervision: { requireFinalReview: false },
      writeIsolation: { mode: 'lease' }
    })
    let id = 0
    const nextId = (prefix: string) => `${prefix}_${++id}`
    const artifacts = new FileArtifactStore(join(root, 'artifacts'))
    const store = new FileGraphRunStore({
      rootDir: join(root, 'graphs'),
      config: () => config,
      artifactStore: artifacts,
      nextId
    })
    const control = new GraphControlService({ store, config: () => config, nextId })
    const registry = new FileProjectAgentRegistry({
      rootDir: join(root, 'agents'),
      config: () => config,
      nextId
    })
    const mailbox = new GraphMailbox({ store, config: () => config })
    const writes = new FileGraphWriteCoordinator({
      rootDir: join(root, 'resources'),
      config: () => config,
      artifactStore: artifacts,
      nextId
    })
    const sessions = new GraphWorkerSessionRegistry()
    const childSecurity: ChildSecuritySnapshot[] = []
    const fakeDelegation = {
      enabled: () => true,
      runChild: async (input: {
        onQueued?: (id: string) => Promise<void> | void
        onRunning?: (id: string) => Promise<void> | void
        security?: ChildSecuritySnapshot
      }) => {
        if (input.security) childSecurity.push(input.security)
        const childId = nextId('child')
        await input.onQueued?.(childId)
        await input.onRunning?.(childId)
        return {
          id: childId,
          status: 'completed',
          summary: JSON.stringify({
            summary: 'Verified node output.',
            changedFiles: [],
            checks: [{ name: 'verification', status: 'passed', summary: 'Passed.' }],
            evidence: ['Inspected relevant source.'],
            risks: []
          }),
          evidence: ['Inspected relevant source.'],
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          durationMs: 5
        } as ChildRunRecord
      }
    } as unknown as DelegationRuntime
    const identity = await registry.identify(workspace)
    await control.create({
      runId: 'run_1',
      threadId: 'thread_1',
      projectId: identity.projectId,
      sourceTurnId: 'turn_1',
      plan: GraphPlanV1Schema.parse({
        ...testGraphPlan({ workspaceRoot: workspace, autoStart: true }),
        budget: {
          ...testGraphPlan().budget,
          maxTotalTokens: 1
        }
      }),
      commandId: 'command_create',
      idempotencyKey: 'create_1',
      start: true
    })
    await control.steer('run_1', {
      version: GRAPH_CONTRACT_VERSION,
      steeringId: 'steering_research',
      runId: 'run_1',
      target: { kind: 'node', nodeId: 'research' },
      text: 'Verify the relevant source before returning.',
      status: 'persisted',
      createdAt: new Date().toISOString()
    }, {
      commandId: 'command_steer',
      idempotencyKey: 'steer_research'
    })
    const scheduler = new GraphScheduler({
      store,
      config: () => config,
      delegation: () => fakeDelegation,
      registry,
      assignments: new GraphAssignmentResolver({ registry }),
      mailbox,
      writes,
      workerSessions: sessions,
      authorityForRun: () => ({
        workspaceRoot: workspace,
        model: 'test-model',
        providerId: 'test-provider',
        reasoningEffort: 'off',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        allowedTools: ['read', 'grep', 'graph_worker_progress', 'graph_worker_submit_result'],
        blockedTools: [],
        allowedSkills: ['safe-skill'],
        blockedSkills: [],
        allowedMcpServers: [],
        blockedMcpServers: [],
        readScopes: ['.'],
        writeScopes: ['.'],
        networkAllowed: false
      }),
      artifactStore: artifacts,
      supervision: () => autoLeadSupervision(store, control, nextId),
      nextId,
      tickIntervalMs: 5
    })
    scheduler.start()
    const completed = await waitFor(async () => {
      const run = await store.get('run_1')
      return run?.status === 'completed' ? run : null
    })
    await scheduler.stop()
    expect(completed.status).toBe('completed')
    expect(completed.nodes.research.status).toBe('accepted')
    expect(completed.nodes.finish.status).toBe('accepted')
    expect(completed.summary?.finalAnswer).toContain('Verified node output')
    expect(completed.budget.totalTokens).toBe(40)
    expect(childSecurity).not.toHaveLength(0)
    expect(childSecurity.every((security) =>
      security.allowedProviderIds?.length === 0 &&
      security.allowedModelProviderIds?.join(',') === 'test-provider' &&
      security.allowedModelIds?.join(',') === 'test-model' &&
      security.allowedSkillIds?.join(',') === 'safe-skill' &&
      security.blockedProviderIds?.includes('imageGen') === true &&
      security.blockedProviderIds?.includes('videoGen') === true
    )).toBe(true)
    expect(completed.steering).toEqual(expect.arrayContaining([
      expect.objectContaining({
        steeringId: 'steering_research',
        status: 'handled'
      })
    ]))
    expect(completed.cleanup).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceKind: 'journal',
        resourceId: 'run_1',
        state: 'completed'
      })
    ]))
  }, 15_000)

  it('allows the final admitted attempt to finish at the global attempt limit', async () => {
    const source: ReturnType<typeof testGraphPlan>['nodes'][number] = {
      ...testGraphPlan().nodes[0]!,
      maxAttempts: 1
    }
    const plan = testGraphPlan({
      nodes: [source],
      edges: [],
      budget: {
        ...testGraphPlan().budget,
        maxAttemptsPerNode: 1
      },
      completionNodeIds: [source.id],
      autoStart: true
    })
    let returnFormat: string | undefined
    const delegation = {
      enabled: () => true,
      runChild: async (input: {
        onQueued?: (id: string) => Promise<void> | void
        onRunning?: (id: string) => Promise<void> | void
        signal?: AbortSignal
        returnFormat?: string
      }) => {
        returnFormat = input.returnFormat
        await input.onQueued?.('child_final_attempt')
        await input.onRunning?.('child_final_attempt')
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 50)
          input.signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(input.signal?.reason ?? new Error('aborted'))
          }, { once: true })
        })
        return testCompletedChild('child_final_attempt', 'PASS')
      }
    } as unknown as DelegationRuntime
    const harness = await schedulerHarness(plan, () => delegation)
    harness.scheduler.start()
    const completed = await waitFor(async () => {
      const run = await harness.store.get('run_harness')
      return run?.status === 'completed' ? run : null
    })

    expect(completed.budget.attempts).toBe(1)
    expect(returnFormat).toBe('summary')
    expect(completed.nodes.research.status).toBe('accepted')
    expect(completed.nodes.research.attempts[0]?.status).toBe('accepted')
    await harness.scheduler.stop()
  }, 15_000)

  it('resumes an awaiting-human run after a durable user review', async () => {
    const source = testGraphPlan().nodes[0]!
    const plan = testGraphPlan({
      nodes: [{
        ...source,
        completion: {
          ...source.completion,
          review: {
            kinds: ['human'],
            requireAll: true,
            deterministicChecks: [],
            humanReason: 'User acceptance is required.'
          }
        }
      }],
      edges: [],
      completionNodeIds: [source.id],
      autoStart: true
    })
    const fakeDelegation = {
      enabled: () => true,
      runChild: async (input: {
        onQueued?: (id: string) => Promise<void> | void
        onRunning?: (id: string) => Promise<void> | void
      }) => {
        await input.onQueued?.('child_human')
        await input.onRunning?.('child_human')
        return testCompletedChild('child_human', 'Result awaiting user acceptance.')
      }
    } as unknown as DelegationRuntime
    const harness = await schedulerHarness(plan, () => fakeDelegation, {
      writeIsolation: { leaseTtlMs: 1_000 }
    })
    harness.scheduler.start()
    const waiting = await waitFor(async () => {
      const run = await harness.store.get('run_harness')
      return run?.status === 'awaiting_human' ? run : null
    })
    const attempt = waiting.nodes.research.attempts.at(-1)!
    const initialLease = (await harness.writes.list()).leases.find((entry) =>
      entry.attemptId === attempt.id)
    expect(initialLease?.state).toBe('active')
    const initialExpiresAt = Date.parse(initialLease!.expiresAt)
    const renewedLease = await waitFor(async () => {
      const lease = (await harness.writes.list()).leases.find((entry) =>
        entry.attemptId === attempt.id)
      return lease?.state === 'active' &&
        Date.parse(lease.expiresAt) > initialExpiresAt
        ? lease
        : null
    })
    expect(Date.parse(renewedLease.expiresAt)).toBeGreaterThan(initialExpiresAt)
    await harness.control.recordReview('run_harness', {
      version: 1,
      reviewId: 'human_review_1',
      nodeId: 'research',
      attemptId: attempt.id,
      reviewerKind: 'human',
      outcome: 'pass',
      summary: 'Approved by user.',
      evidence: [],
      artifactRefs: [],
      createdAt: new Date().toISOString()
    }, {
      commandId: 'human_review_command',
      idempotencyKey: 'human_review_command',
      expectedSeq: waiting.lastEventSeq,
      expectedRevision: waiting.currentRevision
    })
    const immediatelyAdvanced = await harness.store.get('run_harness')
    expect(immediatelyAdvanced?.status).not.toBe('awaiting_human')
    expect(immediatelyAdvanced?.nodes.research.status).toBe('accepted')
    const completed = await waitFor(async () => {
      const run = await harness.store.get('run_harness')
      return run?.status === 'completed' ? run : null
    })
    await harness.scheduler.stop()
    expect(completed.nodes.research.status).toBe('accepted')
  }, 15_000)

  it('still requires the source Lead when evidence review uses any-pass policy', async () => {
    const source = testGraphPlan().nodes[0]!
    const plan = testGraphPlan({
      nodes: [{
        ...source,
        completion: {
          ...source.completion,
          review: {
            kinds: ['deterministic', 'lead'],
            requireAll: false,
            deterministicChecks: []
          }
        }
      }],
      edges: [],
      completionNodeIds: [source.id],
      autoStart: true
    })
    const delegation = {
      enabled: () => true,
      runChild: async (input: {
        onQueued?: (id: string) => Promise<void> | void
        onRunning?: (id: string) => Promise<void> | void
      }) => {
        await input.onQueued?.('child_any_review')
        await input.onRunning?.('child_any_review')
        return testCompletedChild('child_any_review', 'Deterministic evidence is sufficient.')
      }
    } as unknown as DelegationRuntime
    const harness = await schedulerHarness(plan, () => delegation)
    harness.scheduler.start()
    const completed = await waitFor(async () => {
      const run = await harness.store.get('run_harness')
      return run?.status === 'completed' ? run : null
    })
    expect(completed.nodes.research.status).toBe('accepted')
    expect(completed.reviews.map((review) => review.reviewerKind)).toEqual(
      expect.arrayContaining(['deterministic', 'lead'])
    )
    await harness.scheduler.stop()
  }, 15_000)

  it('awaits supervision once when delegation is unavailable instead of producing an event storm', async () => {
    let available = false
    const delegation = {
      enabled: () => available,
      runChild: async (input: {
        onQueued?: (id: string) => Promise<void> | void
        onRunning?: (id: string) => Promise<void> | void
      }) => {
        await input.onQueued?.('child_recovered_runtime')
        await input.onRunning?.('child_recovered_runtime')
        return testCompletedChild(
          'child_recovered_runtime',
          'Completed after the subagent runtime recovered.'
        )
      }
    } as unknown as DelegationRuntime
    const harness = await schedulerHarness(
      testGraphPlan({ autoStart: true }),
      () => delegation
    )
    await harness.scheduler.tick()
    const awaiting = await harness.store.get('run_harness')
    expect(awaiting?.status).toBe('awaiting_supervision')
    const seq = awaiting!.lastEventSeq
    await harness.scheduler.tick()
    expect((await harness.store.get('run_harness'))?.lastEventSeq).toBe(seq)

    available = true
    await harness.scheduler.tick()
    const completed = await waitFor(async () => {
      const run = await harness.store.get('run_harness')
      return run?.status === 'completed' ? run : null
    })
    expect(completed.summary?.finalAnswer).toContain('runtime recovered')
  }, 15_000)

  it('executes a bounded LoopGate repeatedly, preserves attempt history, and exits on exhaustion', async () => {
    const base = testGraphPlan()
    const start = { ...base.nodes[0]!, id: 'start', title: 'Start' }
    const body = { ...base.nodes[0]!, id: 'body', title: 'Loop body' }
    const gate = {
      ...base.nodes[0]!,
      id: 'gate',
      kind: 'loop_gate' as const,
      title: 'Bounded gate',
      objective: 'Continue while the body is accepted, then exhaust.',
      required: false,
      assignment: undefined,
      loopGate: {
        maxIterations: 2,
        condition: {
          sourceNodeId: 'body',
          outcomeIn: ['accepted' as const]
        },
        continueTargetNodeId: 'body',
        exitTargetNodeId: 'finish',
        exhaustionTargetNodeId: 'finish'
      }
    }
    const finish = { ...base.nodes[1]!, id: 'finish', title: 'Finish' }
    const plan = testGraphPlan({
      nodes: [start, body, gate, finish],
      edges: [
        {
          id: 'start_body',
          kind: 'control',
          from: 'start',
          to: 'body',
          requiredOutcomes: ['accepted']
        },
        {
          id: 'body_gate',
          kind: 'control',
          from: 'body',
          to: 'gate',
          requiredOutcomes: ['accepted']
        },
        {
          id: 'gate_body',
          kind: 'control',
          from: 'gate',
          to: 'body',
          requiredOutcomes: ['skipped']
        },
        {
          id: 'gate_finish',
          kind: 'control',
          from: 'gate',
          to: 'finish',
          requiredOutcomes: ['skipped']
        }
      ],
      completionNodeIds: ['finish'],
      autoStart: true
    })
    let child = 0
    const delegation = {
      enabled: () => true,
      runChild: async (input: {
        onQueued?: (id: string) => Promise<void> | void
        onRunning?: (id: string) => Promise<void> | void
      }) => {
        const id = `loop_child_${++child}`
        await input.onQueued?.(id)
        await input.onRunning?.(id)
        return testCompletedChild(id, `Completed ${id}.`)
      }
    } as unknown as DelegationRuntime
    const harness = await schedulerHarness(plan, () => delegation)
    const completed = await waitFor(async () => {
      await harness.scheduler.tick()
      const run = await harness.store.get('run_harness')
      return run?.status === 'completed' ? run : null
    }, 25_000)
    await harness.scheduler.stop()

    expect(completed.status).toBe('completed')
    expect(completed.budget.loopIterations).toBe(2)
    expect(completed.nodes.gate.status).toBe('skipped')
    expect(completed.nodes.gate.loopIteration).toBe(2)
    expect(completed.nodes.body.attempts).toHaveLength(3)
    expect(completed.nodes.body.attempts.map((attempt) => attempt.iteration)).toEqual([0, 1, 2])
    expect(completed.nodes.finish.status).toBe('accepted')
  }, 30_000)

  it('aborts active workers, discards late results, and records cleanup on cancellation', async () => {
    let workerAborted = false
    const delegation = {
      enabled: () => true,
      runChild: async (input: {
        onQueued?: (id: string) => Promise<void> | void
        onRunning?: (id: string) => Promise<void> | void
        signal?: AbortSignal
      }) => {
        await input.onQueued?.('child_cancel')
        await input.onRunning?.('child_cancel')
        return rejectWhenAborted(input.signal, () => {
          workerAborted = true
        })
      }
    } as unknown as DelegationRuntime
    const harness = await schedulerHarness(
      testGraphPlan({
        nodes: [testGraphPlan().nodes[0]!],
        edges: [],
        completionNodeIds: ['research'],
        autoStart: true
      }),
      () => delegation
    )
    await harness.scheduler.tick()
    await waitFor(async () => {
      const run = await harness.store.get('run_harness')
      return run?.nodes.research.status === 'running' ? run : null
    })
    const cancelled = await harness.control.cancel('run_harness', {
      commandId: 'cancel_active',
      idempotencyKey: 'cancel_active',
      reason: 'user cancelled'
    })

    expect(workerAborted).toBe(true)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.nodes.research.status).toBe('cancelled')
    expect(cancelled.nodes.research.attempts[0]?.status).toBe('cancelled')
    expect(cancelled.cleanup).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceKind: 'lease', state: 'completed' }),
      expect.objectContaining({ resourceKind: 'journal', state: 'completed' })
    ]))
    await harness.scheduler.stop()
  })

  it('host-aborts a worker that exceeds its node wall-time budget and retries safely', async () => {
    let calls = 0
    const basic = testGraphPlan()
    const node = {
      ...basic.nodes[0]!,
      timeoutMs: 20,
      maxAttempts: 1
    }
    const delegation = {
      enabled: () => true,
      runChild: async (input: {
        onQueued?: (id: string) => Promise<void> | void
        onRunning?: (id: string) => Promise<void> | void
        signal?: AbortSignal
      }) => {
        calls += 1
        await input.onQueued?.('child_timeout')
        await input.onRunning?.('child_timeout')
        return rejectWhenAborted(input.signal)
      }
    } as unknown as DelegationRuntime
    const harness = await schedulerHarness(
      testGraphPlan({
        nodes: [node, basic.nodes[1]!],
        edges: basic.edges,
        completionNodeIds: ['finish'],
        autoStart: true
      }),
      () => delegation
    )
    harness.scheduler.start()
    const waiting = await waitFor(async () => {
      await harness.scheduler.tick()
      const run = await harness.store.get('run_harness')
      return run?.status === 'awaiting_supervision' ? run : null
    })

    expect(calls).toBe(1)
    expect(waiting.nodes.research.attempts[0]).toEqual(expect.objectContaining({
      status: 'failed',
      failureClass: 'retryable',
      normalizedFailure: 'Graph node wall-time budget exhausted'
    }))
    expect(waiting.nodes.finish.status).not.toBe('skipped')
    expect(waiting.cleanup).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceKind: 'journal', state: 'completed' })
    ]))
    const events = await harness.store.events('run_harness')
    expect(events.at(-1)?.event).toMatchObject({
      type: 'run_status_changed',
      payload: { to: 'awaiting_supervision' }
    })
    await harness.scheduler.stop()
  }, 15_000)

  it('enforces concurrent-run admission and gives the next run a turn after capacity frees', async () => {
    let calls = 0
    const delegation = {
      enabled: () => true,
      runChild: async (input: {
        onQueued?: (id: string) => Promise<void> | void
        onRunning?: (id: string) => Promise<void> | void
        signal?: AbortSignal
      }) => {
        calls += 1
        const childId = `child_fair_${calls}`
        await input.onQueued?.(childId)
        await input.onRunning?.(childId)
        return rejectWhenAborted(input.signal)
      }
    } as unknown as DelegationRuntime
    const singleNodePlan = testGraphPlan({
      nodes: [testGraphPlan().nodes[0]!],
      edges: [],
      budget: {
        ...testGraphPlan().budget,
        maxConcurrentNodes: 1
      },
      completionNodeIds: ['research'],
      autoStart: true
    })
    const harness = await schedulerHarness(singleNodePlan, () => delegation, {
      scheduler: {
        maxConcurrentRuns: 1,
        maxConcurrentNodes: 2,
        maxConcurrentNodesPerRun: 1
      }
    })
    await harness.control.create({
      runId: 'run_second',
      threadId: 'thread_second',
      projectId: harness.identity.projectId,
      sourceTurnId: 'turn_second',
      plan: testGraphPlan({
        ...singleNodePlan,
        workspaceRoot: harness.workspace
      }),
      commandId: 'create_second',
      idempotencyKey: 'create_second',
      start: true
    })

    await harness.scheduler.tick()
    const firstActive = await waitFor(async () => {
      const active = harness.scheduler.diagnostics().active
      return active.length === 1 ? active[0]! : null
    })
    expect(calls).toBe(1)
    await harness.scheduler.tick()
    expect(calls).toBe(1)

    await harness.control.cancel(firstActive.runId, {
      commandId: 'cancel_first_fair',
      idempotencyKey: 'cancel_first_fair'
    })
    await harness.scheduler.tick()
    await waitFor(async () => calls === 2 ? true : null)
    const remaining = (await harness.store.list({ statuses: ['running'] }))[0]
    if (remaining) {
      await harness.control.cancel(remaining.id, {
        commandId: 'cancel_second_fair',
        idempotencyKey: 'cancel_second_fair'
      })
    }
    await harness.scheduler.stop()
  }, 15_000)
})
