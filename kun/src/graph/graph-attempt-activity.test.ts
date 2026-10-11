import { afterEach, describe, expect, it, vi } from 'vitest'
import { GRAPH_CONTRACT_VERSION } from '../contracts/graph.js'
import type { DelegationRuntime } from '../delegation/delegation-runtime.js'
import { applyGraphEvent } from './graph-reducer.js'
import { GraphWorkerSessionRegistry } from './graph-worker-sessions.js'
import { bindGraphAttemptSession } from './graph-attempt-activity.js'
import {
  testAssignmentSnapshot,
  testCompletedChild,
  testGraphEnvelope,
  testGraphPlan
} from './graph-test-fixtures.test-support.js'
import {
  schedulerHarness,
  schedulerTestRoots,
  waitFor
} from '../../tests/graph-scheduler-test-harness.js'
import { rm } from 'node:fs/promises'

function run() {
  return applyGraphEvent(undefined, testGraphEnvelope(1, {
    type: 'run_created',
    payload: {
      plan: testGraphPlan(),
      projectId: 'project_1',
      sourceTurnId: 'turn_1'
    }
  }))
}

function attempt(patch: Record<string, unknown> = {}) {
  return {
    version: GRAPH_CONTRACT_VERSION,
    id: 'attempt_1',
    runId: 'run_1',
    nodeId: 'research',
    revision: 1,
    attemptNumber: 1,
    iteration: 0,
    commandId: 'command_1',
    idempotencyKey: 'attempt_key_1',
    status: 'queued',
    assignment: testAssignmentSnapshot(),
    queuedAt: '2026-01-01T00:00:00.000Z',
    tokenUsage: 0,
    ...patch
  } as never
}

function harness(patch: Record<string, unknown> = {}) {
  const workerSessions = new GraphWorkerSessionRegistry()
  const register = vi.fn()
  const options = {
    workerSessions,
    activity: { register },
    ...patch
  }
  return { workerSessions, register, options }
}

describe('bindGraphAttemptSession', () => {
  it('binds the child thread to the attempt and registers the activity row', () => {
    const { workerSessions, register, options } = harness()
    const graphRun = run()
    const nodeAttempt = attempt()

    bindGraphAttemptSession(
      options as never,
      graphRun,
      'research',
      nodeAttempt,
      'child_1'
    )

    expect(workerSessions.get('child_1')).toEqual({
      runId: graphRun.id,
      nodeId: 'research',
      attemptId: 'attempt_1'
    })
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      unitId: 'attempt_1',
      kind: 'graph-attempt',
      threadId: 'child_1',
      parentThreadId: graphRun.threadId,
      harnessId: 'kun',
      mainState: 'initializing'
    }))
  })

  it('registers the assignment harness and a worktree workspace', () => {
    const { register, options } = harness()
    const graphRun = run()
    const nodeAttempt = attempt({
      assignment: {
        ...testAssignmentSnapshot(),
        harnessId: 'claude-code',
        workspaceRoot: '/workspace/.kun/worktrees/attempt_1'
      }
    })

    bindGraphAttemptSession(
      options as never,
      graphRun,
      'research',
      nodeAttempt,
      'child_2'
    )

    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      harnessId: 'claude-code',
      workspace: { path: '/workspace/.kun/worktrees/attempt_1', kind: 'worktree' }
    }))
  })

  it('marks a same-root workspace as local', () => {
    const { register, options } = harness()
    const graphRun = run()

    bindGraphAttemptSession(
      options as never,
      graphRun,
      'research',
      attempt(),
      'child_3'
    )

    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      workspace: { path: '/workspace', kind: 'local' }
    }))
  })

  it('swallows a failing register call so scheduling continues', () => {
    const workerSessions = new GraphWorkerSessionRegistry()
    const options = {
      workerSessions,
      activity: {
        register: () => {
          throw new Error('activity store unavailable')
        }
      }
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(() =>
      bindGraphAttemptSession(
        options as never,
        run(),
        'research',
        attempt(),
        'child_4'
      )
    ).not.toThrow()
    expect(workerSessions.has('child_4')).toBe(true)
    warn.mockRestore()
  })
})

describe('graph attempt harness routing', () => {
  afterEach(async () => {
    await Promise.all(
      schedulerTestRoots.splice(0).map((root) =>
        rm(root, { recursive: true, force: true }))
    )
  })

  it('passes the pinned harnessId and credentialMode through to runChild', async () => {
    const source = testGraphPlan().nodes[0]!
    const ephemeral = source.assignment as Extract<
      NonNullable<typeof source.assignment>,
      { kind: 'ephemeral' }
    >
    const plan = testGraphPlan({
      nodes: [{
        ...source,
        assignment: {
          ...ephemeral,
          harnessId: 'claude-code',
          credentialMode: 'native-login' as const
        }
      }],
      edges: [],
      completionNodeIds: [source.id],
      autoStart: true
    })
    let routed: { harnessId?: string; credentialMode?: string } | undefined
    const delegation = {
      enabled: () => true,
      runChild: async (input: {
        harnessId?: string
        credentialMode?: string
        onQueued?: (id: string) => Promise<void> | void
        onRunning?: (id: string) => Promise<void> | void
      }) => {
        routed = input
        await input.onQueued?.('child_routed')
        await input.onRunning?.('child_routed')
        return testCompletedChild('child_routed', 'done')
      }
    } as unknown as DelegationRuntime
    const harness = await schedulerHarness(plan, () => delegation)
    harness.scheduler.start()
    const completed = await waitFor(async () => {
      const run = await harness.store.get('run_harness')
      return run?.status === 'completed' ? run : null
    })
    await harness.scheduler.stop()

    expect(completed.nodes.research.status).toBe('accepted')
    expect(routed).toMatchObject({
      harnessId: 'claude-code',
      credentialMode: 'native-login'
    })
  }, 15_000)
})
