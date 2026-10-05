import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkflowRunCoordinator } from './workflow-run-coordinator'

describe('WorkflowRunCoordinator', () => {
  afterEach(() => vi.useRealTimers())

  it('does not let an older run cleanup erase a new run projection', () => {
    vi.useFakeTimers()
    const coordinator = new WorkflowRunCoordinator()
    coordinator.begin('workflow_1', ['old_node'])
    coordinator.finish('workflow_1', 'old_run', 100)
    vi.advanceTimersByTime(50)
    coordinator.begin('workflow_1', ['new_node'])
    coordinator.setLive('workflow_1', 'new_node', 'running')
    const result = {
      nodeId: 'new_node', status: 'running' as const, startedAt: '', finishedAt: '',
      message: 'new run', outputJson: '', threadId: '', error: ''
    }
    coordinator.setLiveResult('workflow_1', result)

    vi.advanceTimersByTime(50)
    expect(coordinator.status(false).nodeStatus.workflow_1).toEqual({ new_node: 'running' })
    expect(coordinator.status(false).nodeResults.workflow_1).toEqual({ new_node: result })
    expect(coordinator.isRunning('workflow_1')).toBe(true)

    coordinator.finish('workflow_1', 'new_run', 100)
    vi.advanceTimersByTime(100)
    expect(coordinator.status(false).nodeStatus.workflow_1).toBeUndefined()
    expect(coordinator.status(false).nodeResults.workflow_1).toBeUndefined()
  })

  it('gives each completed run its own full linger period', () => {
    vi.useFakeTimers()
    const coordinator = new WorkflowRunCoordinator()
    coordinator.begin('workflow_1', ['old_node'])
    coordinator.finish('workflow_1', 'old_run', 100)
    vi.advanceTimersByTime(50)
    coordinator.begin('workflow_1', ['new_node'])
    coordinator.setLive('workflow_1', 'new_node', 'success')
    coordinator.finish('workflow_1', 'new_run', 100)

    vi.advanceTimersByTime(50)
    expect(coordinator.status(false).nodeStatus.workflow_1).toEqual({ new_node: 'success' })
    vi.advanceTimersByTime(50)
    expect(coordinator.status(false).nodeStatus.workflow_1).toBeUndefined()
  })

  it('does not let single-node cleanup erase a newer workflow run', () => {
    vi.useFakeTimers()
    const coordinator = new WorkflowRunCoordinator()
    coordinator.beginSingleNode('workflow_1', 'old_node')
    coordinator.finishSingleNode('workflow_1', 100)
    coordinator.begin('workflow_1', ['new_node'])
    vi.advanceTimersByTime(100)
    expect(coordinator.status(false).nodeStatus.workflow_1).toEqual({ new_node: 'pending' })
  })

  it('binds a late single-node completion to the projection it began with', () => {
    vi.useFakeTimers()
    const coordinator = new WorkflowRunCoordinator()
    const old = coordinator.beginSingleNode('workflow_1', 'old_node')
    coordinator.begin('workflow_1', ['new_node'])
    coordinator.finishSingleNode('workflow_1', 100, old)
    vi.advanceTimersByTime(100)
    expect(coordinator.status(false).nodeStatus.workflow_1).toEqual({ new_node: 'pending' })
  })

  it('owns one begin/finish lifecycle and clears live state after linger', () => {
    vi.useFakeTimers()
    const coordinator = new WorkflowRunCoordinator()
    expect(coordinator.begin('workflow_1', ['node_1'])).toBe(true)
    expect(coordinator.begin('workflow_1', ['node_1'])).toBe(false)
    coordinator.setLive('workflow_1', 'node_1', 'success')
    coordinator.finish('workflow_1', 'run_1', 100)
    expect(coordinator.isRunning('workflow_1')).toBe(false)
    expect(coordinator.status(false).nodeStatus.workflow_1.node_1).toBe('success')
    vi.advanceTimersByTime(100)
    expect(coordinator.status(false).nodeStatus.workflow_1).toBeUndefined()
    vi.useRealTimers()
  })

  it('cancellation settles a pending approval and reaches one decision', async () => {
    const coordinator = new WorkflowRunCoordinator()
    coordinator.begin('workflow_1', ['approval_1'])
    const decision = coordinator.awaitApproval({
      token: 'approval_token',
      workflowId: 'workflow_1',
      runId: 'run_1',
      nodeId: 'approval_1',
      nodeName: 'Approval',
      title: 'Continue?',
      instruction: 'Approve the run',
      createdAt: '2026-07-11T00:00:00.000Z'
    }, 0, 'approved')
    const signal = coordinator.signal('workflow_1')

    expect(signal?.aborted).toBe(false)
    expect(coordinator.requestCancel('workflow_1')).toBe(true)
    expect(signal?.aborted).toBe(true)
    await expect(decision).resolves.toBe('rejected')
    expect(coordinator.resolveApproval('approval_token', 'approved')).toBe(false)
  })
})
