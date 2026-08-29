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
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import type { TurnService } from '../services/turn-service.js'
import { isHostShutdownTurnSuspension } from '../services/turn-service.js'
import type { PptWorkflowScope } from '../ports/tool-host.js'
import {
  applyWorkspaceAgentSurfaceFallback,
  loadWorkspaceAgentCatalogProfiles,
  loadWorkspaceAgentProfiles
} from './workspace-agents.js'
import type { WorkspaceAgentCatalogProfile } from './workspace-agents.js'
import type { SubagentRoutingDocument } from './subagent-router.js'
import { BUILTIN_SUBAGENT_PROFILES } from './builtin-profiles.js'
import { BUILTIN_AGENT_CATALOG_BY_ID } from './builtin-agent-catalog.js'
import { resolveTurnClientSurface } from '../loop/turn-context-resolver.js'
import { AtomicJsonFile, isManagerAtomicJsonPath } from '../extensions/atomic-json.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import {
  ChildRunRecord,
  FileDelegationStore,
  isResumableChildRun,
  profileAvailableOnSurface,
  type ChildRunAggregate,
  type ChildRunExecutor,
  type ChildReturnFormat,
  type ChildRunLifecycleMetadata,
  type ChildSourceEnvelope,
  type ChildSecuritySnapshot
} from './delegation-runtime-contracts.js'
import {
  aggregateChildRuns,
  buildFailedChildRecord,
  childAbortOutcome,
  childActivityFromEvent,
  childContractError,
  defaultExecutor,
  elapsedMs,
  executeWithParentSignal,
  formatDetachedChildDisplayText,
  notifyLifecycle,
  sameChildActivity,
  subtractChildUsage,
  toUsageSnapshot
} from './delegation-runtime-support.js'
import {
  formatDetachedChildNotice,
  hasResumableChildSnapshot,
  proactiveRetryStatus
} from './delegation-proactive-retry.js'
import {
  CHILD_RESULT_PREVIEW_CHARS,
  ChildResultExecutionError
} from './child-result-materializer.js'

import {
  ChildQueueTimeoutError,
  ScopedSlotScheduler,
  SlotScheduler,
  type SlotLease
} from './delegation-slot-waiter.js'

export type RunTurnFn = (threadId: string, turnId: string) => Promise<unknown>

export type ChildExecutionState = {
  record: ChildRunRecord
  commits: Promise<void>
}

export type ForegroundChildControl = {
  state: ChildExecutionState
  controller: AbortController
  parentThreadId: string
  unlinkParent: () => void
  resolveDetached: () => void
  detachedSettlement: Promise<void>
  resolveDetachedSettlement: () => void
}

export abstract class DelegationRuntimeBase {
  private memoryPressureParallelLimit: number | undefined
  private readonly ordinarySlots = new SlotScheduler(() => this.enabled() ? this.parallelLimit : 0)
  private readonly fastContextSlots = new ScopedSlotScheduler(() => this.enabled() ? 1 : 0)
  protected childSeq = 0
  protected readonly childSeqById = new Map<string, number>()
  /**
   * Background (detached) child runs keyed by childId, exposing an
   * AbortController so the user can cancel a long-running task from the
   * GUI even after the parent turn finished.
   */
  protected readonly detachedAborts = new Map<string, AbortController>()
  /** Parent thread for each live detached child, used by thread deletion. */
  protected readonly detachedParentThreads = new Map<string, string>()
  /** Completion of each detached execution, including persistence and parent notification. */
  protected readonly detachedSettlements = new Map<string, Promise<void>>()
  /**
   * Foreground children are executed through an independently-owned signal
   * that is linked to the parent until the user presses Ctrl+B. Keeping this
   * bridge in the runtime (rather than the TUI) makes dynamic backgrounding
   * safe for every client and lets the pending delegate_task return.
   */
  protected readonly foregroundChildren = new Map<string, ForegroundChildControl>()
  /** A persistent child thread accepts at most one appended follow-up turn at a time. */
  protected readonly resumingChildren = new Set<string>()
  protected runTurn: RunTurnFn | null = null

  constructor(protected options: {
    config: SubagentsCapabilityConfig
    store: FileDelegationStore
    events?: RuntimeEventRecorder
    eventBus?: EventBus
    threadStore?: ThreadStore
    turns?: TurnService
    artifactStore?: ArtifactStore
    nowIso?: () => string
    idGenerator?: () => string
    executor?: ChildRunExecutor
    recordExternalUsage?: (threadId: string, usage: UsageSnapshot) => void
    proactiveRetryWait?: (delayMs: number, signal: AbortSignal) => Promise<boolean>
  }) {}

  bindAgentLoop(input: { runTurn: RunTurnFn }): void {
    this.runTurn = input.runTurn
  }

  replaceConfig(config: SubagentsCapabilityConfig): void {
    this.options = {
      ...this.options,
      config
    }
    this.ordinarySlots.refresh()
    this.fastContextSlots.refresh()
  }

  setMemoryPressureParallelLimit(limit?: number): void {
    this.memoryPressureParallelLimit = limit === undefined ? undefined : Math.max(1, Math.floor(limit))
    this.ordinarySlots.refresh()
  }

  enabled(): boolean {
    return this.options.config.enabled
  }
  /** Concurrency ceiling; clamps to at least 1 so an enabled runtime never deadlocks. */
  protected get parallelLimit(): number {
    return Math.max(1, Math.min(
      this.options.config.maxParallel,
      this.memoryPressureParallelLimit ?? Number.POSITIVE_INFINITY
    ))
  }

  /** Acquire the ordinary global lane or the Fast Context parent-session lane. */
  protected acquireSlot(input: {
    fastContext: boolean
    parentThreadId: string
    signal: AbortSignal
    queueTimeoutMs?: number
  }): Promise<SlotLease> {
    return input.fastContext
      ? this.fastContextSlots.acquire(input.parentThreadId, input.signal, input.queueTimeoutMs)
      : this.ordinarySlots.acquire(input.signal, input.queueTimeoutMs)
  }

  /** Configured profiles, surfaced to the delegate_task tool schema/UI. */
  listProfiles(): { name: string; mode: SubagentMode; toolPolicy: SubagentToolPolicy; model?: string; providerId?: string; description?: string }[] {
    return Object.entries(this.options.config.profiles).map(([name, profile]) => ({
      name,
      mode: profile.mode,
      toolPolicy: profile.toolPolicy,
      ...(profile.model ? { model: profile.model } : {}),
      ...(profile.providerId ? { providerId: profile.providerId } : {}),
      ...(profile.description ? { description: profile.description } : {})
    }))
  }

  /**
   * Workspace `.kun/agents/*.md` overlays for the GUI roster.
   * Returned separately from `listProfiles()` so Settings/Sidebar can merge
   * them without rewriting persistent GUI settings.
   */
  async listWorkspaceProfiles(workspace: string): Promise<WorkspaceAgentCatalogProfile[]> {
    return loadWorkspaceAgentCatalogProfiles(workspace, this.options.config.profiles)
  }

  /** Resolve one explicit profile once so routing and execution share a snapshot. */
  async resolveProfileSnapshot(
    profileId: string,
    workspace?: string,
    agentSurface: 'code' | 'write' | 'design' = 'code'
  ): Promise<{ id: string; source: 'builtin' | 'configured' | 'workspace'; profile: SubagentProfileConfig } | undefined> {
    const id = profileId.trim()
    if (!id) return undefined
    if (workspace) {
      const hit = (await loadWorkspaceAgentProfiles(workspace)).find((entry) => entry.id === id)
      if (hit) {
        const profile = applyWorkspaceAgentSurfaceFallback(hit, this.options.config.profiles[id])
        return profileAvailableOnSurface(profile, agentSurface)
          ? { id, source: 'workspace', profile }
          : undefined
      }
    }
    if (!Object.prototype.hasOwnProperty.call(this.options.config.profiles, id)) return undefined
    const profile = this.options.config.profiles[id]
    if (!profile) return undefined
    if (!profileAvailableOnSurface(profile, agentSurface)) return undefined
    return {
      id,
      source: BUILTIN_SUBAGENT_PROFILES[id] === profile ? 'builtin' : 'configured',
      profile
    }
  }

  /** Profiles visible to automatic routing, including workspace overlays. */
  async listRoutingProfiles(
    workspace?: string,
    agentSurface: 'code' | 'write' | 'design' = 'code'
  ): Promise<SubagentRoutingDocument[]> {
    const profiles = new Map<string, SubagentProfileConfig>(Object.entries(this.options.config.profiles))
    const sources = new Map<string, 'builtin' | 'configured' | 'workspace'>(
      Object.entries(this.options.config.profiles).map(([id, profile]) => [
        id,
        BUILTIN_SUBAGENT_PROFILES[id] === profile ? 'builtin' : 'configured'
      ])
    )
    if (workspace) {
      const overlay = await loadWorkspaceAgentProfiles(workspace)
      for (const entry of overlay) {
        profiles.set(
          entry.id,
          applyWorkspaceAgentSurfaceFallback(entry, this.options.config.profiles[entry.id])
        )
        sources.set(entry.id, 'workspace')
      }
    }
    return [...profiles.entries()]
      .filter(([, profile]) => profile.mode !== 'primary' && profileAvailableOnSurface(profile, agentSurface))
      .map(([id, profile]) => ({
        kind: 'profile' as const,
        id,
        source: sources.get(id) ?? 'configured',
        profile,
        ...(BUILTIN_AGENT_CATALOG_BY_ID[id]?.routingTerms
          ? { routingTerms: BUILTIN_AGENT_CATALOG_BY_ID[id]!.routingTerms }
          : {})
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  get defaultProfileName(): string | undefined {
    return this.options.config.defaultProfile
  }

  get useExistingAgents(): boolean {
    return this.options.config.useExistingAgents
  }

  get defaultToolPolicy(): SubagentToolPolicy {
    return this.options.config.defaultToolPolicy
  }

  get proactiveRetryPolicy(): SubagentsCapabilityConfig['proactiveRetry'] {
    return this.options.config.proactiveRetry
  }

  async diagnostics(parentThreadId?: string): Promise<{
    enabled: boolean
    active: number
    childRuns: ChildRunRecord[]
    aggregates: ChildRunAggregate[]
  }> {
    const childRuns = (await this.options.store.list(parentThreadId)).map((record) => {
      const visible = { ...record }
      delete visible.controlPrompt
      return visible
    })
    return {
      enabled: this.options.config.enabled,
      active: this.ordinarySlots.activeCount + this.fastContextSlots.activeCount,
      childRuns,
      aggregates: aggregateChildRuns(childRuns)
    }
  }

  protected async recordChildEvent(record: ChildRunRecord): Promise<void> {
    const usage = record.usage
    await this.options.events?.record({
      kind: record.status === 'completed' ? 'turn_completed' : record.status === 'failed' ? 'turn_failed' : record.status === 'aborted' ? 'turn_aborted' : 'turn_started',
      threadId: record.parentThreadId,
      turnId: record.parentTurnId,
      status: record.status,
      text: record.summary ?? record.error,
      child: {
        parentThreadId: record.parentThreadId,
        parentTurnId: record.parentTurnId,
        childId: record.id,
        childLabel: record.label,
        childStatus: record.status,
        childSeq: this.stableChildSeq(record),
        ...(record.launcher ? { childLauncher: record.launcher } : {}),
        ...(record.terminationReason ? { childTerminationReason: record.terminationReason } : {}),
        resumable: record.resumable === true,
        resumeCount: record.resumeCount ?? 0,
        ...(record.failure ? { failure: record.failure } : {}),
        proactiveRetry: proactiveRetryStatus(record, this.options.config.proactiveRetry),
        ...(record.detached ? { detached: true } : {}),
        ...(record.model ? { childModel: record.model } : {}),
        ...(record.providerId ? { childProviderId: record.providerId } : {}),
        ...(record.profile ? { childProfile: record.profile } : {}),
        ...(record.profileSnapshot?.name ? { childProfileName: record.profileSnapshot.name } : {}),
        ...(record.toolPolicy ? { childToolPolicy: record.toolPolicy } : {}),
        ...(record.prefixReused !== undefined ? { prefixReused: record.prefixReused } : {}),
        ...(record.inheritedHistoryItems !== undefined ? { inheritedHistoryItems: record.inheritedHistoryItems } : {}),
        ...(record.toolInvocations !== undefined ? { toolInvocations: record.toolInvocations } : {}),
        ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
        ...(record.queuedMs !== undefined ? { queuedMs: record.queuedMs } : {}),
        ...(record.summaryTruncated ? { summaryTruncated: true } : {}),
        ...(record.resultRef ? { resultRef: record.resultRef } : {}),
        ...(record.resultUnavailableReason
          ? { resultUnavailableReason: record.resultUnavailableReason }
          : {}),
        ...(usage.totalTokens > 0 ? { totalTokens: usage.totalTokens } : {}),
        ...(usage.cacheHitRate !== undefined && usage.cacheHitRate !== null ? { cacheHitRate: usage.cacheHitRate } : {}),
        ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
        ...(usage.costCny !== undefined ? { costCny: usage.costCny } : {}),
        ...(record.activity ? { activity: record.activity } : {})
      }
    })
  }

  protected nextChildSeq(childId: string): number {
    const existing = this.childSeqById.get(childId)
    if (existing !== undefined) return existing
    const next = ++this.childSeq
    this.childSeqById.set(childId, next)
    return next
  }

  protected stableChildSeq(record: ChildRunRecord): number {
    if (record.childSeq !== undefined) {
      this.childSeqById.set(record.id, record.childSeq)
      this.childSeq = Math.max(this.childSeq, record.childSeq)
      return record.childSeq
    }
    return this.nextChildSeq(record.id)
  }

  protected recordExternalUsage(
    record: ChildRunRecord,
    childUsage: ChildRunRecord['usage'] = record.usage
  ): void {
    const usage = toUsageSnapshot(childUsage)
    if (usage.totalTokens <= 0 && usage.costUsd === undefined && usage.costCny === undefined) return
    // Independent ledger: child usage settles on the child's own side thread,
    // never the parent, so parent cache telemetry and budgets stay clean.
    this.options.recordExternalUsage?.(record.id, usage)
  }

  protected async notifyDetachedChild(record: ChildRunRecord): Promise<void> {
    if (record.status === 'aborted' && record.terminationReason !== 'user_stop') return
    if (record.status !== 'completed' && record.status !== 'failed' && record.status !== 'aborted') return
    if (!this.options.threadStore || !this.options.turns || !this.runTurn) return
    const thread = await this.options.threadStore.get(record.parentThreadId)
    if (!thread) return
    const notice = formatDetachedChildNotice(
      record,
      proactiveRetryStatus(record, this.options.config.proactiveRetry)
    )
    const displayText = formatDetachedChildDisplayText(record)
    if (thread.status === 'running') {
      const runningTurn = [...thread.turns].reverse().find((turn) => turn.status === 'running')
      if (runningTurn) {
        await this.options.turns.steerTurn({
          threadId: record.parentThreadId,
          turnId: runningTurn.id,
          text: notice,
          displayText,
          messageSource: 'background_subagent'
        })
        return
      }
    }
    const sourceTurn = thread.turns.find((turn) => turn.id === record.parentTurnId) ?? thread.turns.at(-1)
    const started = await this.options.turns.startTurn({
      threadId: record.parentThreadId,
      request: {
        prompt: notice,
        ...(sourceTurn ? { clientSurface: resolveTurnClientSurface(sourceTurn) } : {}),
        ...(sourceTurn?.disableUserInput ? { disableUserInput: true } : {}),
        displayText,
        messageSource: 'background_subagent'
      }
    })
    void this.runTurn(record.parentThreadId, started.turnId)
  }

  protected now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }

  protected async executeChild(args: {
    state: ChildExecutionState
    queuedAt: string
    profileName: string | undefined
    toolPolicy: SubagentToolPolicy
    resolvedModel: string | undefined
    resolvedProviderId: string | undefined
    resolvedAccountId: string | undefined
    resolvedSystemPrompt: string | undefined
    resolvedOmitBasePrompt: boolean
    resolvedAllowedTools: string[] | undefined
    resolvedBlockedTools: string[] | undefined
    resolvedBlockedMcpServers: string[] | undefined
    resolvedBlockedSkills: string[] | undefined
    skillsEnabled: boolean
    promptPreamble: string | undefined
    approvalPolicy: ApprovalPolicy | undefined
    sandboxMode: SandboxMode | undefined
    approvalReviewer: ApprovalReviewer
    clientSurface: TurnClientSurface | undefined
    agentSurface: 'code' | 'write' | 'design' | undefined
    guiDesignCanvas: boolean
    resolvedReasoningEffort: string | undefined
    resolvedServiceTier: 'priority' | undefined
    returnFormat: ChildReturnFormat
    fastContext: boolean
    fastContextTasks: readonly import('./fast-context-evidence.js').FastContextTask[] | undefined
    queueTimeoutMs: number | undefined
    workspace: string | undefined
    security: ChildSecuritySnapshot | undefined
    onRunning: ((childId: string, profile?: string, metadata?: ChildRunLifecycleMetadata) => Promise<void> | void) | undefined
    label: string | undefined
    parentThreadId: string
    parentTurnId: string
    prompt: string
    source: ChildSourceEnvelope | undefined
    controlPrompt: string | undefined
    pptWorkflowScope: PptWorkflowScope | undefined
    resumeChild?: boolean
    signal: AbortSignal
  }): Promise<ChildRunRecord> {
    let record = args.state.record
    let releaseSlot: SlotLease | undefined
    try {
      releaseSlot = await this.acquireSlot({
        fastContext: args.fastContext,
        parentThreadId: args.parentThreadId,
        signal: args.signal,
        queueTimeoutMs: args.queueTimeoutMs
      })
    } catch (error) {
      if (error instanceof ChildQueueTimeoutError) {
        const finishedAt = this.now()
        record = await this.commitChildState(args.state, (current) => ChildRunRecord.parse({
          ...current,
          status: 'failed',
          terminationReason: 'child_error',
          resumable: false,
          failure: { source: 'runtime', code: error.code, category: 'timeout' },
          queuedMs: elapsedMs(args.queuedAt, finishedAt),
          error: error.message.slice(0, CHILD_RESULT_PREVIEW_CHARS),
          updatedAt: finishedAt
        }))
        return record
      }
      const abort = childAbortOutcome(args.signal, isHostShutdownTurnSuspension(args.signal), error)
      record = await this.commitChildState(args.state, (current) => ChildRunRecord.parse({
        ...current,
        status: abort.terminationReason === 'runtime_restart' ? 'failed' : 'aborted',
        terminationReason: abort.terminationReason,
        resumable: hasResumableChildSnapshot(current),
        error: abort.error.slice(0, CHILD_RESULT_PREVIEW_CHARS),
        updatedAt: this.now()
      }))
      return record
    }

    const startedAt = this.now()
    let unsubscribeActivity: (() => void) | undefined
    let usageBeforeRun: ChildRunRecord['usage'] | undefined
    try {
      const queuedMs = elapsedMs(args.queuedAt, startedAt)
      record = await this.commitChildState(args.state, (current) => ChildRunRecord.parse({
        ...current,
        status: 'running',
        terminationReason: undefined,
        resumable: false,
        startedAt,
        queuedMs,
        updatedAt: startedAt
      }))
      await notifyLifecycle(args.onRunning, record)
      unsubscribeActivity = this.options.eventBus?.subscribe(record.id, (event) => {
        void this.projectChildActivity(args.state, event)
      })
      usageBeforeRun = record.usage
      const executor: ChildRunExecutor = this.options.executor ?? defaultExecutor
      const result = await executeWithParentSignal(args.signal, (signal) => executor({
          ...(args.resumeChild ? { resumeChild: true } : {}),
          childId: record.id,
          parentThreadId: args.parentThreadId,
          parentTurnId: args.parentTurnId,
          ...(args.label ? { label: args.label } : {}),
          ...(args.profileName ? { profile: args.profileName } : {}),
          prompt: args.prompt,
          ...(args.source ? { source: args.source } : {}),
          ...(args.controlPrompt ? { controlPrompt: args.controlPrompt } : {}),
          ...(args.pptWorkflowScope ? { pptWorkflowScope: args.pptWorkflowScope } : {}),
          workspace: args.workspace,
          model: args.resolvedModel,
          ...(args.resolvedProviderId ? { providerId: args.resolvedProviderId } : {}),
          ...(args.resolvedAccountId ? { accountId: args.resolvedAccountId } : {}),
          ...(args.resolvedSystemPrompt ? { systemPrompt: args.resolvedSystemPrompt } : {}),
          ...(args.resolvedOmitBasePrompt ? { omitBasePrompt: true } : {}),
          ...(args.resolvedAllowedTools ? { allowedTools: args.resolvedAllowedTools } : {}),
          ...(args.security ? { security: args.security } : {}),
          ...(args.resolvedBlockedTools ? { blockedTools: args.resolvedBlockedTools } : {}),
          ...(args.resolvedBlockedMcpServers ? { blockedMcpServers: args.resolvedBlockedMcpServers } : {}),
          ...(args.resolvedBlockedSkills ? { blockedSkills: args.resolvedBlockedSkills } : {}),
          skillsEnabled: args.skillsEnabled,
          toolPolicy: args.toolPolicy,
          ...(args.approvalPolicy ? { approvalPolicy: args.approvalPolicy } : {}),
          ...(args.sandboxMode ? { sandboxMode: args.sandboxMode } : {}),
          approvalReviewer: args.approvalReviewer,
          ...(args.clientSurface ? { clientSurface: args.clientSurface } : {}),
          ...(args.agentSurface ? { agentSurface: args.agentSurface } : {}),
          ...(args.promptPreamble ? { promptPreamble: args.promptPreamble } : {}),
          ...(args.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
          ...(args.resolvedReasoningEffort ? { reasoningEffort: args.resolvedReasoningEffort } : {}),
          ...(args.resolvedServiceTier ? { serviceTier: args.resolvedServiceTier } : {}),
          returnFormat: args.returnFormat,
          ...(args.fastContext ? { fastContext: true } : {}),
          ...(args.fastContextTasks?.length ? { fastContextTasks: args.fastContextTasks } : {}),
          signal
      }))
      const finishedAt = this.now()
      const contractError = childContractError(args.returnFormat, result.evidence)
      record = await this.commitChildState(args.state, (current) => ChildRunRecord.parse({
        ...current,
        status: contractError ? 'failed' : 'completed',
        terminationReason: contractError ? 'child_error' : undefined,
        resumable: contractError ? hasResumableChildSnapshot(current) : false,
        summary: result.summary,
        summaryTruncated: result.summaryTruncated,
        resultRef: result.resultRef,
        resultUnavailableReason: result.resultUnavailableReason,
        directionBundle: result.directionBundle ?? current.directionBundle,
        directionBundleParentTurnId: result.directionBundle !== undefined
          ? args.parentTurnId
          : current.directionBundleParentTurnId,
        reviewBundle: result.reviewBundle ?? current.reviewBundle,
        reviewBundleParentTurnId: result.reviewBundle !== undefined
          ? args.parentTurnId
          : current.reviewBundleParentTurnId,
        deckArtifact: result.deckArtifact ?? current.deckArtifact,
        deckArtifactParentTurnId: result.deckArtifact !== undefined
          ? args.parentTurnId
          : current.deckArtifactParentTurnId,
        evidence: result.evidence,
        evidencePack: result.evidencePack,
        // ChildRunExecutor reports cumulative usage for the persistent side
        // thread, so adding it would double-count turns completed before resume.
        usage: result.usage ?? current.usage,
        toolInvocations: result.toolInvocations,
        prefixReused: result.prefixReused,
        inheritedHistoryItems: result.inheritedHistoryItems,
        ...(contractError ? { error: contractError } : {}),
        ...(contractError ? {
          failure: { source: 'contract' as const, code: 'child_contract_error' }
        } : { failure: undefined }),
        durationMs: (current.durationMs ?? 0) + elapsedMs(startedAt, finishedAt),
        updatedAt: finishedAt
      }))
      this.recordExternalUsage(record, subtractChildUsage(record.usage, usageBeforeRun))
      return record
    } catch (error) {
      const finishedAt = this.now()
      const runtimeRestart = isHostShutdownTurnSuspension(args.signal)
      const abort = childAbortOutcome(args.signal, runtimeRestart, error)
      const failedError = error instanceof ChildResultExecutionError ? error : undefined
      const childResult = failedError?.result
      record = await this.commitChildState(args.state, (current) => buildFailedChildRecord(current, {
        signal: args.signal,
        runtimeRestart,
        abort,
        parentTurnId: args.parentTurnId,
        childId: record.id,
        startedAt,
        finishedAt,
        ...(childResult ? { childResult } : {}),
        ...(failedError?.usage !== undefined ? { usage: failedError.usage } : {}),
        ...(failedError?.toolInvocations !== undefined
          ? { toolInvocations: failedError.toolInvocations }
          : {}),
        ...(failedError?.failure ? { failure: failedError.failure } : {}),
        previewChars: CHILD_RESULT_PREVIEW_CHARS
      }))
      // Settle usage for failed/aborted children too: tokens burned before the
      // failure are real cost and must reach the child ledger exactly once
      // (issue #1155). Same delta mechanism as the success path, so resume and
      // retry never double-count, and zero-usage failures stay zero.
      if (usageBeforeRun !== undefined && failedError?.usage !== undefined) {
        this.recordExternalUsage(record, subtractChildUsage(record.usage, usageBeforeRun))
      }
      return record
    } finally {
      try {
        unsubscribeActivity?.()
      } catch (error) {
        console.warn('[kun] child activity subscription cleanup failed:', error)
      } finally {
        releaseSlot?.()
      }
    }
  }

  protected async projectChildActivity(state: ChildExecutionState, event: RuntimeEvent): Promise<void> {
    const nextActivity = childActivityFromEvent(event, state.record.activity)
    if (!nextActivity) return
    await this.commitChildState(state, (current) => {
      if (current.status !== 'running') return undefined
      if (sameChildActivity(current.activity, nextActivity)) return undefined
      return ChildRunRecord.parse({
        ...current,
        activity: nextActivity,
        updatedAt: nextActivity.updatedAt
      })
    })
  }

  /**
   * Serialize mutations for one child so a completion racing a Ctrl+B
   * background request cannot be overwritten by an older running snapshot.
   */
  protected async commitChildState(
    state: ChildExecutionState,
    mutate: (current: ChildRunRecord) => ChildRunRecord | undefined
  ): Promise<ChildRunRecord> {
    let committed = state.record
    const operation = state.commits.catch(() => undefined).then(async () => {
      const next = mutate(state.record)
      if (!next) {
        committed = state.record
        return
      }
      state.record = next
      committed = next
      await this.options.store.upsert(next)
      await this.recordChildEvent(next)
    })
    state.commits = operation
    await operation
    return committed
  }
}
