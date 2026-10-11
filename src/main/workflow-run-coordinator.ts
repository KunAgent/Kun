import type {
  WorkflowApprovalDecision,
  WorkflowNodeRunResultV1,
  WorkflowNodeRunStatus,
  WorkflowPendingApprovalV1,
  WorkflowRuntimeStatus
} from '../shared/app-settings'

type PendingApproval = {
  entry: WorkflowPendingApprovalV1
  resolve: (decision: WorkflowApprovalDecision) => void
}

/** Single writer for run lifecycle, cancellation, approvals, and live projection. */
export class WorkflowRunCoordinator {
  private readonly runningWorkflowIds = new Set<string>()
  private readonly cancelRequested = new Set<string>()
  private readonly pendingApprovals = new Map<string, PendingApproval>()
  private readonly liveNodeStatus = new Map<string, Map<string, WorkflowNodeRunStatus>>()
  private readonly liveNodeResults = new Map<string, Map<string, WorkflowNodeRunResultV1>>()
  private readonly abortControllers = new Map<string, AbortController>()
  private readonly cleanupTimers = new Set<ReturnType<typeof setTimeout>>()

  isRunning(workflowId: string): boolean {
    return this.runningWorkflowIds.has(workflowId)
  }

  begin(workflowId: string, nodeIds: readonly string[]): boolean {
    if (this.runningWorkflowIds.has(workflowId)) return false
    this.runningWorkflowIds.add(workflowId)
    this.cancelRequested.delete(workflowId)
    this.abortControllers.set(workflowId, new AbortController())
    this.liveNodeStatus.set(workflowId, new Map(nodeIds.map((nodeId) => [nodeId, 'pending'])))
    this.liveNodeResults.set(workflowId, new Map())
    return true
  }

  finish(workflowId: string, runId: string, lingerMs: number): void {
    this.runningWorkflowIds.delete(workflowId)
    this.cancelRequested.delete(workflowId)
    this.abortControllers.delete(workflowId)
    for (const [token, pending] of this.pendingApprovals) {
      if (pending.entry.runId === runId) this.pendingApprovals.delete(token)
    }
    // Each begin replaces these maps. A timer may only retire its own projection.
    const statuses = this.liveNodeStatus.get(workflowId)
    const results = this.liveNodeResults.get(workflowId)
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(timer)
      if (this.liveNodeStatus.get(workflowId) === statuses) this.liveNodeStatus.delete(workflowId)
      if (this.liveNodeResults.get(workflowId) === results) this.liveNodeResults.delete(workflowId)
    }, lingerMs)
    timer.unref?.()
    this.cleanupTimers.add(timer)
  }

  beginSingleNode(workflowId: string, nodeId: string): Map<string, WorkflowNodeRunStatus> {
    const live = new Map<string, WorkflowNodeRunStatus>([[nodeId, 'running']])
    this.liveNodeStatus.set(workflowId, live)
    return live
  }

  finishSingleNode(
    workflowId: string,
    lingerMs: number,
    statuses = this.liveNodeStatus.get(workflowId)
  ): void {
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(timer)
      if (this.liveNodeStatus.get(workflowId) === statuses) this.liveNodeStatus.delete(workflowId)
    }, lingerMs)
    timer.unref?.()
    this.cleanupTimers.add(timer)
  }

  requestCancel(workflowId: string): boolean {
    if (!this.runningWorkflowIds.has(workflowId)) return false
    this.cancelRequested.add(workflowId)
    this.abortControllers.get(workflowId)?.abort()
    for (const pending of this.pendingApprovals.values()) {
      if (pending.entry.workflowId === workflowId) pending.resolve('rejected')
    }
    return true
  }

  isCanceled(workflowId: string | undefined): boolean {
    return workflowId ? this.cancelRequested.has(workflowId) : false
  }

  signal(workflowId: string): AbortSignal | undefined {
    return this.abortControllers.get(workflowId)?.signal
  }

  cancelAll(): void {
    for (const workflowId of [...this.runningWorkflowIds]) this.requestCancel(workflowId)
    for (const pending of [...this.pendingApprovals.values()]) pending.resolve('rejected')
    for (const timer of this.cleanupTimers) clearTimeout(timer)
    this.cleanupTimers.clear()
  }

  setLive(workflowId: string, nodeId: string, status: WorkflowNodeRunStatus): void {
    const map = this.liveNodeStatus.get(workflowId) ?? new Map<string, WorkflowNodeRunStatus>()
    map.set(nodeId, status)
    this.liveNodeStatus.set(workflowId, map)
  }

  setLiveResult(workflowId: string | undefined, result: WorkflowNodeRunResultV1): void {
    if (!workflowId) return
    const map = this.liveNodeResults.get(workflowId) ?? new Map<string, WorkflowNodeRunResultV1>()
    map.set(result.nodeId, result)
    this.liveNodeResults.set(workflowId, map)
  }

  resolveApproval(token: string, decision: WorkflowApprovalDecision): boolean {
    const pending = this.pendingApprovals.get(token)
    if (!pending) return false
    pending.resolve(decision)
    return true
  }

  awaitApproval(
    entry: WorkflowPendingApprovalV1,
    timeoutMs: number,
    onTimeout: WorkflowApprovalDecision
  ): Promise<WorkflowApprovalDecision> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const settle = (value: WorkflowApprovalDecision): void => {
        if (timer) clearTimeout(timer)
        this.pendingApprovals.delete(entry.token)
        resolve(value)
      }
      if (timeoutMs > 0) timer = setTimeout(() => settle(onTimeout), timeoutMs)
      this.pendingApprovals.set(entry.token, { entry, resolve: settle })
    })
  }

  status(powerSaveBlockerActive: boolean): WorkflowRuntimeStatus {
    const nodeStatus: Record<string, Record<string, WorkflowNodeRunStatus>> = {}
    for (const [workflowId, map] of this.liveNodeStatus) nodeStatus[workflowId] = Object.fromEntries(map)
    const nodeResults: Record<string, Record<string, WorkflowNodeRunResultV1>> = {}
    for (const [workflowId, map] of this.liveNodeResults) nodeResults[workflowId] = Object.fromEntries(map)
    return {
      runningWorkflowIds: [...this.runningWorkflowIds],
      nodeStatus,
      nodeResults,
      powerSaveBlockerActive,
      pendingApprovals: [...this.pendingApprovals.values()].map((pending) => pending.entry)
    }
  }
}
