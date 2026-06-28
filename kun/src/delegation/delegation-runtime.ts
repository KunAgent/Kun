import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { SubagentToolPolicy, type SubagentMode, type SubagentProfileConfig, type SubagentsCapabilityConfig } from '../contracts/capabilities.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import { loadWorkspaceAgentProfiles } from './workspace-agents.js'

const ChildRunUsage = z.object({
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  cachedTokens: z.number().int().nonnegative().optional(),
  cacheHitTokens: z.number().int().nonnegative().optional(),
  cacheMissTokens: z.number().int().nonnegative().optional(),
  cacheHitRate: z.number().min(0).max(1).nullable().optional(),
  turns: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  costCny: z.number().nonnegative().optional(),
  cacheSavingsUsd: z.number().nonnegative().optional(),
  cacheSavingsCny: z.number().nonnegative().optional(),
  tokenEconomySavingsTokens: z.number().int().nonnegative().optional(),
  tokenEconomySavingsUsd: z.number().nonnegative().optional(),
  tokenEconomySavingsCny: z.number().nonnegative().optional()
})

export const ChildRunRecord = z.object({
  id: z.string().min(1),
  parentThreadId: z.string().min(1),
  parentTurnId: z.string().min(1),
  label: z.string().optional(),
  prompt: z.string().min(1),
  workspace: z.string().optional(),
  model: z.string().optional(),
  /** Resolved provider id the child routed through, when one was selected. */
  providerId: z.string().optional(),
  /** Resolved subagent profile name, when one was selected. */
  profile: z.string().optional(),
  /** Effective tool policy applied to the child (read-only vs inherited). */
  toolPolicy: SubagentToolPolicy.optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'aborted']),
  summary: z.string().optional(),
  error: z.string().optional(),
  usage: ChildRunUsage.default({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
  /** True when the child reused the main agent's cached stable prefix. */
  prefixReused: z.boolean().optional(),
  /** Parent history items seeded into the child (0 = prefix-only). */
  inheritedHistoryItems: z.number().int().nonnegative().optional(),
  /** Tool calls the child executed during its run. */
  toolInvocations: z.number().int().nonnegative().optional(),
  /** Wall-clock spent running (after leaving the queue). */
  durationMs: z.number().int().nonnegative().optional(),
  /** Wall-clock spent waiting for a parallel slot before starting. */
  queuedMs: z.number().int().nonnegative().optional(),
  createdAt: z.string(),
  /** When the child left the queue and began running. */
  startedAt: z.string().optional(),
  updatedAt: z.string()
}).strict()
export type ChildRunRecord = z.infer<typeof ChildRunRecord>

export type ChildRunExecutor = (input: {
  childId: string
  parentThreadId: string
  parentTurnId: string
  label?: string
  /** Resolved subagent profile id (e.g. `general`, `explore`); used for the child thread title. */
  profile?: string
  prompt: string
  workspace?: string
  model?: string
  providerId?: string
  systemPrompt?: string
  allowedTools?: string[]
  /** Built-in tool names blocked for this child (deny-list layered on inherit). */
  blockedTools?: string[]
  /** MCP server ids blocked for this child (deny-list; whole server toolset hidden). */
  blockedMcpServers?: string[]
  /** Skill ids blocked for this child (deny-list; catalog + activation + load_skill). */
  blockedSkills?: string[]
  toolPolicy: SubagentToolPolicy
  promptPreamble?: string
  /** Reasoning depth for this profile's child model requests (default 'off'). */
  reasoningEffort?: string
  signal: AbortSignal
}) => Promise<{
  summary: string
  usage?: ChildRunRecord['usage']
  toolInvocations?: number
  prefixReused?: boolean
  inheritedHistoryItems?: number
}>

export type ChildRunAggregate = {
  key: string
  label?: string
  model?: string
  runs: number
  completed: number
  failed: number
  aborted: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd?: number
  costCny?: number
  averageTotalTokens: number
  averageCostUsd?: number
  averageCostCny?: number
}

export class FileDelegationStore {
  constructor(private readonly rootDir: string) {}

  async upsert(record: ChildRunRecord): Promise<void> {
    await mkdir(this.rootDir, { recursive: true })
    await writeFile(join(this.rootDir, `${record.id}.json`), JSON.stringify(record, null, 2), 'utf8')
  }

  async list(parentThreadId?: string): Promise<ChildRunRecord[]> {
    await mkdir(this.rootDir, { recursive: true })
    const entries = await readdir(this.rootDir).catch(() => [])
    const records = await Promise.all(entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => readFile(join(this.rootDir, entry), 'utf8')
        .then((text) => ChildRunRecord.parse(JSON.parse(text)))
        .catch(() => null)))
    return records
      .filter((record): record is ChildRunRecord => Boolean(record))
      .filter((record) => !parentThreadId || record.parentThreadId === parentThreadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
}

type SlotWaiter = {
  resolve: () => void
  reject: (error: unknown) => void
  signal: AbortSignal
  onAbort: () => void
}

export class DelegationRuntime {
  private active = 0
  private childSeq = 0
  /** Children waiting for a parallel slot, in FIFO order. */
  private readonly slotWaiters: SlotWaiter[] = []
  /** Per-thread child counts (persisted + in-flight) for the budget cap. */
  private readonly threadCounts = new Map<string, number>()
  /** Cached per-thread seed reads so concurrent first-spawns don't double-count. */
  private readonly threadSeeds = new Map<string, Promise<void>>()
  /**
   * Background (detached) child runs keyed by childId, exposing an
   * AbortController so the user can cancel a long-running task from the
   * GUI even after the parent turn finished.
   */
  private readonly detachedAborts = new Map<string, AbortController>()

  constructor(private readonly options: {
    config: SubagentsCapabilityConfig
    store: FileDelegationStore
    events?: RuntimeEventRecorder
    nowIso?: () => string
    idGenerator?: () => string
    executor?: ChildRunExecutor
    recordExternalUsage?: (threadId: string, usage: UsageSnapshot) => void
  }) {}

  async runChild(input: {
    parentThreadId: string
    parentTurnId: string
    label?: string
    prompt: string
    workspace?: string
    model?: string
    providerId?: string
    profile?: string
    /**
     * When true, runChild returns the queued ChildRunRecord immediately and
     * continues execution in the background. The detached run gets its own
     * AbortController so the user can cancel it via `abortChild(id)` even
     * after the parent turn finishes. Default: false (synchronous).
     */
    detach?: boolean
    /**
     * Invoked once, as soon as the child id is allocated (before the child
     * finishes), so the caller can surface the id while the child is still
     * running — e.g. the delegate_task tool emits a partial result so the GUI
     * can offer "open session" mid-run. Carries the resolved profile id so the
     * caller can keep showing the subagent type while it runs.
     */
    onStart?: (childId: string, profile?: string) => void
    signal: AbortSignal
  }): Promise<ChildRunRecord> {
    const config = this.options.config
    if (!config.enabled) throw new Error('delegation is disabled by config')

    // Resolve the profile up front so model/preamble/tool-policy are
    // captured on the record even if the child later fails.
    const profileName = input.profile?.trim() || config.defaultProfile
    // Workspace overlay: `.kun/agents/*.md` in the call's workspace wins
    // over the static `config.profiles` map. Loaded fresh per call so the
    // user can edit overlays without restarting the runtime.
    let profile: SubagentProfileConfig | undefined = profileName ? config.profiles[profileName] : undefined
    if (profileName && input.workspace) {
      const overlay = await loadWorkspaceAgentProfiles(input.workspace)
      const hit = overlay.find((entry) => entry.id === profileName)
      if (hit) profile = hit.profile
    }
    if (profileName && !profile) {
      throw new Error(`unknown subagent profile: ${profileName}`)
    }
    const toolPolicy = profile?.toolPolicy ?? config.defaultToolPolicy
    const resolvedModel = input.model?.trim() || profile?.model
    const resolvedProviderId = input.providerId?.trim() || profile?.providerId
    const resolvedSystemPrompt = profile?.systemPrompt
    const resolvedAllowedTools = profile?.allowedTools
    const resolvedBlockedTools = profile?.blockedTools
    const resolvedBlockedMcpServers = profile?.blockedMcpServers
    const resolvedBlockedSkills = profile?.blockedSkills
    const promptPreamble = profile?.promptPreamble
    const resolvedReasoningEffort = profile?.reasoningEffort

    // Reserve against the per-thread budget before persisting anything.
    await this.ensureSeeded(input.parentThreadId)
    if (!this.reserveChild(input.parentThreadId)) {
      throw new Error('delegation child-run budget exhausted')
    }

    const queuedAt = this.now()
    const id = this.options.idGenerator?.() ?? `child_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    let record = ChildRunRecord.parse({
      id,
      parentThreadId: input.parentThreadId,
      parentTurnId: input.parentTurnId,
      label: input.label,
      prompt: input.prompt,
      workspace: input.workspace,
      model: resolvedModel,
      providerId: resolvedProviderId,
      profile: profileName,
      toolPolicy,
      status: 'queued',
      createdAt: queuedAt,
      updatedAt: queuedAt
    })
    await this.options.store.upsert(record)
    await this.recordChildEvent(record)
    // Surface the child id immediately (both sync + detached paths) so the
    // caller can show it while the child is still running.
    input.onStart?.(record.id, profileName)

    if (input.detach) {
      // Spawn an independent signal so the parent turn's signal aborting
      // doesn't reach into the background run. The user can still cancel
      // via abortChild(id).
      const detachedController = new AbortController()
      this.detachedAborts.set(record.id, detachedController)
      // Surface ChildRunExecutor's resolved fields via the closure shared with
      // the synchronous path. The same executor block runs inside executeChild.
      void this.executeChild({
        record,
        queuedAt,
        profileName,
        toolPolicy,
        resolvedModel,
        resolvedProviderId,
        resolvedSystemPrompt,
        resolvedAllowedTools,
        resolvedBlockedTools,
        resolvedBlockedMcpServers,
        resolvedBlockedSkills,
        promptPreamble,
        resolvedReasoningEffort,
        workspace: input.workspace,
        label: input.label,
        parentThreadId: input.parentThreadId,
        parentTurnId: input.parentTurnId,
        prompt: input.prompt,
        signal: detachedController.signal
      }).finally(() => this.detachedAborts.delete(record.id))
      return record
    }

    try {
      await this.acquireSlot(input.signal)
    } catch (error) {
      // Aborted while still queued — never started, so no slot to release.
      record = ChildRunRecord.parse({
        ...record,
        status: 'aborted',
        error: errorMessage(error),
        updatedAt: this.now()
      })
      await this.options.store.upsert(record)
      await this.recordChildEvent(record)
      return record
    }

    const startedAt = this.now()
    const queuedMs = elapsedMs(queuedAt, startedAt)
    record = ChildRunRecord.parse({ ...record, status: 'running', startedAt, queuedMs, updatedAt: startedAt })
    await this.options.store.upsert(record)
    await this.recordChildEvent(record)
    try {
      const executor: ChildRunExecutor = this.options.executor ?? defaultExecutor
      const result = await executor({
        childId: id,
        parentThreadId: input.parentThreadId,
        parentTurnId: input.parentTurnId,
        ...(input.label ? { label: input.label } : {}),
        ...(profileName ? { profile: profileName } : {}),
        prompt: input.prompt,
        workspace: input.workspace,
        model: resolvedModel,
        ...(resolvedProviderId ? { providerId: resolvedProviderId } : {}),
        ...(resolvedSystemPrompt ? { systemPrompt: resolvedSystemPrompt } : {}),
        ...(resolvedAllowedTools ? { allowedTools: resolvedAllowedTools } : {}),
        ...(resolvedBlockedTools ? { blockedTools: resolvedBlockedTools } : {}),
        ...(resolvedBlockedMcpServers ? { blockedMcpServers: resolvedBlockedMcpServers } : {}),
        ...(resolvedBlockedSkills ? { blockedSkills: resolvedBlockedSkills } : {}),
        toolPolicy,
        ...(promptPreamble ? { promptPreamble } : {}),
        ...(resolvedReasoningEffort ? { reasoningEffort: resolvedReasoningEffort } : {}),
        signal: input.signal
      })
      const finishedAt = this.now()
      record = ChildRunRecord.parse({
        ...record,
        status: 'completed',
        summary: result.summary,
        usage: result.usage ?? record.usage,
        toolInvocations: result.toolInvocations,
        prefixReused: result.prefixReused,
        inheritedHistoryItems: result.inheritedHistoryItems,
        durationMs: elapsedMs(startedAt, finishedAt),
        updatedAt: finishedAt
      })
      await this.options.store.upsert(record)
      await this.recordChildEvent(record)
      this.recordExternalUsage(record)
      return record
    } catch (error) {
      const finishedAt = this.now()
      record = ChildRunRecord.parse({
        ...record,
        status: input.signal.aborted ? 'aborted' : 'failed',
        error: errorMessage(error),
        durationMs: elapsedMs(startedAt, finishedAt),
        updatedAt: finishedAt
      })
      await this.options.store.upsert(record)
      await this.recordChildEvent(record)
      return record
    } finally {
      this.releaseSlot()
    }
  }

  /**
   * Run the queue-acquire + execute + result-recording block for a child
   * that was already persisted with status='queued'. Shared by the
   * synchronous path (via inline code in runChild) and the detached path.
   * Failures are recorded on the record rather than re-thrown — for
   * detached runs nobody is awaiting them anyway.
   */
  private async executeChild(args: {
    record: ChildRunRecord
    queuedAt: string
    profileName: string | undefined
    toolPolicy: SubagentToolPolicy
    resolvedModel: string | undefined
    resolvedProviderId: string | undefined
    resolvedSystemPrompt: string | undefined
    resolvedAllowedTools: string[] | undefined
    resolvedBlockedTools: string[] | undefined
    resolvedBlockedMcpServers: string[] | undefined
    resolvedBlockedSkills: string[] | undefined
    promptPreamble: string | undefined
    resolvedReasoningEffort: string | undefined
    workspace: string | undefined
    label: string | undefined
    parentThreadId: string
    parentTurnId: string
    prompt: string
    signal: AbortSignal
  }): Promise<ChildRunRecord> {
    let record = args.record
    try {
      await this.acquireSlot(args.signal)
    } catch (error) {
      record = ChildRunRecord.parse({
        ...record,
        status: 'aborted',
        error: errorMessage(error),
        updatedAt: this.now()
      })
      await this.options.store.upsert(record)
      await this.recordChildEvent(record)
      return record
    }

    const startedAt = this.now()
    const queuedMs = elapsedMs(args.queuedAt, startedAt)
    record = ChildRunRecord.parse({ ...record, status: 'running', startedAt, queuedMs, updatedAt: startedAt })
    await this.options.store.upsert(record)
    await this.recordChildEvent(record)
    try {
      const executor: ChildRunExecutor = this.options.executor ?? defaultExecutor
      const result = await executor({
        childId: record.id,
        parentThreadId: args.parentThreadId,
        parentTurnId: args.parentTurnId,
        ...(args.label ? { label: args.label } : {}),
        ...(args.profileName ? { profile: args.profileName } : {}),
        prompt: args.prompt,
        workspace: args.workspace,
        model: args.resolvedModel,
        ...(args.resolvedProviderId ? { providerId: args.resolvedProviderId } : {}),
        ...(args.resolvedSystemPrompt ? { systemPrompt: args.resolvedSystemPrompt } : {}),
        ...(args.resolvedAllowedTools ? { allowedTools: args.resolvedAllowedTools } : {}),
        ...(args.resolvedBlockedTools ? { blockedTools: args.resolvedBlockedTools } : {}),
        ...(args.resolvedBlockedMcpServers ? { blockedMcpServers: args.resolvedBlockedMcpServers } : {}),
        ...(args.resolvedBlockedSkills ? { blockedSkills: args.resolvedBlockedSkills } : {}),
        toolPolicy: args.toolPolicy,
        ...(args.promptPreamble ? { promptPreamble: args.promptPreamble } : {}),
        ...(args.resolvedReasoningEffort ? { reasoningEffort: args.resolvedReasoningEffort } : {}),
        signal: args.signal
      })
      const finishedAt = this.now()
      record = ChildRunRecord.parse({
        ...record,
        status: 'completed',
        summary: result.summary,
        usage: result.usage ?? record.usage,
        toolInvocations: result.toolInvocations,
        prefixReused: result.prefixReused,
        inheritedHistoryItems: result.inheritedHistoryItems,
        durationMs: elapsedMs(startedAt, finishedAt),
        updatedAt: finishedAt
      })
      await this.options.store.upsert(record)
      await this.recordChildEvent(record)
      this.recordExternalUsage(record)
      return record
    } catch (error) {
      const finishedAt = this.now()
      record = ChildRunRecord.parse({
        ...record,
        status: args.signal.aborted ? 'aborted' : 'failed',
        error: errorMessage(error),
        durationMs: elapsedMs(startedAt, finishedAt),
        updatedAt: finishedAt
      })
      await this.options.store.upsert(record)
      await this.recordChildEvent(record)
      return record
    } finally {
      this.releaseSlot()
    }
  }

  /**
   * Abort a detached child by id. Returns `true` when a running detached
   * job was signalled, `false` otherwise. Synchronous (in-flight) runs
   * are unaffected — the caller can abort their own parent signal instead.
   */
  abortChild(childId: string): boolean {
    const controller = this.detachedAborts.get(childId)
    if (!controller) return false
    controller.abort()
    return true
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

  /** Concurrency ceiling; clamps to at least 1 so an enabled runtime never deadlocks. */
  private get parallelLimit(): number {
    return Math.max(1, this.options.config.maxParallel)
  }

  /** Acquire a parallel slot, queueing (FIFO) when the runtime is saturated. */
  private acquireSlot(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new Error('aborted while queued'))
    if (this.active < this.parallelLimit) {
      this.active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: SlotWaiter = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          const index = this.slotWaiters.indexOf(waiter)
          if (index >= 0) this.slotWaiters.splice(index, 1)
          reject(new Error('aborted while queued'))
        }
      }
      signal.addEventListener('abort', waiter.onAbort, { once: true })
      this.slotWaiters.push(waiter)
    })
  }

  /** Hand the freed slot to the next waiter, or shrink the active count. */
  private releaseSlot(): void {
    const next = this.slotWaiters.shift()
    if (next) {
      next.signal.removeEventListener('abort', next.onAbort)
      next.resolve() // slot is handed over directly; `active` stays the same
    } else {
      this.active = Math.max(0, this.active - 1)
    }
  }

  /** Seed the per-thread budget counter from persisted records exactly once. */
  private ensureSeeded(threadId: string): Promise<void> {
    let seed = this.threadSeeds.get(threadId)
    if (!seed) {
      seed = this.options.store
        .list(threadId)
        .then((runs) => {
          if (!this.threadCounts.has(threadId)) this.threadCounts.set(threadId, runs.length)
        })
        .catch(() => {
          if (!this.threadCounts.has(threadId)) this.threadCounts.set(threadId, 0)
        })
      this.threadSeeds.set(threadId, seed)
    }
    return seed
  }

  /** Atomically reserve a budget slot; returns false when the cap is reached. */
  private reserveChild(threadId: string): boolean {
    const used = this.threadCounts.get(threadId) ?? 0
    if (used >= this.options.config.maxChildRuns) return false
    this.threadCounts.set(threadId, used + 1)
    return true
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

  get defaultProfileName(): string | undefined {
    return this.options.config.defaultProfile
  }

  get defaultToolPolicy(): SubagentToolPolicy {
    return this.options.config.defaultToolPolicy
  }

  async diagnostics(parentThreadId?: string): Promise<{
    enabled: boolean
    active: number
    childRuns: ChildRunRecord[]
    aggregates: ChildRunAggregate[]
  }> {
    const childRuns = await this.options.store.list(parentThreadId)
    return {
      enabled: this.options.config.enabled,
      active: this.active,
      childRuns,
      aggregates: aggregateChildRuns(childRuns)
    }
  }

  private async recordChildEvent(record: ChildRunRecord): Promise<void> {
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
        childSeq: ++this.childSeq,
        ...(record.model ? { childModel: record.model } : {}),
        ...(record.providerId ? { childProviderId: record.providerId } : {}),
        ...(record.profile ? { childProfile: record.profile } : {}),
        ...(record.toolPolicy ? { childToolPolicy: record.toolPolicy } : {}),
        ...(record.prefixReused !== undefined ? { prefixReused: record.prefixReused } : {}),
        ...(record.inheritedHistoryItems !== undefined ? { inheritedHistoryItems: record.inheritedHistoryItems } : {}),
        ...(record.toolInvocations !== undefined ? { toolInvocations: record.toolInvocations } : {}),
        ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
        ...(record.queuedMs !== undefined ? { queuedMs: record.queuedMs } : {}),
        ...(usage.totalTokens > 0 ? { totalTokens: usage.totalTokens } : {}),
        ...(usage.cacheHitRate !== undefined && usage.cacheHitRate !== null ? { cacheHitRate: usage.cacheHitRate } : {}),
        ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
        ...(usage.costCny !== undefined ? { costCny: usage.costCny } : {})
      }
    })
  }

  private recordExternalUsage(record: ChildRunRecord): void {
    if (record.status !== 'completed') return
    const usage = toUsageSnapshot(record.usage)
    if (usage.totalTokens <= 0 && usage.costUsd === undefined && usage.costCny === undefined) return
    this.options.recordExternalUsage?.(record.parentThreadId, usage)
  }

  private now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }
}

function toUsageSnapshot(usage: ChildRunRecord['usage']): UsageSnapshot {
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    cachedTokens: usage.cachedTokens,
    cacheHitTokens: usage.cacheHitTokens,
    cacheMissTokens: usage.cacheMissTokens,
    cacheHitRate: usage.cacheHitRate ?? null,
    turns: usage.turns ?? 0,
    costUsd: usage.costUsd,
    costCny: usage.costCny,
    cacheSavingsUsd: usage.cacheSavingsUsd,
    cacheSavingsCny: usage.cacheSavingsCny,
    tokenEconomySavingsTokens: usage.tokenEconomySavingsTokens,
    tokenEconomySavingsUsd: usage.tokenEconomySavingsUsd,
    tokenEconomySavingsCny: usage.tokenEconomySavingsCny
  }
}

export function aggregateChildRuns(records: readonly ChildRunRecord[]): ChildRunAggregate[] {
  const buckets = new Map<string, ChildRunAggregate>()
  for (const record of records) {
    const label = record.label?.trim() || undefined
    const model = record.model?.trim() || undefined
    const key = `${label ?? 'unlabeled'}:${model ?? 'default'}`
    const bucket = buckets.get(key) ?? {
      key,
      ...(label ? { label } : {}),
      ...(model ? { model } : {}),
      runs: 0,
      completed: 0,
      failed: 0,
      aborted: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      averageTotalTokens: 0
    }
    bucket.runs += 1
    if (record.status === 'completed') bucket.completed += 1
    else if (record.status === 'failed') bucket.failed += 1
    else if (record.status === 'aborted') bucket.aborted += 1
    bucket.promptTokens += record.usage.promptTokens
    bucket.completionTokens += record.usage.completionTokens
    bucket.totalTokens += record.usage.totalTokens
    if (record.usage.costUsd !== undefined) bucket.costUsd = (bucket.costUsd ?? 0) + record.usage.costUsd
    if (record.usage.costCny !== undefined) bucket.costCny = (bucket.costCny ?? 0) + record.usage.costCny
    bucket.averageTotalTokens = bucket.runs > 0 ? bucket.totalTokens / bucket.runs : 0
    bucket.averageCostUsd = bucket.costUsd !== undefined && bucket.runs > 0 ? bucket.costUsd / bucket.runs : undefined
    bucket.averageCostCny = bucket.costCny !== undefined && bucket.runs > 0 ? bucket.costCny / bucket.runs : undefined
    buckets.set(key, bucket)
  }
  return [...buckets.values()].sort((a, b) =>
    b.runs - a.runs ||
    b.totalTokens - a.totalTokens ||
    a.key.localeCompare(b.key)
  )
}

const defaultExecutor: ChildRunExecutor = async (input) => {
  return { summary: `Child result: ${input.prompt}` }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Non-negative millisecond delta between two ISO timestamps (0 when unparseable). */
function elapsedMs(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso)
  const to = Date.parse(toIso)
  if (Number.isNaN(from) || Number.isNaN(to)) return 0
  return Math.max(0, to - from)
}
