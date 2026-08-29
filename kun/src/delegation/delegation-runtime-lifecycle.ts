import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  ModelReasoningEffort,
  SubagentProfileConfig,
  SubagentToolPolicy,
  type SubagentMode,
  type SubagentsCapabilityConfig
} from '../contracts/capabilities.js'
import {
  ApprovalPolicySchema,
  ApprovalReviewerSchema,
  DEFAULT_APPROVAL_REVIEWER,
  SandboxModeSchema,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../contracts/policy.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import type { TurnClientSurface } from '../contracts/turns.js'
import {
  ChildRunActivity,
  type ChildRunActivity as ChildRunActivityValue,
  type RuntimeEvent
} from '../contracts/events.js'
import type { EventBus } from '../ports/event-bus.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { TurnService } from '../services/turn-service.js'
import type { PptWorkflowScope } from '../ports/tool-host.js'
import { loadWorkspaceAgentProfiles } from './workspace-agents.js'
import type { SubagentRoutingDocument } from './subagent-router.js'
import { BUILTIN_SUBAGENT_PROFILES } from './builtin-profiles.js'
import { BUILTIN_AGENT_CATALOG_BY_ID } from './builtin-agent-catalog.js'
import { resolveTurnClientSurface } from '../loop/turn-context-resolver.js'
import { AtomicJsonFile, isManagerAtomicJsonPath } from '../extensions/atomic-json.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import {
  ChildRunRecord,
  ChildSourceEnvelope,
  ChildSecuritySnapshot,
  isResumableChildRun,
  type ChildReturnFormat,
  type ChildRunExecutor,
  type ChildRunLauncher,
  type ChildRunLifecycleMetadata
} from './delegation-runtime-contracts.js'
import { DelegationRuntimeRun } from './delegation-runtime-run.js'
import type { ChildExecutionState } from './delegation-runtime-base.js'
import { childResultOwnerIds } from './child-result-materializer.js'
import {
  addChildUsage,
  abortChildForUser,
  childPptWorkflowSnapshot,
  childActivityFromEvent,
  childContractError,
  childLifecycleMetadata,
  completeModelProviderPair,
  defaultExecutor,
  elapsedMs,
  errorMessage,
  executeWithParentSignal,
  fingerprintProfile,
  intersectChildSecurity,
  isNotFound,
  normalizeInheritedReasoningEffort,
  notifyLifecycle,
  persistedPptWorkflowIdentityError,
  resolveChildModelSelection,
  sameChildActivity,
  sameModelRoute
} from './delegation-runtime-support.js'
import {
  hasResumableChildSnapshot,
  proactiveRetryStatus
} from './delegation-proactive-retry.js'

export class DelegationRuntime extends DelegationRuntimeRun {
  /**
   * Reclaim child-run projections and linked result artifacts for a deleted
   * parent or side thread. Every operation is idempotent so nested side-thread
   * deletion and a partially completed prior attempt are safe.
   */
  async cleanupThreadDeletion(
    threadId: string,
    deleteSideThread?: (childId: string) => Promise<boolean>
  ): Promise<number> {
    const children = await this.options.store.list(threadId)
    await this.releaseArtifactOwner(`thread:${threadId}`)
    await this.releaseArtifactOwner(`child:${threadId}`)
    await this.options.store.delete(threadId).catch(() => undefined)
    for (const child of children) {
      if (child.id !== threadId) {
        await deleteSideThread?.(child.id).catch(() => false)
      }
      for (const ownerId of childResultOwnerIds(threadId, child.id)) {
        await this.releaseArtifactOwner(ownerId)
      }
      await this.options.store.delete(child.id).catch(() => undefined)
    }
    return children.length
  }

  private async releaseArtifactOwner(ownerId: string): Promise<void> {
    try {
      await this.options.artifactStore?.releaseOwner?.(ownerId)
    } catch (error) {
      console.warn(
        `[kun] linked child artifact cleanup failed owner=${ownerId}: ${errorMessage(error)}`
      )
    }
  }

  async resumeChild(input: {
    childId: string
    parentThreadId: string
    parentTurnId: string
    prompt: string
    source?: ChildSourceEnvelope
    controlPrompt?: string
    pptWorkflowScope?: PptWorkflowScope
    expectedProfile?: string
    expectedWorkflowId?: string
    expectedResumeCount?: number
    expectedLaunchers?: readonly ChildRunLauncher[]
    requireResumable?: boolean
    /** Model-initiated continuation governed by the global proactive retry policy. */
    proactive?: boolean
    /** Current parent boundary; the resumed child receives its intersection with the stored snapshot. */
    security?: ChildSecuritySnapshot
    /** Trusted deny-list for this resume execution only. */
    executionBlockedTools?: string[]
    signal: AbortSignal
    onQueued?: (childId: string, profile?: string, metadata?: ChildRunLifecycleMetadata) => Promise<void> | void
    onRunning?: (childId: string, profile?: string, metadata?: ChildRunLifecycleMetadata) => Promise<void> | void
  }): Promise<ChildRunRecord> {
    if (this.resumingChildren.has(input.childId)) {
      throw new Error(`child run ${input.childId} is still running`)
    }
    this.resumingChildren.add(input.childId)
    try {
      return await this.resumeChildExclusive(input)
    } finally {
      this.resumingChildren.delete(input.childId)
    }
  }

  private async resumeChildExclusive(input: {
    childId: string
    parentThreadId: string
    parentTurnId: string
    prompt: string
    source?: ChildSourceEnvelope
    controlPrompt?: string
    pptWorkflowScope?: PptWorkflowScope
    expectedProfile?: string
    expectedWorkflowId?: string
    expectedResumeCount?: number
    expectedLaunchers?: readonly ChildRunLauncher[]
    requireResumable?: boolean
    proactive?: boolean
    security?: ChildSecuritySnapshot
    executionBlockedTools?: string[]
    signal: AbortSignal
    onQueued?: (childId: string, profile?: string, metadata?: ChildRunLifecycleMetadata) => Promise<void> | void
    onRunning?: (childId: string, profile?: string, metadata?: ChildRunLifecycleMetadata) => Promise<void> | void
  }): Promise<ChildRunRecord> {
    const previous = await this.options.store.get(input.childId)
    if (!previous) throw new Error(`child run ${input.childId} was not found`)
    if (previous.fastContext === true) {
      throw new Error('Fast Context retrieval children cannot be resumed; start a new fast_context retrieval.')
    }
    if (previous.parentThreadId !== input.parentThreadId) {
      throw new Error(`child run ${input.childId} does not belong to this parent thread`)
    }
    if (previous.status === 'queued' || previous.status === 'running') {
      throw new Error(`child run ${input.childId} is still running`)
    }
    if (
      input.expectedResumeCount !== undefined &&
      (previous.resumeCount ?? 0) !== input.expectedResumeCount
    ) {
      throw new Error(
        `child run ${input.childId} resume count changed from ${input.expectedResumeCount} to ${previous.resumeCount ?? 0}`
      )
    }
    if (input.expectedLaunchers && (
      !previous.launcher || !input.expectedLaunchers.includes(previous.launcher)
    )) {
      throw new Error(`child run ${input.childId} is owned by ${previous.launcher ?? 'a legacy launcher'}`)
    }
    if (input.requireResumable && previous.resumable !== true) {
      throw new Error(`child run ${input.childId} is not resumable`)
    }
    if (input.proactive) {
      const policy = this.options.config.proactiveRetry
      const count = previous.proactiveRetryCount ?? 0
      if (!policy.enabled) throw new Error('proactive subagent retry is disabled')
      if (previous.launcher !== 'delegate_task' || previous.fastContext === true) {
        throw new Error(`child run ${input.childId} is not owned by ordinary delegate_task`)
      }
      if (
        previous.status !== 'failed' ||
        (previous.terminationReason !== 'child_error' && previous.terminationReason !== 'runtime_restart')
      ) {
        throw new Error(`child run ${input.childId} is not eligible for proactive retry`)
      }
      if (!previous.profileSnapshot || !previous.security || !previous.workspace) {
        throw new Error(`child run ${input.childId} lacks a resumable security/profile snapshot`)
      }
      if (count >= policy.maxAttempts) {
        throw new Error(`child run ${input.childId} exhausted its ${policy.maxAttempts} proactive retries`)
      }
      const delayMs = Math.max(
        previous.failure?.retryAfterMs ?? 0,
        Math.min(12_000, 3_000 * 2 ** count)
      )
      const wait = this.options.proactiveRetryWait ?? waitForProactiveRetry
      if (await wait(delayMs, input.signal)) {
        throw new Error('proactive subagent retry was cancelled during backoff')
      }
    }
    if (input.expectedProfile && previous.profile !== input.expectedProfile) {
      throw new Error(`child run ${input.childId} is not a ${input.expectedProfile} child`)
    }
    if (input.expectedWorkflowId) {
      const workflowIdentityError = persistedPptWorkflowIdentityError(
        previous.reviewBundle,
        previous.directionBundle,
        previous.id,
        input.expectedWorkflowId,
        previous.pptWorkflow?.workflowId
      )
      if (workflowIdentityError) throw new Error(workflowIdentityError)
    }
    const profileSnapshot = previous.profileSnapshot
    const storedSecurity = previous.security
    if (!profileSnapshot || !storedSecurity || !previous.workspace) {
      throw new Error(`child run ${input.childId} lacks a resumable security/profile snapshot`)
    }
    const security = input.security
      ? intersectChildSecurity(storedSecurity, ChildSecuritySnapshot.parse(input.security))
      : storedSecurity
    const source = input.source ? ChildSourceEnvelope.parse(input.source) : undefined
    const controlPrompt = input.controlPrompt?.trim() || undefined
    const agentSurface = source?.agentSurface ?? previous.agentSurface
    const workspace = security.sandboxRoot
    if (input.signal.aborted) throw new Error('child resume aborted before start')

    const queuedAt = this.now()
    const preserveDetached = input.proactive === true && previous.detached === true
    const record = ChildRunRecord.parse({
      ...previous,
      prompt: input.prompt,
      source,
      controlPrompt: undefined,
      agentSurface,
      parentTurnId: input.parentTurnId,
      status: 'queued',
      terminationReason: undefined,
      resumable: false,
      failure: undefined,
      ...(input.pptWorkflowScope
        ? { pptWorkflow: childPptWorkflowSnapshot(input.pptWorkflowScope) }
        : {}),
      summary: undefined,
      summaryTruncated: undefined,
      resultRef: undefined,
      resultUnavailableReason: undefined,
      evidence: undefined,
      error: undefined,
      activity: undefined,
      detached: preserveDetached ? true : undefined,
      queuedMs: undefined,
      startedAt: undefined,
      resumeCount: (previous.resumeCount ?? 0) + 1,
      proactiveRetryCount: (previous.proactiveRetryCount ?? 0) + (input.proactive ? 1 : 0),
      lastProactiveRetryAt: input.proactive ? queuedAt : previous.lastProactiveRetryAt,
      lastResumeAt: queuedAt,
      updatedAt: queuedAt
    })
    await this.options.store.upsert(record)
    await this.recordChildEvent(record)
    await notifyLifecycle(input.onQueued, record)

    const state: ChildExecutionState = { record, commits: Promise.resolve() }
    const execution = (signal: AbortSignal) => this.executeChild({
      state,
      queuedAt,
      profileName: record.profile,
      toolPolicy: record.toolPolicy ?? this.options.config.defaultToolPolicy,
      resolvedModel: record.model,
      resolvedProviderId: record.providerId,
      resolvedAccountId: record.accountId,
      resolvedSystemPrompt: profileSnapshot.systemPrompt,
      resolvedOmitBasePrompt: profileSnapshot.omitBasePrompt === true,
      resolvedAllowedTools: profileSnapshot.allowedTools,
      resolvedBlockedTools: [...new Set([
        'delegate_task',
        'generate_subagent',
        ...(profileSnapshot.blockedTools ?? []),
        ...(input.executionBlockedTools ?? [])
      ])],
      resolvedBlockedMcpServers: profileSnapshot.blockedMcpServers,
      resolvedBlockedSkills: profileSnapshot.blockedSkills,
      skillsEnabled: profileSnapshot.skillsEnabled !== false,
      promptPreamble: profileSnapshot.promptPreamble,
      approvalPolicy: record.approvalPolicy,
      sandboxMode: record.sandboxMode,
      approvalReviewer: record.approvalReviewer,
      clientSurface: record.clientSurface,
      agentSurface,
      guiDesignCanvas: false,
      resolvedReasoningEffort: record.reasoningEffort,
      resolvedServiceTier: record.serviceTier,
      returnFormat: record.returnFormat,
      fastContext: record.fastContext === true,
      fastContextTasks: record.fastContextTasks,
      queueTimeoutMs: undefined,
      workspace,
      security,
      onRunning: input.onRunning,
      label: record.label,
      parentThreadId: record.parentThreadId,
      parentTurnId: input.parentTurnId,
      prompt: input.prompt,
      source,
      controlPrompt,
      pptWorkflowScope: input.pptWorkflowScope,
      resumeChild: true,
      signal
    })

    if (preserveDetached) {
      const detachedController = new AbortController()
      this.detachedAborts.set(record.id, detachedController)
      this.detachedParentThreads.set(record.id, record.parentThreadId)
      const completion = execution(detachedController.signal)
        .then((settled) => this.notifyDetachedChild(settled))
        .catch(() => undefined)
        .finally(() => {
          this.detachedAborts.delete(record.id)
          this.detachedParentThreads.delete(record.id)
          this.detachedSettlements.delete(record.id)
        })
      this.detachedSettlements.set(record.id, completion)
      return record
    }

    const controller = new AbortController()
    const abortFromParent = (): void => controller.abort(input.signal.reason)
    if (input.signal.aborted) controller.abort(input.signal.reason)
    else input.signal.addEventListener('abort', abortFromParent, { once: true })
    try {
      return await execution(controller.signal)
    } finally {
      input.signal.removeEventListener('abort', abortFromParent)
    }
  }

  /**
   * Run the queue-acquire + execute + result-recording block for a child
   * that was already persisted with status='queued'. Shared by the
   * synchronous path (via inline code in runChild) and the detached path.
   * Failures are recorded on the record rather than re-thrown — for
   * detached runs nobody is awaiting them anyway.
   */
  /**
   * Move a queued/running foreground child into the background. The child
   * keeps its current process, thread, and event stream; only the parent abort
   * bridge is removed and the waiting delegate_task is released.
   */
  async detachChild(childId: string): Promise<boolean> {
    const control = this.foregroundChildren.get(childId)
    if (!control || control.controller.signal.aborted) return false
    let changed = false
    await this.commitChildState(control.state, (current) => {
      if (current.detached || (current.status !== 'queued' && current.status !== 'running')) return undefined
      changed = true
      return ChildRunRecord.parse({
        ...current,
        detached: true,
        updatedAt: this.now()
      })
    })
    if (!changed) return false
    control.unlinkParent()
    this.detachedParentThreads.set(childId, control.parentThreadId)
    this.detachedSettlements.set(childId, control.detachedSettlement)
    this.detachedAborts.set(childId, control.controller)
    control.resolveDetached()
    return true
  }

  /** Abort one active child without interrupting its parent or siblings. */
  abortChild(childId: string): boolean {
    const controller = this.detachedAborts.get(childId) ??
      this.foregroundChildren.get(childId)?.controller
    if (!controller) {
      console.warn(`[kun] subagent user stop requested but no active child found child=${childId}`)
      return false
    }
    console.warn(`[kun] subagent user stop requested child=${childId}`)
    abortChildForUser(controller)
    console.warn(`[kun] subagent user stop signal fired child=${childId}`)
    return true
  }

  /**
   * Abort all live detached children launched from a parent thread. Foreground
   * children already inherit the parent turn signal; detached children do not,
   * so deletion must cancel their independent controllers explicitly.
   */
  async abortDetachedChildrenForThread(parentThreadId: string): Promise<number> {
    const settlements: Promise<void>[] = []
    let aborted = 0
    for (const [childId, controller] of this.detachedAborts) {
      if (this.detachedParentThreads.get(childId) !== parentThreadId) continue
      const settlement = this.detachedSettlements.get(childId)
      if (settlement) settlements.push(settlement)
      controller.abort()
      aborted += 1
    }
    await Promise.allSettled(settlements)
    return aborted
  }

  /**
   * Mark child runs left 'queued'/'running' by a previous process as failed, so
   * a runtime restart doesn't leave subagent records stuck "running" forever —
   * the GUI subagent cards and delegation diagnostics would otherwise show them
   * in-flight indefinitely, and the parent thread stays wedged (KunAgent/Kun#621).
   * Mirrors TurnService.reconcileOrphanedTurns; run once at startup before any
   * new child spawns. Detached runs owned by this process are skipped defensively.
   * Returns the number of records reconciled.
   */
  async reconcileOrphanedChildRuns(): Promise<number> {
    const records = await this.options.store.list()
    let reconciled = 0
    for (const record of records) {
      if (record.status !== 'queued' && record.status !== 'running') continue
      if (this.detachedAborts.has(record.id)) continue
      const updated = ChildRunRecord.parse({
        ...record,
        status: 'failed',
        terminationReason: 'runtime_restart',
        resumable: hasResumableChildSnapshot(record),
        failure: { source: 'runtime', code: 'runtime_restart' },
        error: record.error ?? 'Subagent run was interrupted by a runtime restart.',
        updatedAt: this.now()
      })
      try {
        await this.options.store.upsert(updated)
        await this.recordChildEvent(updated)
        reconciled += 1
      } catch {
        // Best-effort sweep; one unwritable record must not stop the rest.
      }
    }
    return reconciled
  }

  /** Parent threads whose interrupted generic child must wait for an explicit user resume. */
  async resumableParentThreadIds(): Promise<string[]> {
    const records = await this.options.store.list()
    return [...new Set(
      records
        .filter((record) => record.resumable === true && isResumableChildRun(record))
        .map((record) => record.parentThreadId)
    )]
  }

  /** Safe child facts injected into parent recovery turns after a restart. */
  async proactiveRetryRecoveryCandidates(): Promise<Array<{
    parentThreadId: string
    childId: string
    label?: string
    error?: string
    failure?: ChildRunRecord['failure']
    resumeCount: number
    proactiveRetry: ReturnType<typeof proactiveRetryStatus>
    detached: boolean
  }>> {
    const records = await this.options.store.list()
    return records
      .filter((record) => record.terminationReason === 'runtime_restart')
      .map((record) => ({
        record,
        retry: proactiveRetryStatus(record, this.options.config.proactiveRetry)
      }))
      .filter(({ retry }) => retry.eligible)
      .map(({ record, retry }) => ({
        parentThreadId: record.parentThreadId,
        childId: record.id,
        ...(record.label ? { label: record.label } : {}),
        ...(record.error ? { error: record.error } : {}),
        ...(record.failure ? { failure: record.failure } : {}),
        resumeCount: record.resumeCount ?? 0,
        proactiveRetry: retry,
        detached: record.detached === true
      }))
  }
}

function waitForProactiveRetry(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(true)
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(false)
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
